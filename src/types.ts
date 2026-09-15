export interface WorkbenchConfig {
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
  lead_in_seconds: number;
}

export interface AudioPart {
  id: string;
  name: string;
  sizeBytes: number;
  durationSeconds: number;
  bitrate: number;
  order: number;
}

export interface AlignedWord {
  word: string;
  start: string; // HH:MM:SS.mmm
  startSeconds: number;
  endSeconds: number;
  confidence?: number;
}

export interface ChapterCandidate {
  candidate_id: number;
  candidate_start: string;
  candidate_end: string;
  matched_text: string;
  context_before: string;
  context_after: string;
  confidence: string;
  proposed_title: string;
  approved_start?: string;
  approved_title?: string;
  status: 'preapproved' | 'review' | 'approved' | 'rejected';
  notes: string;
  words?: AlignedWord[];
}

export interface ChapterEntry {
  id: string;
  start: string; // HH:MM:SS.mmm
  title: string;
  notes?: string;
}

export interface ValidationReport {
  file: string;
  size_mb: number;
  duration_seconds: number;
  chapters_count: number;
  status: 'PASS' | 'WARNING' | 'FAIL';
  reason?: string;
}

export interface CoverArtInfo {
  source: 'local' | 'upload' | 'url';
  url: string; // Data URL or remote/local URL
  filename?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
}

export interface AudiobookMetadata {
  title: string;
  subtitle?: string;
  author: string; // Stored in Artist tag
  narrator: string; // Stored in Composer tag per Audiobookshelf standard
  series?: string; // Stored in Series/Album
  seriesSequence?: string; // Stored in Series-Part / Track
  genres: string[]; // Genres / Tags
  publishedYear?: string; // Release Year (e.g. 2024)
  releaseDate?: string; // Full date if available (YYYY-MM-DD)
  publisher?: string;
  language: string; // e.g. 'eng', 'en', 'spa'
  isbn?: string;
  asin?: string;
  description?: string; // Synopsis / Summary
  abridged: boolean;
  explicit: boolean;
  copyright?: string;
  cover?: CoverArtInfo | null;
}

export interface JobLog {
  timestamp: string;
  level: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
}

export type ChapterSourceType = 'whisperx' | 'existing_files';
export type AudioMergeMethodType = 'standard' | 'quick';
export type Step1InputMethod = 'folder' | 'youtube';
export type OutputAudioFormat = 'm4b' | 'm4a' | 'mp3' | 'flac' | 'opus' | 'wav';
export type YouTubeAudioFormat = 'best' | 'm4a' | 'mp3' | 'flac' | 'opus' | 'wav';

export interface HardwareInfo {
  mode: 'gpu' | 'cpu';
  gpuName?: string;
  vramGb?: number;
  cpuModel?: string;
  recommendedModelId: string;
}

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
}

export interface SourceSummaryData {
  inputMethod: Step1InputMethod;
  sourcePath: string;
  totalFiles: number;
  totalDurationSeconds: number;
  totalSizeBytes?: number;
  formatsDetected: string[];
  hasNestedChapters?: boolean;
  streamCopyCompatible?: boolean;
  incompatibilityReason?: string;
  chapterWorkflow?: ChapterSourceType;
  mergeMethod?: AudioMergeMethodType;
}

export interface DiscoveredAudioFile {
  relativePath: string;
  fileName: string;
  folderName: string;
  format?: string; // 'mp3', 'm4a', 'm4b', 'ogg', 'opus', 'flac', 'wav', 'aiff', 'wma', 'alac'
  codec?: string;
  sizeBytes: number;
  durationSeconds: number;
  sampleRate?: number;
  channels?: number;
  bitrate?: number;
  chapterGroup?: string;
  isProbed?: boolean;
}

// Backward compatibility alias
export type DiscoveredMp3File = DiscoveredAudioFile;

export interface UnsupportedFileItem {
  fileName: string;
  relativePath: string;
  reason: string;
  sizeBytes?: number;
}

export interface FolderScanResult {
  sourcePath: string;
  totalFiles: number;
  hasNestedChapterFolders: boolean;
  chapterFoldersCount: number;
  files: DiscoveredAudioFile[];
  unsupportedFiles?: UnsupportedFileItem[];
  formatsDetected: string[];
  isUniformFormat: boolean;
  isStreamCopyCompatible: boolean;
  streamCopyIncompatibilityReason?: string;
}

export interface YouTubeVideoInfo {
  url: string;
  title: string;
  uploader: string;
  uploaderUrl?: string;
  durationSeconds: number;
  durationFormatted: string;
  thumbnailUrl?: string;
  description?: string;
  audioBitrate?: string;
  audioCodec?: string;
  fileSizeEstimateBytes?: number;
  availableFormats?: string[];
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

export interface AudiobookJob {
  id: string;
  name: string;
  author?: string;
  narrator?: string;
  metadata?: AudiobookMetadata;
  createdAt: string;
  parts: AudioPart[];
  totalDurationSeconds: number;
  totalSizeBytes: number;
  status: 'draft' | 'merged' | 'transcribed' | 'metadata_ready' | 'built' | 'validated';
  
  // Step 1 Local Processing Options & Input Methods
  inputMethod?: Step1InputMethod;
  sourceFolderPath?: string;
  outputFolderPath?: string;
  chapterSource?: ChapterSourceType;
  mergeMethod?: AudioMergeMethodType;
  selectedModelId?: string;
  hasNestedChapterFolders?: boolean;
  discoveredFiles?: DiscoveredAudioFile[];
  unsupportedFiles?: UnsupportedFileItem[];
  detectedFormats?: string[];
  isStreamCopyCompatible?: boolean;
  streamCopyIncompatibilityReason?: string;

  // YouTube audio import state
  youtubeUrl?: string;
  youtubeInfo?: YouTubeVideoInfo;
  youtubeVideoInfo?: YouTubeVideoInfo;
  youtubeAudioFormat?: YouTubeAudioFormat;
  downloadedAudioFile?: string;
  sourceSummary?: SourceSummaryData;

  // Output format selection
  outputAudioFormat?: OutputAudioFormat;

  mergedMp3?: {
    filename: string;
    duration: number;
    bitrate: number;
    sizeBytes: number;
    fullPath?: string;
  } | null;

  transcription?: {
    model: string;
    profile: string;
    language: string;
    segmentsCount: number;
    wordsCount: number;
    completedAt: string;
  } | null;

  // Persisted word-level timestamps from completed WhisperX output. Chapter
  // Review renders these actual words and never invents transcript text.
  transcriptWords?: AlignedWord[];

  candidates: ChapterCandidate[];
  chapters: ChapterEntry[];
  
  ffmetaContent?: string;
  
  outputM4b?: {
    filename: string;
    duration: number;
    sizeBytes: number;
    bitrate: string;
    chaptersCount: number;
    codec: string;
    format?: OutputAudioFormat;
  } | null;

  validation?: ValidationReport | null;
  logs: JobLog[];
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

export type ComponentClassification = 'required' | 'optional';

export interface BaseRequirementItem {
  id: string;
  name: string;
  purpose: string;
  classification: ComponentClassification;
  status: ComponentStatus;
  installedVersion?: string;
  availableVersion?: string;
  updateAvailable?: boolean;
  installLocation?: string;
  isAppManaged: boolean;
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
  mode: 'gpu' | 'cpu';
  recommendedPyTorchFlavor: 'cuda' | 'cpu';
  recommendationSummary: string;
}

export interface RequirementsReport {
  timestamp: string;
  allReady: boolean;
  statusColor: 'red' | 'yellow' | 'green';
  needsAttentionCount: number;
  summaryMessage: string;
  hardware: HardwareEnvironmentInfo;
  components: BaseRequirementItem[];
  availableUpdatesCount: number;
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
  | 'saving_project'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface Step1ProcessState {
  isActive: boolean;
  stage: Step1ProcessStage;
  label: string; // e.g. "Processing audiobook source…"
  currentTask: string;
  currentStageNumber: number;
  totalStages: number;
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
