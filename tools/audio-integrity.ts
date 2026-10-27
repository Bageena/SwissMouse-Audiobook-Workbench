import { spawn } from 'node:child_process';
import type { AudioVerificationReport } from '../src/types';
export type AudioVerification = AudioVerificationReport;

/** Stream packet observations: bounded memory even for a multi-day recording. */
export class PacketTimeline {
  private previousDts = -Infinity;
  private previousEnd: number | undefined;
  private first = Infinity;
  private last = -Infinity;
  private count = 0;
  private issue = '';
  read(line: string) {
    if (!line.trim()) return;
    const fields = Object.fromEntries(line.trim().split('|').map(part => part.split('=')));
    // ffprobe can emit separate side-data continuation lines; they are not packets.
    if (!['pts_time', 'dts_time', 'duration_time'].some(key => key in fields)) return;
    this.count++;
    const number = (value: string | undefined) => value?.trim() ? Number(value) : NaN;
    const pts = number(fields.pts_time), dts = number(fields.dts_time), duration = number(fields.duration_time);
    if (!Number.isFinite(pts) || !Number.isFinite(dts) || !Number.isFinite(duration) || duration <= 0) {
      this.issue ||= `Packet ${this.count}: missing or invalid PTS, DTS, or packet duration.`; return;
    }
    if (dts < this.previousDts) this.issue ||= `Packet ${this.count} at ${pts.toFixed(3)}s: DTS moves backward (${this.previousDts} to ${dts}).`;
    if (this.previousEnd !== undefined && Math.abs(pts - this.previousEnd) > .1 + 1e-6) {
      this.issue ||= `Packet ${this.count} at ${pts.toFixed(3)}s: timestamp ${pts > this.previousEnd ? 'gap' : 'overlap'} of ${Math.abs(pts - this.previousEnd).toFixed(3)}s (limit 0.100s).`;
    }
    this.first = Math.min(this.first, pts); this.last = Math.max(this.last, pts + duration);
    this.previousDts = dts; this.previousEnd = pts + duration;
  }
  finish() {
    if (this.issue) throw new Error(this.issue + ' Use PCM normalization.');
    if (!this.count || !Number.isFinite(this.last - this.first)) throw new Error('No readable audio packet timestamps were found.');
    return { packetCount: this.count, encodedDurationSeconds: this.last - this.first };
  }
}

function runInspection(tool: string, args: string[], signal?: AbortSignal, read?: (chunk: string) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(tool, args, { windowsHide: true, signal, stdio: ['ignore', read ? 'pipe' : 'ignore', 'pipe'] });
    let stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 2 * 60 * 60 * 1000);
    timer.unref();
    child.stdout?.setEncoding('utf8'); child.stdout?.on('data', chunk => read?.(chunk));
    child.stderr?.setEncoding('utf8'); child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('Audio inspection exceeded its two-hour per-file limit.'));
      else if (code !== 0 || stderr.trim()) reject(new Error(stderr.trim() || `Audio tool exited with code ${code}.`));
      else resolve();
    });
  });
}

export async function inspectPacketTimeline(ffprobe: string, file: string, signal?: AbortSignal) {
  const timeline = new PacketTimeline();
  let pending = '';
  await runInspection(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_entries', 'packet=pts_time,dts_time,duration_time', '-of', 'compact=p=0', file], signal, chunk => {
    pending += chunk;
    const lines = pending.split('\n'); pending = lines.pop() || '';
    lines.forEach(line => timeline.read(line));
  });
  if (pending) timeline.read(pending);
  return timeline.finish();
}

export async function checkSourceAudio(ffmpeg: string, ffprobe: string, file: string, signal?: AbortSignal, progress: (message: string) => void = () => {}): Promise<AudioVerification> {
  const report: AudioVerification = { checkedAt: new Date().toISOString(), decoding: 'failed', timestamps: 'failed', issues: [] };
  signal?.throwIfAborted();
  progress('Checking full audio decoding');
  try {
    await runInspection(ffmpeg, ['-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', file, '-map', '0:a:0', '-f', 'null', '-'], signal);
    report.decoding = 'passed';
  } catch (error) { signal?.throwIfAborted(); report.issues.push(`Decoding failed: ${error instanceof Error ? error.message : String(error)}`); }
  progress('Checking all packet PTS/DTS and continuity');
  try { Object.assign(report, await inspectPacketTimeline(ffprobe, file, signal)); report.timestamps = 'passed'; }
  catch (error) { signal?.throwIfAborted(); report.issues.push(`Timestamp verification failed: ${error instanceof Error ? error.message : String(error)}`); }
  return report;
}
