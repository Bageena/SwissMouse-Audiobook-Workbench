import { createHash } from 'node:crypto';
import { fingerprint } from './audio-engine';
import type { BackendCapabilities, TranscriptionAttempt, TranscriptionSettings } from '../src/transcription';

function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]));
  return value;
}
export function processingKey(stage: string, sourceKey: string, settings: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable({ version: 2, stage, sourceKey, settings }))).digest('hex');
}
export function preparationKey(sourceKey: string, mergeMethod: string): string {
  return processingKey('audio-preparation', sourceKey, { mergeMethod });
}
export async function sourceProcessingKeys(files: string[], mergeMethod: string, hash = fingerprint) {
  // Keep the existing source hash format so export integrity checks remain valid.
  const sourceKey = await hash(files, {});
  return { sourceKey, preparedAudioKey: preparationKey(sourceKey, mergeMethod) };
}
export function transcriptionRequestKey(preparedAudioKey: string, model: string, settings: TranscriptionSettings, capability: BackendCapabilities, attempt: TranscriptionAttempt): string {
  return processingKey('transcription', preparedAudioKey, {
    engine: capability.engine, engineVersion: capability.version, runtimeVersion: capability.runtimeVersion,
    model, language: settings.language, devicePreference: settings.device, batching: settings.batching,
    beamSize: settings.beamSize ?? 'native-whisper-default', initialAttempt: attempt,
    wordTimestamps: true, decodingPolicy: 1,
  });
}
export function transcriptionResultKey(requestKey: string, actual: { engine?: string; device?: string; computeType?: string; batchSize?: number | null; beamSize?: number }): string {
  return processingKey('transcription-result', requestKey, {
    engine: actual.engine, device: actual.device, computeType: actual.computeType,
    batchSize: actual.batchSize ?? null, beamSize: actual.beamSize ?? 'native-whisper-default',
  });
}
export function reusableTranscription(job: { transcriptKey?: string; transcription?: ({ requestKey?: string } & Parameters<typeof transcriptionResultKey>[1]) | null; transcriptSegments?: unknown[] }, requestKey: string): boolean {
  return !!job.transcription && Array.isArray(job.transcriptSegments) && job.transcription.requestKey === requestKey && job.transcriptKey === transcriptionResultKey(requestKey, job.transcription);
}
