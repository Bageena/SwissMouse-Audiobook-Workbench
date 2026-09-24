import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export function sampleRateFloor(sourceRate: number, supported?: number[]): number {
  if (!Number.isSafeInteger(sourceRate) || sourceRate <= 0) throw new Error('Cannot determine a valid source sample rate.');
  if (!supported) return sourceRate; // Encoders without an enumerated rate list accept the input rate.
  const candidates = supported.filter(rate => Number.isSafeInteger(rate) && rate > 0 && rate <= sourceRate);
  if (!candidates.length) throw new Error(`No supported sample rate at or below ${sourceRate} Hz. Choose another output format; automatic upsampling is disabled.`);
  return Math.max(...candidates);
}

export function parseEncoderSampleRates(output: string): number[] | undefined {
  const match = /^\s*Supported sample rates:\s*(.*)$/mi.exec(output);
  if (!match) return undefined;
  const rates = match[1].trim().split(/\s+/).map(Number);
  if (!rates.length || rates.some(rate => !Number.isSafeInteger(rate) || rate <= 0)) throw new Error('Could not read encoder sample-rate capabilities.');
  return rates;
}

// Key by binary identity, not just encoder name; replacing a system build must
// not reuse the old build's capabilities. No encoder probing for stream copy.
const capabilities = new Map<string, Promise<number[] | undefined>>();
export async function encoderSampleRates(ffmpeg: string, encoder: string) {
  const executable = fs.existsSync(ffmpeg) ? ffmpeg : (process.env.PATH || '').split(path.delimiter)
    .map(dir => path.join(dir.replace(/^"|"$/g,''), ffmpeg + (process.platform === 'win32' && !path.extname(ffmpeg) ? '.exe' : ''))).find(file => fs.existsSync(file)) || ffmpeg;
  const stat = fs.statSync(executable);
  const key = `${executable}:${stat.size}:${stat.mtimeMs}:${encoder}`;
  if (!capabilities.has(key)) {
    if (capabilities.size > 32) capabilities.clear();
    const check = run(ffmpeg, ['-hide_banner', '-h', `encoder=${encoder}`], {encoding:'utf8',windowsHide:true,timeout:10000})
      .then(({stdout,stderr}) => {
        const output = stdout + stderr;
        if (!output.includes(`Encoder ${encoder} `)) throw new Error(`Required FFmpeg encoder ${encoder} is unavailable.`);
        return parseEncoderSampleRates(output);
      }).catch(error => {capabilities.delete(key); throw error;});
    capabilities.set(key,check);
  }
  return capabilities.get(key)!;
}

// Ogg Opus has a 48 kHz decoding clock, regardless of the encoder input rate.
// Check its identification packet as well as FFprobe, rather than mislabeling
// a lower-rate encode as a policy violation or pretending playback is 24 kHz.
export function opusInputSampleRate(file: string): number {
  const fd = fs.openSync(file,'r');
  try {
    const header = Buffer.alloc(27);
    if (fs.readSync(fd,header,0,27,0) !== 27 || header.toString('ascii',0,4) !== 'OggS' || header[4] !== 0 || !(header[5] & 2)) throw new Error('Invalid Ogg Opus identification page.');
    const segments=Buffer.alloc(header[26]);
    if (fs.readSync(fd,segments,0,segments.length,27)!==segments.length || !segments.length || segments[0]<19) throw new Error('Missing Opus identification packet.');
    const packet=Buffer.alloc(19);
    if (fs.readSync(fd,packet,0,19,27+segments.length)!==19 || packet.toString('ascii',0,8)!=='OpusHead') throw new Error('Missing OpusHead.');
    return packet.readUInt32LE(12);
  } finally { fs.closeSync(fd); }
}

export function verifyOutputSampleRate(actual: number, selected: number, opusHeaderRate?: number) {
  if (opusHeaderRate !== undefined) {
    if (actual !== 48000 || opusHeaderRate !== selected) throw new Error(`Opus sample-rate verification failed: selected ${selected} Hz; header ${opusHeaderRate} Hz; playback ${actual} Hz.`);
  } else if (actual !== selected) throw new Error(`Output sample-rate verification failed: expected ${selected} Hz, got ${actual} Hz.`);
}
