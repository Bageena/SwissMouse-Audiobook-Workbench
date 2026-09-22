import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// v1: 100 ms, 16 kHz mono signed PCM. Acoustic records are five float32 LE
// values: peak, RMS, silence flag, consecutive silence seconds, RMS delta.
// Window position is implicit (index * windowSeconds); no transcript inference.
const windowSamples = 1600;
const windowSeconds = 0.1;
const signature = (file: string) => {
  const s = fs.statSync(file);
  return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
};
export class PcmAnalysis {
  private pending = Buffer.alloc(0);
  private count = 0;
  private peak = 0;
  private sum = 0;
  private previous = 0;
  private silence = 0;
  private samples = 0;
  private records = 0;
  private buffer = Buffer.alloc(20 * 1024);
  private used = 0;
  private fd: number;
  readonly temporary: string;
  constructor(readonly audio: string) {
    this.temporary = audio + '.analysis-' + randomUUID();
    fs.mkdirSync(this.temporary);
    this.fd = fs.openSync(this.temporary + '/features.bin', 'w');
  }
  push(chunk: Buffer) {
    const data = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const end = data.length - data.length % 2;
    for (let i = 0; i < end; i += 2) {
      const sample = data.readInt16LE(i) / 32768;
      this.peak = Math.max(this.peak, Math.abs(sample));
      this.sum += sample * sample;
      this.count++; this.samples++;
      if (this.count === windowSamples) this.flushWindow();
    }
    this.pending = Buffer.from(data.subarray(end));
  }
  private flushWindow() {
    const rms = Math.sqrt(this.sum / this.count);
    this.silence = rms < 0.003162 ? this.silence + this.count / 16000 : 0;
    [this.peak, rms, this.silence > 0 ? 1 : 0, this.silence, rms - this.previous].forEach((v, i) => this.buffer.writeFloatLE(v, this.used + i * 4));
    this.used += 20; this.records++; this.previous = rms;
    this.count = 0; this.peak = 0; this.sum = 0;
    if (this.used === this.buffer.length) this.flushBuffer();
  }
  private flushBuffer() { if (this.used) fs.writeSync(this.fd, this.buffer.subarray(0, this.used)); this.used = 0; }
  abort() {
    if (this.fd !== undefined) { fs.closeSync(this.fd); this.fd = undefined; }
    // This directory is created and owned exclusively by this collector.
    fs.rmSync(this.temporary, { recursive: true, force: true });
  }
  async finish() {
    if (this.pending.length || !this.samples) throw new Error('Incomplete or empty PCM analysis');
    if (this.count) this.flushWindow();
    this.flushBuffer(); fs.closeSync(this.fd); this.fd = undefined;
    const levels: { step: number; count: number }[] = [];
    let input = this.temporary + '/features.bin', stride = 20, factor = 1, count = this.records, step = windowSeconds;
    for (let level = 0; ; level++) {
      const output = this.temporary + `/level-${level}.bin`;
      const fd = fs.openSync(output, 'w');
      let remainder = Buffer.alloc(0), peak = 0, n = 0;
      const buffer = Buffer.alloc(65536); let used = 0;
      const emit = () => { buffer.writeFloatLE(peak, used); used += 4; peak = 0; n = 0; if (used === buffer.length) { fs.writeSync(fd, buffer); used = 0; } };
      try {
        for await (const chunk of fs.createReadStream(input)) {
          const data = Buffer.concat([remainder, chunk as Buffer]);
          const end = data.length - data.length % stride;
          for (let i = 0; i < end; i += stride) { peak = Math.max(peak, data.readFloatLE(i)); if (++n === factor) emit(); }
          remainder = data.subarray(end);
        }
        if (n) emit();
        if (used) fs.writeSync(fd, buffer.subarray(0, used));
      } finally { fs.closeSync(fd); }
      count = Math.ceil(count / factor);
      levels.push({ step, count });
      if (count <= 1) break;
      input = output; stride = 4; factor = 4; step *= 4;
    }
    const manifest = { version: 1, signature: signature(this.audio), directory: this.temporary, duration: this.samples / 16000, windowSeconds, levels };
    const target = this.audio + '.analysis.json';
    const completedManifest = `${target}.tmp-${randomUUID()}`;
    fs.writeFileSync(completedManifest, JSON.stringify(manifest));
    // The same-directory rename is the atomic commit point. Until analysis has
    // fully succeeded, the previous generation remains readable.
    try { fs.renameSync(completedManifest, target); }
    finally { if (fs.existsSync(completedManifest)) fs.unlinkSync(completedManifest); }
    // Keep old generations: in-flight readers may still use them; project purge removes them.
    return manifest;
  }
}
export function readManifest(audio: string) {
  try {
    const m = JSON.parse(fs.readFileSync(audio + '.analysis.json', 'utf8'));
    return m.version === 1 && m.signature === signature(audio) ? m : null;
  } catch { return null; }
}
const pending = new Map<string, Promise<any>>();
async function analyzePcm(audio: string) {
  const initial = signature(audio);
  const fd = fs.openSync(audio, 'r');
  let start = 0, length = 0, rf64Length = 0;
  try {
    const head = Buffer.alloc(12); fs.readSync(fd, head, 0, 12, 0);
    if (!['RIFF', 'RF64'].includes(head.toString('ascii', 0, 4)) || head.toString('ascii', 8) !== 'WAVE') throw new Error('Analysis requires a PCM WAV preview');
    const size = fs.fstatSync(fd).size;
    let formatValid = false;
    for (let pos = 12; pos + 8 <= size;) {
      const h = Buffer.alloc(8); fs.readSync(fd, h, 0, 8, pos);
      const id = h.toString('ascii', 0, 4); let n = h.readUInt32LE(4);
      if (id === 'ds64') { const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, pos + 8); rf64Length = Number(b.readBigUInt64LE(8)); }
      if (id === 'fmt ') { const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, pos + 8); formatValid = b.readUInt16LE(0) === 1 && b.readUInt16LE(2) === 1 && b.readUInt32LE(4) === 16000 && b.readUInt16LE(14) === 16; }
      if (id === 'data') { if (!formatValid) throw new Error('Unsupported preview PCM format'); start = pos + 8; length = n === 0xffffffff ? rf64Length : n; if (start + length > size) throw new Error('Truncated PCM preview'); break; }
      pos += 8 + n + n % 2;
    }
  } finally { fs.closeSync(fd); }
  if (!length) throw new Error('Preview has no PCM samples');
  const collector = new PcmAnalysis(audio);
  try {
    for await (const chunk of fs.createReadStream(audio, { start, end: start + length - 1 })) collector.push(chunk as Buffer);
    if (signature(audio) !== initial) throw new Error('Preview changed during waveform analysis');
    return await collector.finish();
  } catch (e) { collector.abort(); throw e; }
}

export function rebuildAnalysis(audio: string) {
  if (pending.has(audio)) return pending.get(audio)!;
  const work = analyzePcm(audio).finally(() => pending.delete(audio));
  pending.set(audio, work);
  return work;
}

// Legacy cache backfill reads the existing PCM WAV, never decodes the book again.
export function ensureAnalysis(audio: string) {
  const cached = readManifest(audio);
  if (cached) return Promise.resolve(cached);
  if (pending.has(audio)) return pending.get(audio)!;
  const work = analyzePcm(audio).finally(() => pending.delete(audio));
  pending.set(audio, work); return work;
}
export async function waveformSlice(audio: string, start: number, duration: number, pixels: number) {
  const m = await ensureAnalysis(audio);
  let level = 0;
  while (level + 1 < m.levels.length && m.levels[level + 1].step <= duration / pixels) level++;
  const { step, count } = m.levels[level];
  const first = Math.min(count, Math.floor(start / step));
  const end = Math.min(count, Math.ceil((start + duration) / step));
  const buffer = Buffer.alloc(Math.max(0, end - first) * 4);
  const fd = await fs.promises.open(m.directory + `/level-${level}.bin`, 'r');
  try { await fd.read(buffer, 0, buffer.length, first * 4); } finally { await fd.close(); }
  return { start: first * step, step, duration: m.duration, peaks: Array.from({ length: buffer.length / 4 }, (_, i) => buffer.readFloatLE(i * 4)) };
}
