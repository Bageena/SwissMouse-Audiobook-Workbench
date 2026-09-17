export const outputFormats = ['m4b', 'm4a', 'mp3', 'flac', 'ogg', 'opus', 'wav'] as const;
export type ExportFormat = typeof outputFormats[number];
export const bitrateOptions = [32, 64, 96, 128, 192, 256, 320] as const;
export function defaultBitrate(sourceKbps?: number): number {
  if (!sourceKbps || !Number.isFinite(sourceKbps)) return 96;
  return [...bitrateOptions].reverse().find(rate => rate <= sourceKbps) || 32;
}
export interface StitchStream {
  codec?: string; sampleRate?: number; channels?: number; streamSignature?: string; isProbed?: boolean;
}
export function stitchCompatibility(files: StitchStream[]) {
  if (!files.length || files.some(f => !f.isProbed || !f.streamSignature)) return { compatible: false, reason: 'Scan or re-import the audio to verify its stream parameters.' };
  if (files.length === 1) return { compatible: true, reason: '' };
  if (files.some(f => f.streamSignature !== files[0].streamSignature)) return { compatible: false, reason: 'Container, codec profile, sample format/rate, channels/layout, time base or codec configuration differs. Use PCM normalization.' };
  return { compatible: true, reason: '' };
}
export function canCopy(codec: string, format: string): boolean {
  return ({ m4b: ['aac', 'alac'], m4a: ['aac', 'alac'], mp3: ['mp3'], flac: ['flac'],
    ogg: ['vorbis'], opus: ['opus'], wav: ['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_f64le'] }[format] || []).includes(codec);
}
export const chapterSupport: Record<ExportFormat, string> = {
  m4b: 'Embedded MP4 chapters', m4a: 'Embedded MP4 chapters', mp3: 'ID3 CHAP frames; player support varies',
  flac: 'CHAPTER tags + CUE; player support varies', ogg: 'CHAPTER tags + CUE; player support varies',
  opus: 'CHAPTER tags + CUE; player support varies', wav: 'RIFF cue markers + CUE; not universal audiobook navigation',
};
