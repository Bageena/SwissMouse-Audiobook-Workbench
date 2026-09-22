// Shared, side-effect-free transcription policy for the API, UI and tests.
export type TranscriptionBackend = 'faster-whisper' | 'openai-whisper';
export type BatchSetting = 'off' | 'auto' | 1 | 2 | 4 | 8 | 16;
export interface TranscriptionSettings {
  device: 'auto' | 'cpu';
  language: string;
  batching: BatchSetting;
  beamSize?: number;
}
export interface BackendCapabilities {
  engine: TranscriptionBackend;
  installed: boolean;
  version?: string;
  runtimeVersion?: string;
  gpuDetected: boolean;
  gpuAvailable: boolean;
  cudaBuilt?: boolean;
  cudaVersion?: string;
  deviceCount: number;
  cpuComputeTypes: string[];
  gpuComputeTypes: string[];
  supportsBatching: boolean;
  freeMemoryMb?: number;
  initialization: 'not-tested' | 'verified' | 'failed';
  reason?: string;
}
export interface TranscriptionAttempt { device: 'cpu' | 'cuda'; computeType: string; batchSize: number | null }
export function transcriptionSettings(engine: TranscriptionBackend, input: unknown = {}): TranscriptionSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid transcription settings');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['device', 'language', 'batching', 'beamSize'].includes(key))) throw new Error('Unsupported transcription setting');
  const device = value.device ?? 'auto', language = value.language ?? 'en', batching = value.batching ?? 'off';
  if (!['auto', 'cpu'].includes(String(device))) throw new Error('Device must be Auto or CPU');
  if (typeof language !== 'string' || !/^[a-z]{2,3}$/.test(language)) throw new Error('Language must be a two or three letter code');
  if (!['off', 'auto', 1, 2, 4, 8, 16].includes(batching as any)) throw new Error('Unsupported batch size');
  if (engine === 'openai-whisper' && (value.beamSize !== undefined || batching !== 'off')) throw new Error('Regular Whisper uses its original decoding defaults; beam and GPU batching controls apply only to Faster Whisper');
  const beamSize = engine === 'faster-whisper' ? value.beamSize ?? 5 : undefined;
  if (beamSize !== undefined && (!Number.isInteger(beamSize) || Number(beamSize) < 1 || Number(beamSize) > 5)) throw new Error('Beam size must be an integer from 1 to 5');
  if (device === 'cpu' && batching !== 'off') throw new Error('Experimental batching requires GPU processing; turn batching Off for CPU');
  return { device: device as 'auto' | 'cpu', language, batching: batching as BatchSetting, ...(beamSize === undefined ? {} : { beamSize: Number(beamSize) }) };
}
// Advisory headroom, not a promise that model allocation will fit. Unknown memory
// permits only batch 1. Runtime OOM recovery remains authoritative.
export function supportedBatchSizes(capability: BackendCapabilities, model: string): number[] {
  if (capability.engine !== 'faster-whisper' || !capability.gpuAvailable || !capability.supportsBatching) return [];
  const budget = (capability.freeMemoryMb ?? 0) - 1024;
  const base = model === 'large-v3' ? 4608 : model.includes('turbo') ? 3072 : model.startsWith('medium') ? 2560 : model.startsWith('small') ? 1536 : 768;
  const perBatch = model.startsWith('large') ? 512 : model.startsWith('medium') ? 384 : 256;
  return [1, 2, 4, 8, 16].filter(size => size === 1 || base + size * perBatch <= budget);
}
export function selectTranscriptionAttempt(capability: BackendCapabilities, settings: TranscriptionSettings, model: string): TranscriptionAttempt {
  if (!capability.installed) throw new Error(capability.reason || `${capability.engine} is unavailable`);
  const device = settings.device !== 'cpu' && capability.gpuAvailable ? 'cuda' : 'cpu';
  const types = device === 'cuda' ? capability.gpuComputeTypes : capability.cpuComputeTypes;
  const preferred = capability.engine === 'faster-whisper'
    ? device === 'cuda' ? ['float16', 'int8_float16', 'float32', 'int8_float32', 'int8'] : ['int8', 'int8_float32', 'float32']
    : device === 'cuda' ? ['float16', 'float32'] : ['float32'];
  const computeType = preferred.find(type => types.includes(type));
  if (!computeType) throw new Error(`No supported ${device.toUpperCase()} compute type for ${capability.engine}`);
  let batchSize: number | null = null;
  if (settings.batching !== 'off') {
    const sizes = supportedBatchSizes(capability, model);
    if (device !== 'cuda' || !sizes.length) throw new Error('Experimental GPU Batching is unavailable for this backend/runtime. Turn batching Off to use CPU.');
    if (settings.batching === 'auto') batchSize = Math.min(4, sizes[sizes.length - 1]);
    else {
      if (!sizes.includes(settings.batching)) throw new Error(`Batch ${settings.batching} exceeds the conservative memory choices for this model; select Auto or a smaller batch`);
      batchSize = settings.batching;
    }
  }
  return { device, computeType, batchSize };
}
export function capabilityLabel(capability: BackendCapabilities, device: 'auto' | 'cpu' = 'auto'): string {
  if (device === 'cpu') return 'CPU processing selected';
  if (capability.gpuAvailable) return 'GPU acceleration available';
  if (capability.gpuDetected && capability.cudaBuilt === false) return 'GPU detected, but this backend/runtime is CPU-only';
  return 'GPU acceleration unavailable';
}
