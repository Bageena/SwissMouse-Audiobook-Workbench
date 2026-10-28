import type { BackendCapabilities, TranscriptionBackend, TranscriptionSettings } from './transcription';
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

export interface AudioPart {
  chapterGroup?: { id: string; title: string };
  sourceRelativePath?: string;
  discNumber?: number;
  trackNumber?: number;
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

export type HeadingType = 'numbered_chapter' | 'numbered_section' | 'front_matter' | 'chapter_like' | 'section_divider' | 'back_matter' | 'music_transition';

export interface ChapterCandidate {
  suggestionOnly?: boolean;
  evidence?: string[];
  parentChapterStart?: string;
  timingSource?: 'transcript' | 'recheck' | 'source';
  transcriptWordIndex?: number;
  headingType?: HeadingType;
  chapterNumber?: number;
  recovered?: boolean;
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
  parentChapterStart?: string;
  timingSource?: 'transcript' | 'recheck' | 'source';
  transcriptWordIndex?: number;
  headingType?: HeadingType;
  chapterNumber?: number;
  recovered?: boolean;
  id: string;
  start: string; // HH:MM:SS.mmm; blank only while a generated placeholder is incomplete
  end?: string; // HH:MM:SS.mmm
  title: string;
  notes?: string;
  isMissing?: boolean;
  startManuallyEdited?: boolean;
  endManuallyEdited?: boolean;
  titleManuallyEdited?: boolean;
  manuallyInserted?: boolean;
}

export interface ValidationReport {
  file: string;
  size_mb: number;
  duration_seconds: number;
  chapters_count: number;
  status: 'PASS' | 'WARNING' | 'FAIL';
  reason?: string;
}

export interface FinalCheckItem {
  id: string;
  label: string;
  status: 'passed' | 'optional' | 'failed';
  detail: string;
  fix?: 'metadata' | 'sidecar' | 'cover' | 'chapters' | 'processing';
}
export interface FinalCheckReport {
  checkedAt: string;
  inputSignature: string;
  state: 'complete' | 'cancelled';
  items: FinalCheckItem[];
  files: { file: string; format: string; duration: number; chapters: number; error?: string }[];
  sourceDuration: number;
  expectedDuration: number;
  removedSeconds: number;
}

export interface CoverArtInfo {
  source: 'local' | 'upload' | 'url' | 'generated';
  design?: import('./utils/coverGenerator').CoverDesign;
  url: string; // Data URL or remote/local URL
  filename?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
}

export interface MetadataMembership { id: string; name: string; sequence?: string; addedAt?: string }

export interface AudiobookMetadata {
  collections?: MetadataMembership[];
  additionalSeries?: MetadataMembership[];
  seriesAddedAt?: string;
  title: string;
  subtitle?: string;
  author: string; // Stored in Artist tag
  narrator: string; // Stored in Composer tag per Audiobookshelf standard
  authors?: string[]; // Preserve people whose names contain commas.
  narrators?: string[];
  series?: string; // Stored in Series/Album
  seriesSequence?: string; // Stored in Series-Part / Track
  edition?: string;
  genres: string[]; // Book genres, separate from subject tags
  tags?: string[]; // Audiobookshelf subject tags
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

export type ChapterSourceType = 'whisperx' | 'existing_files' | 'grouped_files' | 'existing_chapters' | 'manual';
export type AudioMergeMethodType = 'standard' | 'quick' | 'skip';
export type Step1InputMethod = 'folder' | 'youtube' | 'librivox';
export type OutputAudioFormat = 'm4b' | 'm4a' | 'mp3' | 'flac' | 'ogg' | 'opus' | 'wav';
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
  backend?: 'faster-whisper' | 'openai-whisper';
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

export interface AudioVerificationReport {
  checkedAt: string;
  decoding: 'passed' | 'failed';
  timestamps: 'passed' | 'failed';
  packetCount?: number;
  encodedDurationSeconds?: number;
  issues: string[];
}

export interface DiscoveredAudioFile {
  tags?: Record<string, string>;
  discNumber?: number;
  trackNumber?: number;
  storedName?: string;
  streamSignature?: string;
  audioVerification?: AudioVerificationReport;
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
  orderWarning?: string;
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
  /** Personal half-stars (0..10); null is explicitly unrated. Never imported tags. */
  personalRating?: number | null;
  associatedFiles?: { path: string; kind: 'metadata' | 'cover' | 'chapters' | 'sidecar' }[];
  retainedSourceFiles?: { path: string; size: number; mtime: number; identity: string }[];
  originalsArchive?: import('../tools/originals-archive').OriginalsArchive;
  originalsArchiveError?: string;
  sourceMembership?: 'automatic' | 'explicit' | 'confirmed';
  explicitlyAddedSourceFiles?: string[];
  sourceMembershipReview?: string;
  sourceOrderWarning?: string;
  sourceOrderManual?: boolean;
  sourcePathIdentity?: Record<string, string>; // Current relative path -> path used by the processed source fingerprint.
  sourceFileStamps?: Record<string, { sizeBytes: number; modifiedMs: number; device: number; inode: number }>;
  sourceInventory?: DiscoveredAudioFile[]; // Browsing observations; never processing inputs.
  bookScope?: { title: string; directory?: string }; // Probable logical book, distinct from the browse root.
  excludedSourceFiles?: string[]; // Files removed from this project's manifest without deleting them.
  sourceFilesChanged?: boolean;
  sourceReorganizationPending?: boolean;
  logicalBookId?: string;
  matchDecisions?: Record<string, 'different' | 'ignore' | 'keep-a' | 'keep-b' | 'keep-both'>;
  matchHashes?: Record<string, { signature: string; sha256: string }>;
  confirmedMatches?: Record<string, { kind: 'exact' | 'fingerprint'; leftSignature: string; rightSignature: string }>;
  audioFingerprints?: Record<string, { signature: string; envelope: number[][] }>;
  libraryScan?: { root: string; type: 'inbox' | 'library'; path: string; signature: string; identity: string; missing?: boolean; superseded?: boolean; warning?: string; detectedMetadata?: AudiobookMetadata; coverSignature?: string; coverScanVersion?: number; identificationVersion?: number; durationSeconds?: number };
  processingStatus?: 'incomplete' | 'complete';
  lastCompletedAt?: string;
  completionSignature?: string;
  canMoveToLibrary?: boolean; // Response only; checked again by the server.
  // SwissMouse state lives in jobs.json, never in Audiobookshelf metadata.json.
  source?: { kind: 'external' | 'inbox' | 'managed'; path: string; mode: 'file' | 'folder' };
  sourceMissing?: boolean; // Response-only availability, recomputed from disk.
  libraryBook?: LibraryBook; // Response-only Library availability.
  importPending?: boolean;
  importInspected?: boolean;
  importedAt?: string;
  importFinished?: boolean;
  metadataOverrides?: Partial<AudiobookMetadata>;
  metadataRevision?: number;
  validations?: ValidationReport[];
  finalCheck?: FinalCheckReport;
  metadataUpdatedAt?: string;
  pipelineSteps?: Partial<Record<RerunnablePipelineStep, PipelineStepState>>;
  staleSteps?: PipelineResultStep[];
  sourceBitrate?: number;
  chapterStructure?: 'sequential_folders' | 'files' | 'manual_groups';
  sourceKey?: string;
  preparedAudioKey?: string;
  transcriptKey?: string;
  previewPath?: string;
  sourceCodec?: string;
  sourceFormat?: string;
  sourceTags?: Record<string, string>;
  importedMetadata?: AudiobookMetadata;
  existingChapters?: ChapterEntry[];
  existingChapterSource?: string;
  importedChapterFile?: { name: string; content: string; sourceKey: string };
  generateTranscript?: boolean;
  generateWaveform?: boolean;
  waveformReady?: boolean;
  retainedWaveform?: { audio: string; sourceKey?: string };
  finishedAt?: string;
  finishLocation?: 'current' | 'inbox' | 'library';
  exports?: { fileIdentity?: string; playbackSourceSignature?: string; format: OutputAudioFormat; status: 'queued' | 'running' | 'success' | 'failed'; progress: number; filename?: string; fullPath?: string; coverPath?: string; mode?: string; error?: string; warnings?: string[]; verifiedTags?: Record<string,string>; sampleRate?: number; sourceSampleRate?: number; sampleRateCeiling?: number; encodingSampleRate?: number; sampleRateSummary?: string }[];
  exportedFiles?: Partial<Record<OutputAudioFormat, string>>;
  id: string;
  name: string;
  author?: string;
  narrator?: string;
  metadata?: AudiobookMetadata;
  metadataDraft?: AudiobookMetadata;
  createdAt: string;
  parts: AudioPart[];
  totalDurationSeconds: number;
  totalSizeBytes: number;
  status: 'draft' | 'merged' | 'transcribed' | 'metadata_ready' | 'built' | 'validated';
  
  // Step 1 Local Processing Options & Input Methods
  inputMethod?: Step1InputMethod;
  librivox?: import('./librivox').LibriVoxBook;
  sourceFolderPath?: string;
  outputFolderPath?: string;
  chapterSource?: ChapterSourceType;
  mergeMethod?: AudioMergeMethodType;
  selectedModelId?: string;
  transcriptionSettings?: Partial<Record<TranscriptionBackend, TranscriptionSettings>>;
  chapterDetectionKey?: string;
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
    engine?: 'faster-whisper' | 'openai-whisper';
    device?: 'cpu' | 'cuda';
    computeType?: string;
    batchSize?: number | null;
    beamSize?: number;
    requestKey?: string;
    segmentsCount: number;
    wordsCount: number;
    completedAt: string;
  } | null;

  // Persisted word-level timestamps from completed WhisperX output. Chapter
  // Review renders these actual words and never invents transcript text.
  transcriptWords?: AlignedWord[];
  transcriptSegments?: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
    words: Array<{ word: string; start: number; end: number; probability?: number }>;
  }>;

  candidates: ChapterCandidate[];
  /** Unedited chapter output from the most recent chapter-generation run. */
  chapterReviewBaseline?: ChapterEntry[];
  chapters: ChapterEntry[];
  
  ffmetaContent?: string;
  
  outputM4b?: {
    playbackSourceSignature?: string;
    fullPath?: string;
    filename: string;
    duration: number;
    sizeBytes: number;
    bitrate: string;
    chaptersCount: number;
    fileIdentity?: string;
    codec: string;
    format?: OutputAudioFormat;
    sampleRate?: number;
    sourceSampleRate?: number;
    sampleRateCeiling?: number;
    encodingSampleRate?: number;
    sampleRateSummary?: string;
  } | null;

  validation?: ValidationReport | null;
  logs: JobLog[];
}

export interface LibraryBook {
  /** Stable cross-module identities. Legacy id remains the audiobook project route key. */
  resourceId?: import('./core/resources').ResourceId;
  recordingId?: import('./core/resources').ResourceId;
  personalRating?: number | null;
  sourceFileCount?: number;
  importFinished?: boolean;
  metadataRevision?: number;
  canMoveToLibrary?: boolean;
  rootTypes?: ('inbox' | 'library')[];
  formats?: string[];
  representations?: { id: string; resourceId?: string; path: string; formats: string[] }[];
  matchKinds?: ('book' | 'audio' | 'uncertain')[];
  audioMatchEvidence?: 'exact' | 'fingerprint';
  rootType?: 'inbox' | 'library';
  identificationWarning?: string;
  processingStatus?: 'incomplete' | 'complete';
  id: string;
  name: string;
  status: 'draft' | 'merged' | 'transcribed' | 'metadata_ready' | 'built' | 'validated';
  createdAt: string;
  metadataUpdatedAt?: string;
  metadata: AudiobookMetadata;
  coverUrl?: string;
  sourceLocation?: 'external' | 'inbox' | 'managed' | 'unknown';
  sourceMissing?: boolean;
  originalSourceMissing?: boolean;
  availableM4bPath?: string;
}

export type RerunnablePipelineStep = 'generating_waveform' | 'transcribing_whisper' | 'detecting_chapters' | 'extracting_chapters' | 'metadata_processing';
export type PipelineResultStep = 'chapter_detection' | 'chapter_review' | 'export' | 'validation';
export type PipelineStepStatus = 'current' | 'running' | 'stale' | 'failed';
export interface PipelineStepState {
  status: PipelineStepStatus;
  hasOutput: boolean;
  error?: string;
  updatedAt?: string;
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
