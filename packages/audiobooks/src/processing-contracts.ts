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
