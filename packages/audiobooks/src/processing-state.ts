import type { RerunnablePipelineStep } from './domain';
export interface SpeechModelInfo {
  id: string; // 'tiny', 'base', 'small', 'medium', 'large-v3-turbo', 'large-v3'
  name: string;
  sizeLabel: string;
  vramRequirementGb: number;
  requiresGpu: boolean;
  category: 'lightweight' | 'balanced' | 'high-accuracy';
  isInstalled: boolean;
  isDownloading?: boolean;
  downloadProgress?: number; // 0 to 100
  downloadSpeed?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  sizeOnDiskBytes?: number;
  sizeOnDiskLabel?: string;
  installedFile?: string;
  downloadError?: string;
  description: string;
  backend?: 'faster-whisper' | 'openai-whisper';
}

export type Step1ProcessStage =
  | 'idle'
  | 'initializing'
  | 'scanning_folder'
  | 'probing_media'
  | 'downloading_youtube'
  | 'merging_audio'
  | 'normalizing_pcm'
  | 'loading_model'
  | 'transcribing_whisper'
  | 'aligning_timestamps'
  | 'extracting_chapters'
  | 'generating_waveform'
  | 'detecting_chapters'
  | 'saving_project'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface Step1ProgressStage {
  key: Step1ProcessStage;
  label: string;
  desc: string;
}

export interface Step1ProcessState {
  jobId?: string;
  rerunStep?: RerunnablePipelineStep;
  isActive: boolean;
  stage: Step1ProcessStage;
  label: string; // e.g. "Processing audiobook source…"
  currentTask: string;
  currentStageNumber: number;
  totalStages: number;
  stages: Step1ProgressStage[];
  failedStage?: Step1ProcessStage | null;
  currentCount?: number;
  totalCount?: number;
  percentage: number; // 0 - 100
  isDeterminate: boolean;
  elapsedSeconds: number;
  estimatedRemainingSeconds?: number | null;
  liveStatusMessage: string;
  logs: string[];
  canCancel: boolean;
  isCancelling?: boolean;
  error?: string | null;
  summary?: any | null;
}

export function createAudiobookProcessingState() {
  return {
    running: false, abort: undefined as AbortController | undefined, jobId: null as string | null, startedAt: 0, progress: {
      isActive: false,
      stage: 'idle',
      label: 'Ready to process audiobook source',
      currentTask: 'Idle',
      currentStageNumber: 0,
      totalStages: 6,
      stages: [],
      failedStage: null,
      percentage: 0,
      isDeterminate: true,
      elapsedSeconds: 0,
      liveStatusMessage: 'No active processing task.',
      logs: [],
      canCancel: false,
      isCancelling: false,
      error: null,
      summary: null,
    } as Step1ProcessState
  };
}
