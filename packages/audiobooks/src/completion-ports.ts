import type { ChapterEntry } from './domain';
import type { AudiobookFileBackend } from './file-backend';
import type { FileCommandInput, FileReply, FileStamp } from './file-ports';
import type { AudiobookJob, FinalCheckItem, FinalCheckReport, OriginalsArchive } from './legacy-domain';
import type { AudiobookProcessingPorts } from './processing-ports';

export type FinishLocation = 'current' | 'inbox' | 'library';
export type FinalCheckConfig = { audiobookshelf_metadata?: boolean; save_cover_beside_audio?: boolean };
export type CompletionConfig = FinalCheckConfig & { inbox_folder?: string; library_template?: string; pcm_retention?: 'after_verified_export' | 'until_finalized' | 'keep' };
export type CompletionInput = FileCommandInput;
export type CompletionReply = FileReply & { headers?: Record<string, string>; text?: string };
export const completionReply = (status: number, body: any): CompletionReply => ({ status, body });
export function createAudiobookCompletionState() {
  return {
    validating: false, metadataWriters: new Set<string>(), exports: new Set<string>(), messages: new Map<string, string>(),
    checks: new Map<string, { controller: AbortController; message: string; items: FinalCheckItem[] }>()
  };
}
/** Provisional built-in engine boundary; legacy decoder replies keep their current shape. */
type Engine = (...args: any[]) => any;
export interface AudiobookCompletionPorts {
  state: ReturnType<typeof createAudiobookCompletionState>;
  store: { projects: AudiobookJob[]; get: (id: string) => AudiobookJob | undefined; save: () => void; progress: () => void; flushStopped: () => void; snapshot: <T>(value: T) => T };
  work: { processing: boolean; imports: Set<string>; moving: boolean; installing: boolean; runtimeMutation: boolean; youtubeInstalling: boolean; modelDownloads: number; fasterInstalls: number; mutations: number };
  locations: { appRoot: string; appPath: (...parts: string[]) => string; output: string; upload: string };
  config: CompletionConfig;
  source: Pick<AudiobookFileBackend['helpers'], 'isManagedChild' | 'sourceMissing' | 'sourceFilePaths' | 'resolvedOutputRoot' | 'knownIntermediatesRoots' | 'projectIntermediatesDir' | 'exportedAudioPaths' | 'sourceLocation' | 'bookSourceRoot' | 'sourceRelative' | 'sourceFingerprint' | 'bookFileStamp' | 'archiveCurrent' | 'associateProjectFile' | 'backfillProjectCompanions' | 'projectFilePaths' | 'availableOriginalPaths' | 'ownedProjectDestination' | 'pathEntryExists' | 'completionSignature' | 'transferAssociatedProject' | 'canMoveInboxBook'>;
  files: {
    pathKey: (file: string) => string; within: (root: string, file: string) => boolean; stamp: (file: string, name?: string) => Promise<FileStamp>;
    projectFiles: (job: AudiobookJob, originals: string[]) => { path: string; roles: string[] }[];
    assertSidecarOwnership: Engine; extensions: Set<string>;
  };
  media: {
    ffmpeg: () => string; ffprobe: () => string; inspect: Engine; inspectAsync: Engine; read: Engine; retainWaveform: (audio: string) => boolean;
    prepare: AudiobookProcessingPorts['media']['prepare'];
    writeMetadata: Engine;
    playback: (job: AudiobookJob, options: { sourcePaths: string[]; ffprobe: string; preferFinalized: boolean; inspect: (tool: string, file: string) => Promise<any> }) => Promise<{ manifest: { signature: string; totalDurationSeconds: number } }>;
    exportAudio: (options: { ffmpeg: string; ffprobe: string; source: string; output: string; format: NonNullable<NonNullable<AudiobookJob['outputM4b']>['format']>; chapters: ChapterEntry[]; tags?: Record<string, string>; cover?: string | null; convert?: boolean; bitrate?: string; cue?: boolean; sampleRateCeiling?: number; onLog?: (message: string) => void; onProgress?: (value: number) => void }) => Promise<NonNullable<AudiobookJob['outputM4b']> & { fullPath: string }>;
    validateChapters: (chapters: ChapterEntry[], duration: number) => void;
  };
  checks: {
    signature: (job: AudiobookJob, config: FinalCheckConfig, files: string[], originals: string[], artifacts: string[]) => string;
    run: (options: { job: AudiobookJob; config: FinalCheckConfig; files: string[]; originals: string[]; artifacts: {}; ffmpeg: string; ffprobe: string; signal: AbortSignal; progress: (message: string, items: FinalCheckItem[]) => void }) => Promise<FinalCheckReport>;
  };
  archive: {
    create: (options: { folder: string; sources: { source: string; name: string }[]; sourceKey: string; protectedFiles: Set<string>; journal: string; commit: (archive: OriginalsArchive) => void | Promise<void>; log: (message: string) => void }) => Promise<{ warning?: string }>;
    restore: (journal: string) => Promise<void>;
  };
  catalog: { publish: (ids: string[]) => Promise<unknown>; invalidate: () => void } | undefined;
  logs: { event: (source: string, message: string, level?: 'INFO' | 'WARNING' | 'ERROR') => void; failure: (id: string | undefined, operation: string, message: string) => void };
  system: { openFolder: (folder: string) => Promise<unknown> };
}
