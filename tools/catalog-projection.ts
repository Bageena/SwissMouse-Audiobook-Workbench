import path from 'node:path';
import type { AudiobookJob, LibraryBook } from '../src/types';
import type { MatchBook } from './library-matches';

export interface CatalogProject {
  id: string;
  stateVersion?: number;
  groupId: string;
  hidden: boolean;
  match?: { book: MatchBook; decisions: AudiobookJob['matchDecisions']; confirmed: AudiobookJob['confirmedMatches']; sourceSignature?: string };
  book: LibraryBook;
  files: { key: string; path: string; sizeBytes?: number; modifiedMs?: number; role: string; position: number }[];
  observation?: { sourcePaths: string[]; invalidSource: boolean; sourceKey?: string; archive?: AudiobookJob['originalsArchive']; libraryRoot: string; m4bCandidates: (string | undefined)[] };
}

/** Translate the legacy audiobook model at the boundary. Never probe media or read files here. */
export function projectCatalogRecord(job: AudiobookJob, rootType?: 'inbox' | 'library', appRoot = process.cwd()): CatalogProject {
  const metadata = { title: job.name, author: job.author || '', narrator: job.narrator || '', genres: [], language: 'eng', abridged: false, explicit: false, ...job.metadata };
  const cover = metadata.cover?.url;
  const base = job.sourceFolderPath || (job.source?.mode === 'folder' ? job.source.path : job.source?.path ? path.dirname(job.source.path) : '');
  const files: CatalogProject['files'] = job.parts.map((part, position) => ({
    key: `part:${part.id || position}`, path: path.isAbsolute(part.name) ? part.name : base ? path.resolve(appRoot, base, part.name) : '',
    sizeBytes: part.sizeBytes, modifiedMs: job.sourceFileStamps?.[part.name]?.modifiedMs, role: 'source', position,
  })).filter(file => !!file.path);
  for (const [format, file] of Object.entries(job.exportedFiles || {})) if (file) files.push({ key: `export:${format}`, path: file, role: 'export', position: files.length });
  const exports = [...(job.exports || []).filter(item => item.status === 'success' && item.fullPath).map(item => ({ format:item.format,path:item.fullPath! })), ...(job.outputM4b?.fullPath ? [{ format:'m4b',path:job.outputM4b.fullPath }] : [])];
  for (const file of exports) if (!files.some(existing => existing.path === file.path)) files.push({ key:`export:${file.format}:${path.basename(file.path)}`,path:file.path,role:'export',position:files.length });
  for (const file of job.associatedFiles || []) files.push({ key: `associated:${file.kind}:${path.basename(file.path)}`, path: file.path, role: file.kind, position: files.length });
  const formats = [...new Set([job.sourceFormat, ...files.filter(file => ['source', 'export'].includes(file.role)).map(file => path.extname(file.path).slice(1))].filter(Boolean).map(format => format.toUpperCase()))].sort();
  const missing = !!job.libraryScan?.missing;
  const location = job.source?.kind === 'managed' ? 'managed' : rootType === 'inbox' ? 'inbox' : rootType === 'library' ? 'managed' : job.source || job.parts.length ? 'external' : 'unknown';
  return { id: job.id, groupId: job.logicalBookId || job.id, hidden: !!job.importPending || !!job.libraryScan?.superseded,
    match: { book: { id:job.id,metadata:{ ...metadata,cover:undefined },durationSeconds:job.totalDurationSeconds || job.libraryScan?.durationSeconds,chapterCount:job.chapters?.length,formats,fileSizes:job.parts.map(part=>part.sizeBytes),logicalBookId:job.logicalBookId }, decisions:job.matchDecisions,confirmed:job.confirmedMatches },
    files, book: {
      id: job.id, name: job.name, status: job.status, createdAt: job.createdAt, metadataUpdatedAt: job.metadataUpdatedAt,
      personalRating: job.personalRating, metadataRevision: job.metadataRevision, sourceFileCount: job.parts.length,
      importFinished: job.importFinished, metadata: { ...metadata, cover: undefined },
      formats, rootType, rootTypes: rootType ? [rootType] : [], sourceLocation: location, sourceMissing: missing,
      processingStatus: job.processingStatus || 'incomplete', identificationWarning: job.sourceMembershipReview || job.libraryScan?.warning,
      canMoveToLibrary: rootType === 'inbox' && job.processingStatus === 'complete' && !missing,
      representations: [{ id: job.id, path: job.source?.path || job.sourceFolderPath || '', formats }],
      coverUrl: cover && !cover.startsWith('data:') ? cover : cover ? `/api/library/${encodeURIComponent(job.id)}/cover?v=${encodeURIComponent(job.metadataUpdatedAt || job.createdAt)}` : undefined,
    } };
}
