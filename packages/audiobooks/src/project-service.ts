import { randomUUID } from 'node:crypto';
import type { AudiobookMetadata, ChapterEntry } from './domain';
import { applyDefaultChapterEnds, parseCsvRow, validateChapterEntries } from './chapters';
import { formatTimestamp, generateFFMetaContent, parseTimestampToMs } from './ffmetadata';
import { applySavedMetadata, type EditableProject } from './project-metadata';

export class AudiobookCommandError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function fail(status: number, message: string): never { throw new AudiobookCommandError(status, message); }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export interface CreatedProject extends Omit<EditableProject, 'libraryScan'> {
  libraryScan?: never;
  outputFolderPath: string; createdAt: string; totalSizeBytes: number; candidates: [];
  parts: { id: string; name: string; sourceRelativePath?: string; sizeBytes: number; durationSeconds: number; bitrate: number; order: number }[];
}
export interface ProjectServices<J extends EditableProject, B> {
  selections?: { prepare: (input: unknown, metadata: AudiobookMetadata, project: J) => unknown; save: (prepared: unknown) => void };
  store: {
    get: (id: string) => J | undefined;
    insert: (project: CreatedProject) => J;
    remove: (id: string) => void;
    /** Existing durable commit must roll back live state on failure. */
    save: () => void;
  };
  views: {
    query: (options: { limit: number; cursor: unknown }) => Promise<unknown[]>;
    prepareRead: (project: J) => void;
    describe: (project: J) => { sourceMissing: boolean; canMoveToLibrary: boolean; libraryBook: B };
    book: (project: J) => B;
    publish: (ids: string[]) => Promise<void>;
  };
  sidecars: {
    savedAudio: (project: J) => string[];
    availableAudio: (project: J) => string[];
    /** Existing ownership-checked, atomic sidecar writer; never changes source audio. */
    write: (project: J, audio: string[]) => string[];
  };
  guards: {
    sourceImportActive: (id: string) => boolean;
    metadataWriteBusy: (project: J) => boolean;
    deletionBusy: () => string | undefined;
  };
  removeManagedFiles: (project: J) => void;
  outputFolder: () => string;
}

/** Built-in command slice. No Express, private host imports, alternate store or worker loop. */
export function createAudiobookProjectService<J extends EditableProject, B>(services: ProjectServices<J, B>) {
  const get = (id: string, message = 'Job not found'): J => services.store.get(id) || fail(404, message);
  function mutation(id: string, revision?: unknown, message = 'Job not found') {
    const project = get(id, message);
    if (revision !== undefined && revision !== (project.metadataRevision || 0)) fail(409, 'Book details changed in another view. Reopen the book before saving; your current edits have not been applied.');
    if (services.guards.sourceImportActive(id)) fail(409, 'Wait for the source import to finish, or cancel it first.');
    return project;
  }
  function metadata(input: unknown): AudiobookMetadata {
    if (!object(input) || typeof input.title !== 'string' || !input.title.trim()) fail(400, 'Metadata title is required.');
    for (const field of ['subtitle', 'author', 'narrator', 'series', 'seriesSequence', 'edition', 'publishedYear', 'releaseDate', 'publisher', 'language', 'isbn', 'asin', 'description', 'copyright', 'seriesAddedAt']) {
      if (input[field] !== undefined && typeof input[field] !== 'string') fail(400, `Invalid ${field} value.`);
    }
    for (const field of ['genres', 'tags', 'authors', 'narrators']) {
      if (input[field] !== undefined && (!Array.isArray(input[field]) || (input[field] as unknown[]).some(value => typeof value !== 'string'))) fail(400, `Invalid ${field} value.`);
    }
    for (const field of ['abridged', 'explicit']) if (input[field] !== undefined && typeof input[field] !== 'boolean') fail(400, `Invalid ${field} value.`);
    for (const field of ['collections', 'additionalSeries']) if (input[field] !== undefined && !Array.isArray(input[field])) fail(400, `Invalid ${field} value.`);
    if (input.cover !== undefined && input.cover !== null && (!object(input.cover) || typeof input.cover.url !== 'string')) fail(400, 'Invalid cover value.');
    return input as unknown as AudiobookMetadata;
  }
  function saveChapters(id: string, input: unknown) {
    const project = mutation(id);
    const chapters = Array.isArray(input) ? applyDefaultChapterEnds(input, project.totalDurationSeconds) : input;
    if (!Array.isArray(chapters) || !chapters.length) fail(400, 'Chapters list must contain at least one entry.');
    try {
      const error = validateChapterEntries(chapters, project.totalDurationSeconds);
      if (error) throw new Error(error);
      for (let index = 0; index < chapters.length; index++) {
        const row = chapters[index];
        if (!row.start || !row.title || !row.title.trim()) throw new Error(`Row ${index + 1}: Missing start timestamp or title.`);
        const start = parseTimestampToMs(row.start);
        if (!index && start < 0) throw new Error('First chapter start timestamp cannot be negative.');
        if (index && start <= parseTimestampToMs(chapters[index - 1].start)) throw new Error(`Row ${index + 1} (${row.title}): Timestamp ${row.start} (${start}ms) does not strictly increase after previous ${chapters[index - 1].start} (${parseTimestampToMs(chapters[index - 1].start)}ms).`);
        if (start >= Math.round(project.totalDurationSeconds * 1000)) throw new Error(`Row ${index + 1} (${row.title}): Chapter start (${row.start}) exceeds total audio duration (${formatTimestamp(project.totalDurationSeconds)}).`);
      }
    } catch (error) { fail(400, errorMessage(error)); }
    const ffmeta = generateFFMetaContent(chapters, project.totalDurationSeconds, project.metadata);
    project.chapters = chapters;
    project.staleSteps = [...new Set([...(project.staleSteps || []).filter(step => step !== 'chapter_review'), 'export' as const, 'validation' as const])];
    project.ffmetaContent = ffmeta;
    project.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'INFO', message: `Updated and validated ${chapters.length} chapters. FFmetadata cache refreshed.` });
    services.store.save();
    return { status: 'ok', chapters: project.chapters, ffmeta: project.ffmetaContent };
  }
  return {
    list: (limit: unknown, cursor: unknown) => services.views.query({ limit: limit === undefined ? 100 : Number(limit), cursor }),
    read(id: string) {
      const project = get(id); services.views.prepareRead(project);
      return { ...project, ...services.views.describe(project) };
    },
    create(input: Record<string, any>) {
      const { name, author, narrator, parts } = input;
      if (!name || typeof name !== 'string') fail(400, 'Job name is required');
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'book';
      const formattedParts: CreatedProject['parts'] = Array.isArray(parts) && parts.length ? parts.map((part, index) => ({ id: `p-${index + 1}`, name: part.name || `part_${index + 1}.mp3`, sourceRelativePath: part.sourceRelativePath, sizeBytes: part.sizeBytes || 35000000, durationSeconds: part.durationSeconds || 1800, bitrate: part.bitrate || 128, order: index + 1 })) : input.importPending ? [] : [
        { id: 'p-1', name: '01.mp3', sizeBytes: 35000000, durationSeconds: 1800, bitrate: 128, order: 1 },
        { id: 'p-2', name: '02.mp3', sizeBytes: 36500000, durationSeconds: 1920, bitrate: 128, order: 2 },
      ];
      const project = services.store.insert({ id: `${slug}-${randomUUID().slice(0, 8)}`, importPending: input.importPending === true, name: name.trim(), outputFolderPath: services.outputFolder(), author: author?.trim() || '', narrator: narrator?.trim() || '',
        metadata: { title: name.trim(), author: author?.trim() || '', narrator: narrator?.trim() || '', genres: ['Audiobook'], language: 'eng', abridged: false, explicit: false }, createdAt: new Date().toISOString(), parts: formattedParts,
        totalDurationSeconds: formattedParts.reduce((sum, part) => sum + part.durationSeconds, 0), totalSizeBytes: formattedParts.reduce((sum, part) => sum + part.sizeBytes, 0), status: 'draft', candidates: [], chapters: [{ id: `c-${Date.now()}`, start: '00:00:00.000', title: 'Chapter 1' }],
        logs: [{ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'INFO', message: `Job '${name}' initialized with ${formattedParts.length} audio parts. Ready for Step 1.` }],
      });
      services.store.save(); return project;
    },
    remove(id: string) {
      const project = mutation(id);
      const busy = services.guards.deletionBusy(); if (busy) fail(409, busy);
      try { services.removeManagedFiles(project); }
      catch (error) { fail(500, `The project could not be deleted because its working files could not be removed: ${errorMessage(error)}`); }
      services.store.remove(id); services.store.save(); return { status: 'ok' };
    },
    saveDraft(id: string, input: unknown, revision?: unknown) {
      const project = mutation(id, revision);
      if (project.importPending && !project.importInspected) fail(409, 'Choose a source before editing metadata.');
      if (!object(input)) fail(400, 'Metadata draft is required.');
      project.metadataDraft = input as unknown as AudiobookMetadata;
      services.store.save(); return { status: 'ok' };
    },
    saveMetadata(id: string, input: unknown, revision?: unknown, selection?: unknown) {
      const project = mutation(id, revision);
      const checked = metadata(input);
      const prepared = selection === undefined ? undefined : services.selections ? services.selections.prepare(selection,checked,project) : fail(400,'Shared selection history is not enabled.');
      applySavedMetadata(project, checked);
      let metadataJsonPaths: string[] = [], sidecarError: string | undefined;
      try { const audio = services.sidecars.savedAudio(project); if (audio.length) metadataJsonPaths = services.sidecars.write(project, audio); }
      catch (error) { sidecarError = errorMessage(error); }
      if (!sidecarError && prepared !== undefined) services.selections!.save(prepared); else services.store.save();
      if (sidecarError) fail(500, 'Book details were saved, but exmetadata.json could not be updated: ' + sidecarError);
      return { status: 'ok', job: project, ffmeta: project.ffmetaContent, metadataJsonPaths, libraryBook: services.views.book(project), message: 'Audiobook metadata saved successfully.' };
    },
    saveMetadataJson(id: string, input?: unknown, revision?: unknown) {
      const project = mutation(id, revision, 'Book not found.');
      if (services.guards.metadataWriteBusy(project)) fail(409, 'Wait for current processing to finish.');
      const files = services.sidecars.availableAudio(project);
      if (!files.length) fail(400, 'No audiobook file is available for exmetadata.json.');
      if (input !== undefined) { applySavedMetadata(project, metadata(input)); services.store.save(); }
      else if (!project.metadata) fail(400, 'Save book metadata first.');
      try {
        const written = services.sidecars.write(project, files);
        project.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'INFO', message: `Updated exmetadata.json: ${written.join('; ')}` });
        services.store.save(); return { written };
      } catch (error) { fail(500, `Could not update exmetadata.json: ${errorMessage(error)}`); }
    },
    saveChapters,
    exportChapters(id: string, format: 'csv' | 'ffmeta') {
      const project = get(id);
      if (format === 'ffmeta') return { type: 'text/plain', filename: `${project.name}.ffmeta`, content: generateFFMetaContent(project.chapters, project.totalDurationSeconds) };
      const escape = (value = '') => `"${value.replace(/"/g, '""')}"`;
      return { type: 'text/csv', filename: `${project.name}-chapters.csv`, content: 'start,end,title\n' + project.chapters.map(chapter => `${escape(chapter.start)},${escape(chapter.end || '')},${escape(chapter.title)}\n`).join('') };
    },
    importChaptersCsv(id: string, input: unknown) {
      mutation(id);
      if (!input || typeof input !== 'string') fail(400, 'csvText is required');
      const lines = input.split(/\r?\n/).filter(line => line.trim());
      if (lines.length < 2) fail(400, 'CSV must contain a header and at least one row.');
      const headers = parseCsvRow(lines[0]).map(value => value.toLowerCase());
      const start = headers.indexOf('start'), end = headers.indexOf('end'), title = headers.indexOf('title');
      if (start < 0 || title < 0) fail(400, 'CSV headers must include start and title.');
      const chapters: ChapterEntry[] = lines.slice(1).map((line, index) => {
        const values = parseCsvRow(line), finish = end >= 0 ? values[end]?.trim() || '' : undefined;
        return { id: `imported-${index + 1}`, start: values[start]?.trim() || '', title: values[title]?.trim() || '', ...(finish === undefined ? {} : { end: finish, endManuallyEdited: !!finish }) };
      });
      const saved = saveChapters(id, chapters);
      return { status: saved.status, chapters: saved.chapters };
    },
    async saveLibraryMetadata(input: unknown) {
      if (!Array.isArray(input) || !input.length || input.length > 10000) fail(400, 'Select books and fields to update.');
      const ids = new Set<string>();
      const editable = new Set(['title', 'subtitle', 'author', 'narrator', 'series', 'seriesSequence', 'edition', 'description', 'genres', 'tags', 'collections', 'additionalSeries', 'publishedYear', 'publisher', 'language', 'isbn', 'asin', 'releaseDate', 'copyright', 'abridged', 'explicit']);
      const planned = input.map(change => {
        if (!object(change) || typeof change.id !== 'string' || !services.store.get(change.id) || ids.has(change.id) || !object(change.fields)) fail(400, 'Invalid book update.');
        const project = mutation(change.id); ids.add(change.id);
        const fields = change.fields;
        if (!Object.keys(fields).length || Object.keys(fields).some(field => !editable.has(field))) fail(400, 'Select supported metadata fields.');
        for (const [field, value] of Object.entries(fields)) {
          const valid = ['collections', 'additionalSeries'].includes(field) ? Array.isArray(value) && value.every(item => object(item) && typeof item.id === 'string' && !!item.id.trim() && typeof item.name === 'string' && !!item.name.trim() && (item.sequence === undefined || typeof item.sequence === 'string') && (item.addedAt === undefined || typeof item.addedAt === 'string'))
            : ['genres', 'tags'].includes(field) ? Array.isArray(value) && value.every(item => typeof item === 'string')
            : ['abridged', 'explicit'].includes(field) ? typeof value === 'boolean' : typeof value === 'string';
          if (!valid) fail(400, `Invalid ${field} value.`);
        }
        const next = metadata({ ...project.metadata, title: project.metadata?.title || project.name, author: project.metadata?.author || project.author || '', narrator: project.metadata?.narrator || project.narrator || '', genres: project.metadata?.genres || [], language: project.metadata?.language || 'eng', abridged: project.metadata?.abridged || false, explicit: project.metadata?.explicit || false, ...fields });
        return { project, metadata: next, fields };
      });
      for (const { project, metadata, fields } of planned) {
        const draft = project.metadataDraft; applySavedMetadata(project, metadata);
        if (draft) project.metadataDraft = { ...draft, ...fields };
      }
      services.store.save();
      const jsonFailures: string[] = [];
      for (const { project } of planned) {
        try { const files = services.sidecars.savedAudio(project); if (files.length) services.sidecars.write(project, files); }
        catch (error) { jsonFailures.push(`${project.name}: ${errorMessage(error)}`); project.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'ERROR', message: `Could not update exmetadata.json: ${errorMessage(error)}` }); }
      }
      services.store.save(); await services.views.publish([...ids]);
      return { books: planned.map(({ project }) => services.views.book(project)), jsonFailures };
    },
  };
}
