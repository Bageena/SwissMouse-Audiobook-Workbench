import fs from 'node:fs';
import { pcmDataRange } from './audio-analysis';
import type { MusicEvidence } from './music-transitions';

const db = (rms: number) => 20 * Math.log10(Math.max(rms, 1e-6));
function rms(pcm: Buffer): number {
  let sum = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) sum += (pcm.readInt16LE(i) / 32768) ** 2;
  return Math.sqrt(sum / Math.max(1, pcm.length / 2));
}

/** Read only bounded PCM windows; thresholds are relative to this recording. */
export async function addGapAudioContext(audio: string, features: MusicEvidence[], signal?: AbortSignal): Promise<MusicEvidence[]> {
  if (!features.length) return [];
  const range = pcmDataRange(audio), duration = range.length / 32000;
  const file = await fs.promises.open(audio, 'r');
  const read = async (start: number, end: number) => {
    const first = Math.round(Math.max(0, start) * 16000), last = Math.round(Math.min(duration, end) * 16000);
    const buffer = Buffer.alloc(Math.max(0, last - first) * 2);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, range.start + first * 2);
    if (bytesRead !== buffer.length) throw new Error('Incomplete chapter context audio read');
    return buffer;
  };
  try {
    const result: MusicEvidence[] = [];
    for (const feature of features) {
      signal?.throwIfAborted();
      const margin = Math.min(.25, (feature.end - feature.start) / 4);
      const interior = await read(feature.start + margin, feature.end - margin);
      const before = await read(feature.start - 3, feature.start);
      const after = await read(feature.end, feature.end + 3);
      const context = Buffer.concat([before, after]);
      const levels: number[] = [];
      for (let offset = 0; offset + 2048 <= context.length; offset += 3200) levels.push(rms(context.subarray(offset, offset + 2048)));
      levels.sort((a, b) => a - b);
      const interiorDb = db(rms(interior)), speechDb = db(rms(context));
      const floorDb = db(levels[Math.floor(levels.length * .05)] || 0);
      const speechContrastDb = interiorDb - speechDb, backgroundContrastDb = interiorDb - floorDb;
      // Low-level room tone must not acquire musical significance by normalization.
      const backgroundRejection = interiorDb <= -84 ? 'No meaningful audio above the PCM noise floor'
        : speechDb > -80 && speechContrastDb < -20 ? 'Gap audio is more than 20 dB below surrounding narration'
        : backgroundContrastDb < 6 ? 'Gap audio does not rise 6 dB above the surrounding background'
        : undefined;
      result.push({ ...feature, speechContrastDb, backgroundContrastDb, backgroundRejection });
    }
    return result;
  } finally { await file.close(); }
}
