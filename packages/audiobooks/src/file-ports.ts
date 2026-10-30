import type { AudiobookJob, LibraryBook } from './legacy-domain';
import type { FileStamp, MoveEntry, CopiedFile, TransferJournal } from '../../sdk/file-transfers';

export type { FileStamp, MoveEntry, CopiedFile, TransferJournal } from '../../sdk/file-transfers';
export type FileReply = { status: number; body: any };
export const fileReply = (status: number, body: any): FileReply => ({ status, body });
export interface SourceFileFacts {
  sourceFilePaths: (job: AudiobookJob) => string[];
  knownIntermediatesRoots: () => string[];
  exportedAudioPaths: (job: AudiobookJob) => string[];
  bookRootType: (job: AudiobookJob) => 'inbox' | 'library' | undefined;
  remapBookPaths: (job: AudiobookJob, from: string, to: string) => void;
  sourceRelative: (job: AudiobookJob, part: AudiobookJob['parts'][number]) => string;
  completionSignature: (job: AudiobookJob) => Promise<string>;
  archiveCurrent: (job: AudiobookJob) => boolean;
  sourceMissing: (job: AudiobookJob) => boolean;
  survivingLibraryM4b: (job: AudiobookJob) => string | undefined;
  availableOriginalPaths: (job: AudiobookJob) => string[];
  bookSourceRoot: (job: AudiobookJob) => string | undefined;
  pathEntryExists: (file: string) => boolean;
  sourceLocation: (job: AudiobookJob) => LibraryBook['sourceLocation'];
  canMoveInboxBook: (job: AudiobookJob) => boolean;
  completionCurrent: (job: AudiobookJob) => boolean;
  isManagedChild: (root: string, file: string) => boolean;
  resolvedOutputRoot: (job?: AudiobookJob) => string;
  probeAudioFile: (file: string) => any;
}
export type UploadedAudio = { path: string; originalname: string; filename: string; size: number; mimetype: string };
export type FileCommandInput = { params: Record<string, string>; body: any; query: Record<string, any>; files?: { files?: UploadedAudio[]; cover?: UploadedAudio[] }; getHeader: (name: string) => string | undefined };
export type DiskBook = { path: string; folder: string; mode: 'file' | 'folder'; files: FileStamp[]; signature: string; identity: string; metadataFile?: string; associatedFiles?: { path: string; kind: 'metadata' | 'cover' }[]; title?: string; grouped?: boolean };
export type ChapterAudioSource = { file: string; durationSeconds: number; chapters: AudiobookJob['chapters'] };
export function createAudiobookFileState() {
  return { moving: false, imports: new Set<string>(), scan: undefined as Promise<void> | undefined, warnings: [] as string[], progress: { operation: 'refresh', source: '', folders: 0, discovered: 0, processed: 0, phase: 'Idle' } };
}
/** Legacy decoder/engine replies retain their current shape during extraction.
 * These named engine ports are not a frozen SDK or an arbitrary host-global lookup.
 */
type Engine = (...args: any[]) => any;
export interface AudiobookFilePorts {
  store: { projects: AudiobookJob[]; get: (id: string) => AudiobookJob | undefined; adopt: (id: string) => AudiobookJob | undefined; commit: (backup?: boolean) => void; rollback: () => AudiobookJob[]; outputRoots: () => string[]; snapshot: <T>(value: T) => T };
  activity: ReturnType<typeof createAudiobookFileState>;
  work: { processing: boolean; configSaving: boolean; validating: boolean; mutations: number; metadataWriters: Set<string>; cleanupReason: () => string | undefined };
  locations: { appRoot: string; appPath: (...parts: string[]) => string; output: string; upload: string; config: { inbox_folder?: string; library_folder?: string; library_template?: string; audiobookshelf_metadata?: boolean; save_cover_beside_audio?: boolean } };
  files: {
    stamp: (file: string, name?: string) => Promise<FileStamp>; fileSignature: (files: FileStamp[]) => string;
    pathKey: (file: string) => string; within: (root: string, file: string) => boolean;
    assertUnlinked: Engine; contentHash: Engine; inventory: Engine; scanRoot: (root: string, extensions: Set<string>, excluded?: string[], observer?: any) => Promise<DiskBook[]>; identifyBook: Engine;
    listBookTree: Engine; listBookDirectory: Engine; resolveBookAudio: Engine;
    moveBookFiles: (root: string, files: string[], destination: string) => { from: string; to: string; oldRelativePath: string; relativePath: string }[];
    createBookFolder: Engine;
    rebaseBookMembership: Engine; projectFiles: Engine; recoverRelocatedOutput: Engine;
    recoverTransferCopies: (target: string, copied: CopiedFile[]) => Promise<string | undefined>;
    transferProjectFiles: (options: { root: string; journal: string; intent: TransferJournal; cleanupEntries?: MoveEntry[]; existingTarget?: CopiedFile[]; boundaries: string[]; protectedFiles: Set<string>; commit: () => void | Promise<void>; rollback: () => void; log: (message: string) => void }) => Promise<string | undefined>;
    mapScanWork: <T, R>(items: readonly T[], limit: number, read: (item: T, index: number) => Promise<R>) => Promise<R[]>;
  };
  media: { extensions: Set<string>; outputFormats: readonly string[]; ffmpeg: () => string; ffprobe: () => string; inspect: Engine; read: Engine; writeAudioMetadata: Engine; writeCoverImage: Engine; fingerprint: Engine; stitchCompatibility: Engine; libraryReader: { tags: Engine; cover: Engine; duration: Engine } };
  availability: { catalogArchiveCurrent: Engine; findAvailableM4b: Engine };
  views: { book: (job: AudiobookJob) => LibraryBook; visibleBooks: () => LibraryBook[]; listening: { has: (id: string) => boolean } };
  metadata: { writeSidecars: Engine; transcriptionSettings: Engine };
  chapters: { parse: Engine; existing: Engine };
  validation: { signature: (job: AudiobookJob) => string };
  providers: { status: Engine; youtubeUrl: Engine; youtubeArgs: Engine; downloadYoutubeAudio: Engine };
  logs: { event: Engine; import: Engine; failure: Engine };
  system: { openFolder: Engine };
  catalog: { call: Engine; publish: Engine; invalidate: Engine; ready: Engine } | undefined;
}
