import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export function energyEnvelope(pcm: Buffer): number[] {
  const samplesPerFrame = 4000; // half a second at 8 kHz
  const frames: number[] = [];
  for (let offset = 0; offset + samplesPerFrame * 2 <= pcm.length; offset += samplesPerFrame * 2) {
    let sum = 0;
    for (let sample = 0; sample < samplesPerFrame; sample++) {
      const value = pcm.readInt16LE(offset + sample * 2) / 32768;
      sum += value * value;
    }
    frames.push(Math.log10(Math.sqrt(sum / samplesPerFrame) + 1e-5));
  }
  return frames;
}

export async function sampledEnvelope(ffmpeg: string, file: string, duration: number): Promise<number[][]> {
  const starts = duration < 95 ? [0] : [0, Math.max(0, duration / 2 - 15), Math.max(0, duration - 30)];
  const vectors: number[][] = [];
  for (const start of starts) {
    const { stdout } = await run(ffmpeg, ['-v', 'error', '-ss', String(start), '-i', file, '-map', '0:a:0', '-t', '30', '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'],
      { encoding: 'buffer', windowsHide: true, timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
    vectors.push(energyEnvelope(stdout as Buffer));
  }
  return vectors;
}

// Compare speech activity patterns with tolerance for encoder delay. This is
// evidence for review, never a claim that two encodes are bit-identical.
export function envelopeConfidence(left: number[][], right: number[][]): number {
  if (!left.length || left.length !== right.length) return 0;
  const scores = left.map((a, index) => {
    const b = right[index];
    if (Math.min(a.length, b.length) < 12) return 0;
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    let best = 0;
    for (let shift = -2; shift <= 2; shift++) {
      const pairs = a.map((value, i) => [value, b[i + shift]]).filter((pair): pair is number[] => pair[1] !== undefined);
      if (pairs.length < 12) continue;
      const x = pairs.map(pair => pair[0]), y = pairs.map(pair => pair[1]);
      const mx = mean(x), my = mean(y);
      const numerator = x.reduce((sum, value, i) => sum + (value - mx) * (y[i] - my), 0);
      const vx = x.reduce((sum, value) => sum + (value - mx) ** 2, 0);
      const vy = y.reduce((sum, value) => sum + (value - my) ** 2, 0);
      if (vx < 0.1 || vy < 0.1) continue; // Silence or constant test tones.
      best = Math.max(best, Math.max(0, numerator / Math.sqrt(vx * vy)));
    }
    return best;
  });
  return Math.min(...scores);
}
