import type { AudiobookJob, OutputAudioFormat } from '../types';

export function conversionComplete(exports: AudiobookJob['exports'], selected: OutputAudioFormat[], building: boolean, error?: string | null): boolean {
  return !building && !error && selected.length > 0 && !!exports?.length &&
    exports.every(item => item.status === 'success') && selected.every(format => exports.some(item => item.format === format && item.status === 'success'));
}
