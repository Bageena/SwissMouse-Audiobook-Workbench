import type { AudiobookFileBackend } from './file-backend';
import type { AlignedWord, AudiobookJob, ChapterCandidate } from './legacy-domain';
import type { BackendCapabilities, TranscriptionAttempt, TranscriptionBackend, TranscriptionSettings } from './processing-contracts';
import type { SpeechModelInfo } from './processing-state';
import type { NormalizedTranscription, TranscriptionEngine } from './transcription-contracts';

export type ProcessingCommandInput = { params: Record<string, string>; body: any };
export type SourceBoundary = { start: number; title: string; origin: string };
export type RecoveryWindow = { start: number; end: number; target: number; number?: number; title?: string; parent?: string; reason: string };
type Log = (message: string) => void;
type DetectionOptions = { signal?: AbortSignal; log?: Log };
/** Internal integration with existing engines, not a writable installed-module SDK.
 * Decoder replies keep their legacy shape during extraction. */
type Engine = (...args: any[]) => any;
export interface AudiobookProcessingPorts {
  store: { get: (id: string) => AudiobookJob | undefined; save: () => void; snapshot: <T>(value: T) => T };
  work: { installing: boolean; imports: Set<string> };
  config: { selected_model: string; detect_musical_transitions?: boolean };
  locations: { appRoot: string; output: string; torch: string; matplotlib: string; whisper: string; openai: string };
  source: Pick<AudiobookFileBackend['helpers'], 'sourceFingerprint' | 'projectIntermediatesDir' | 'resolvedOutputRoot' | 'importedSourcePaths' | 'chaptersForJob' | 'associateProjectFile'>;
  runtime: {
    engine: (value: unknown) => TranscriptionBackend;
    models: SpeechModelInfo[];
    modelStatus: (id: string, engine: TranscriptionBackend) => Promise<{ isInstalled: boolean; installedFile?: string }>;
    capabilities: (engine: TranscriptionBackend, refresh?: boolean) => Promise<BackendCapabilities>;
    python: (engine: TranscriptionBackend) => string;
    isSystem: (engine: TranscriptionBackend) => boolean;
    env: (engine?: TranscriptionBackend) => NodeJS.ProcessEnv;
    repositories: Record<string, string>;
    engines: Record<TranscriptionBackend, TranscriptionEngine>;
    transcribe: (capability: BackendCapabilities, settings: TranscriptionSettings, model: string, run: (attempt: TranscriptionAttempt) => Promise<NormalizedTranscription>, log: Log, signal?: AbortSignal) => Promise<NormalizedTranscription>;
  };
  media: {
    inspect: Engine; ffmpeg: () => string; ffprobe: () => string;
    prepare: (ffmpeg: string, ffprobe: string, sources: string[], directory: string, method: 'standard' | 'quick', log?: Log, signal?: AbortSignal) => Promise<{ master: string; media: any[]; durations: number[]; normalized: boolean }>;
    reviewPreview: (ffmpeg: string, sources: string[], output: string, signal?: AbortSignal, log?: Log, waveform?: boolean) => Promise<any>;
    preview: Engine; ensureAnalysis: Engine; rebuildAnalysis: Engine;
  };
  detection: {
    versions: { improved: number; music: number; title: number };
    sourceBoundaries: (existing: NonNullable<AudiobookJob['existingChapters']>, parts: AudiobookJob['parts'], duration: number) => SourceBoundary[];
    structuralSuggestions: (words: AlignedWord[], spoken: ChapterCandidate[], duration: number, sources: SourceBoundary[]) => ChapterCandidate[];
    titles: (audio: string, words: AlignedWord[], spoken: ChapterCandidate[], options: DetectionOptions) => Promise<ChapterCandidate[]>;
    music: (audio: string, words: AlignedWord[], spoken: ChapterCandidate[], options: DetectionOptions) => Promise<ChapterCandidate[]>;
    merge: (spoken: ChapterCandidate[], suggestions: ChapterCandidate[]) => ChapterCandidate[];
    recoveryWindows: (words: AlignedWord[], spoken: ChapterCandidate[], suggestions: ChapterCandidate[], duration: number, sources: SourceBoundary[]) => RecoveryWindow[];
    recheck: (options: { audio: string; directory: string; windows: RecoveryWindow[]; original: AlignedWord[]; settingsKey: string; run: (audio: string, output: string) => Promise<NormalizedTranscription>; signal?: AbortSignal; log?: Log }) => Promise<ChapterCandidate[]>;
    reconcile: (candidates: ChapterCandidate[], sources: SourceBoundary[]) => ChapterCandidate[];
  };
  logs: { event: (source: string, message: string, level?: 'INFO' | 'WARNING' | 'ERROR') => void };
}
