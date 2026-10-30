/** Compatibility adapter retaining the legacy default source fingerprint. */
import { fingerprint } from './audio-engine';
import { sourceProcessingKeys as keys } from '../packages/audiobooks/src/transcription-cache';
export { processingKey, preparationKey, transcriptionRequestKey, transcriptionResultKey, reusableTranscription } from '../packages/audiobooks/src/transcription-cache';
export const sourceProcessingKeys = (files: string[], mergeMethod: string, hash = fingerprint) => keys(files, mergeMethod, hash);
