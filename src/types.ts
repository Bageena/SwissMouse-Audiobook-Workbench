export type { AudiobookMetadata,ChapterEntry,CoverArtInfo,HeadingType,MetadataMembership,PipelineResultStep,PipelineStepState,PipelineStepStatus,RerunnablePipelineStep } from '../packages/audiobooks/src/domain';
export type { AlignedWord,AudiobookJob,AudioMergeMethodType,AudioPart,AudioVerificationReport,ChapterCandidate,ChapterSourceType,DiscoveredAudioFile,DiscoveredMp3File,FinalCheckItem,FinalCheckReport,FolderScanResult,JobLog,LibraryBook,OutputAudioFormat,SourceSummaryData,Step1InputMethod,UnsupportedFileItem,ValidationReport,YouTubeAudioFormat,YouTubeVideoInfo } from '../packages/audiobooks/src/legacy-domain';
export type { SpeechModelInfo,Step1ProcessStage,Step1ProcessState,Step1ProgressStage } from '../packages/audiobooks/src/processing-state';
import type { BackendCapabilities,TranscriptionBackend } from './transcription';
export interface WorkbenchConfig {
  player_ambient_glow?: boolean;
  audiobookshelf_metadata?: boolean;
  save_cover_beside_audio?: boolean;
  quick_tags?: string[];
  pcm_retention?: 'after_verified_export' | 'until_finalized' | 'keep';
  inbox_folder?: string;
  library_folder?: string;
  library_template?: string;
  detect_musical_transitions?: boolean;
  faster_transcription: boolean;
  selected_model: string;
  ffmpeg_path: string;
  ffprobe_path: string;
  whisper_profile: 'turbo' | 'accurate' | 'cpu';
  profiles: {
    turbo: {
      model: string;
      language: string;
      device_preference: string;
      compute_type_cuda: string;
      compute_type_cpu: string;
      batch_size_cuda: number;
      batch_size_cpu: number;
      alignment: boolean;
    };
    accurate: {
      model: string;
      language: string;
      device_preference: string;
      compute_type_cuda: string;
      compute_type_cpu: string;
      batch_size_cuda: number;
      batch_size_cpu: number;
      alignment: boolean;
    };
    cpu: {
      model: string;
      language: string;
      device_preference: string;
      compute_type_cpu: string;
      batch_size_cpu: number;
      alignment: boolean;
    };
  };
  m4b_settings: {
    audio_codec: string;
    bitrate_mono: string;
    bitrate_stereo: string;
    sample_rate: number;
  };
  lead_in_seconds: number; // Maximum lead-in, refined to an existing Whisper word timestamp.
}

export interface HardwareInfo {
  mode: 'gpu' | 'cpu';
  gpuName?: string;
  vramGb?: number;
  cpuModel?: string;
  recommendedModelId: string;
}



export type YtDlpStatusState = 'installed' | 'not_installed' | 'updating' | 'downloading' | 'error' | 'unknown';

export interface YtDlpStatusInfo {
  status: YtDlpStatusState;
  version?: string;
  executablePath: string;
  isSystemInstalled: boolean;
  ffmpegAvailable: boolean;
  ffmpegVersion?: string;
  ffprobeAvailable: boolean;
  ffprobeVersion?: string;
  error?: string;
  lastCheckedAt: string;
  updateAvailable?: boolean;
  latestVersion?: string;
}

// ----------------------------------------------------
// Requirements & Base Components Types
// ----------------------------------------------------
export type ComponentStatus =
  | 'ready'
  | 'update_available'
  | 'missing'
  | 'broken'
  | 'checking'
  | 'installing'
  | 'updating'
  | 'repairing'
  | 'error';

export type ComponentClassification = 'required' | 'recommended' | 'optional';
export type RequirementGroup = 'core' | 'active_transcription' | 'optional_acceleration' | 'compatibility';

export interface BaseRequirementItem {
  id: string;
  name: string;
  purpose: string;
  classification: ComponentClassification;
  group?: RequirementGroup;
  status: ComponentStatus;
  installedVersion?: string;
  availableVersion?: string;
  updateAvailable?: boolean;
  installLocation?: string;
  isAppManaged: boolean;
  source?: 'system' | 'app';
  managedInstalled?: boolean;
  managedLocation?: string;
  canUninstall?: boolean;
  uninstallImpact?: string;
  error?: string;
  diagnosticDetails?: string;
}

export interface HardwareEnvironmentInfo {
  os: string;
  platform: string;
  arch: string;
  cpuModel: string;
  hasNvidiaGpu: boolean;
  gpuName?: string;
  vramGb?: number;
  cudaVersion?: string;
  driverVersion?: string;
  computeCapability?: number;
  mode: 'gpu' | 'cpu';
  recommendedPyTorchFlavor: 'cuda' | 'cpu';
  recommendationSummary: string;
}

export interface RequirementsReport {
  runtimeMode?: 'hybrid' | 'managed';
  runtimeWarnings?: string[];
  timestamp: string;
  allReady: boolean;
  statusColor: 'red' | 'yellow' | 'green';
  needsAttentionCount: number;
  summaryMessage: string;
  hardware: HardwareEnvironmentInfo;
  components: BaseRequirementItem[];
  availableUpdatesCount: number;
  backendCapabilities?: Partial<Record<TranscriptionBackend, BackendCapabilities>>;
  pytorchBuild?: { cudaAvailable: boolean; cudaIndex?: string; reason: string };
}

export interface InstallRepairProgress {
  isActive: boolean;
  phase: 'idle' | 'preparing' | 'in_progress' | 'verifying' | 'completed' | 'cancelled' | 'error';
  currentActivity: string;
  overallProgress: number; // 0 - 100
  currentItemId?: string;
  logs: string[];
  canCancel: boolean;
  error?: string;
  successMessage?: string;
}

// ----------------------------------------------------
// Step 1 Processing Progress & Feedback Types
// ----------------------------------------------------
