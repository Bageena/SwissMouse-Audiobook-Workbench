export type TranscriptionEngineId = 'faster-whisper' | 'openai-whisper';

export interface NormalizedWord {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export interface NormalizedSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: NormalizedWord[];
  averageLogProbability?: number;
  noSpeechProbability?: number;
}

export interface NormalizedTranscription {
  engine: TranscriptionEngineId;
  model: string;
  language?: string;
  languageProbability?: number;
  duration?: number;
  device: 'cpu' | 'cuda';
  computeType: string;
  segments: NormalizedSegment[];
  batchSize?: number | null;
  beamSize?: number;
}

export interface TranscriptionRequest {
  localFilesOnly?: boolean;
  localModelFile?: string;
  pythonPath: string;
  audioPath: string;
  outputPath: string;
  modelId: string;
  fasterModelRepository?: string;
  engine: TranscriptionEngineId;
  device: 'cpu' | 'cuda';
  computeType: string;
  fasterCacheDir: string;
  openAiCacheDir: string;
  language?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  batchSize?: number | null;
  beamSize?: number;
}

export interface TranscriptionEngine {
  readonly id: TranscriptionEngineId;
  transcribe(request: TranscriptionRequest): Promise<NormalizedTranscription>;
}
