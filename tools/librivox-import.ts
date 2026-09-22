import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import type { AudiobookJob, AudiobookMetadata, DiscoveredAudioFile } from '../src/types';
import type { LibriVoxBook, LibriVoxProgress } from '../src/librivox';
import { LibriVoxCatalog, LibriVoxError, safeFetch, trustedUrl } from './librivox-catalog';

type Probe = (file: string) => { durationSeconds: number; bitrate: number; format: string; codec: string; sampleRate: number; channels: number; streamSignature?: string };
class CleanupError extends Error {}
function removeIncomplete(directory: string) {
  try { fs.rmSync(directory, { recursive: true, force: true }); }
  catch (error: any) { throw new CleanupError('Could not remove incomplete downloads in ' + directory + ': ' + error.message); }
}
function cancellable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}
export async function downloadLibriVox(book: LibriVoxBook, importRoot: string, signal: AbortSignal, progress: (value: LibriVoxProgress) => void, probe: Probe, request: typeof fetch = fetch) {
  if (!book.sections.length || (book.sectionCount && book.sectionCount !== book.sections.length) || new Set(book.sections.map(s => s.order)).size !== book.sections.length || new Set(book.sections.map(s => s.url)).size !== book.sections.length || book.sections.some(s => !s.url || !trustedUrl(s.url, true))) {
    throw new LibriVoxError('This project has incomplete or unsupported section audio links. Open its LibriVox project page for details.');
  }
  fs.mkdirSync(importRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(path.resolve(importRoot), 'book-'));
  let bytes = 0, start = 0;
  const files: DiscoveredAudioFile[] = [];
  const sections = [];
  try {
    for (const [i, section] of book.sections.entries()) {
      signal.throwIfAborted();
      const idle = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const reset = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(new Error('Section download timed out.')), 30000); };
      reset();
      const combined = AbortSignal.any([signal, idle.signal, AbortSignal.timeout(30 * 60_000)]);
      const name = String(i + 1).padStart(5, '0') + '-section.mp3';
      const partial = path.join(directory, name + '.part');
      let sectionBytes = 0;
      let handle: fs.promises.FileHandle | undefined;
      try {
        console.log('[LibriVox] Downloading section', i + 1, 'of', book.sections.length, section.title);
        progress({ status: 'downloading', section: i + 1, totalSections: book.sections.length, title: section.title, bytes, sectionBytes: 0, projectId: book.id });
        const response = await safeFetch(section.url!, { signal: combined }, request);
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw new LibriVoxError(response.status === 429 ? 'Audio host rate limit reached. Try importing again later.' : 'Section download failed (HTTP ' + response.status + ').');
        }
        const length = Number(response.headers.get('content-length')) || undefined;
        if (length && length > 1024 ** 3) { await response.body.cancel(); throw new LibriVoxError('Section exceeds the 1 GiB download limit.'); }
        const reader = response.body.getReader();
        try {
          handle = await fs.promises.open(partial, 'wx');
          for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            combined.throwIfAborted(); reset();
            sectionBytes += value.length; bytes += value.length;
            if (sectionBytes > 1024 ** 3 || bytes > 20 * 1024 ** 3) throw new LibriVoxError('Audiobook download exceeds the supported size limit.');
            // FileHandle.write may perform a partial write.
            let offset = 0;
            while (offset < value.length) {
              const written = (await handle.write(value, offset, value.length - offset)).bytesWritten;
              if (!written) throw new Error('Could not write section audio to disk.');
              offset += written;
            }
            progress({ status: 'downloading', section: i + 1, totalSections: book.sections.length, title: section.title, bytes, sectionBytes, sectionTotalBytes: length, projectId: book.id });
          }
        } finally { await reader.cancel(); }
        if (!sectionBytes || (length && sectionBytes !== length)) throw new LibriVoxError('Incomplete section download.');
        await handle.close(); handle = undefined;
        signal.throwIfAborted();
        const media = probe(partial);
        if (!Number.isFinite(media.durationSeconds) || media.durationSeconds <= 0) throw new LibriVoxError('Downloaded section contains no valid audio.');
        // Keep the actual container extension; the normal pipeline probes again.
        const ext = ({ mp3: 'mp3', wav: 'wav', flac: 'flac', m4a: 'm4a', m4b: 'm4b', ogg: 'ogg', opus: 'opus' } as Record<string, string>)[media.format] || 'mp3';
        const actualName = path.parse(name).name + '.' + ext;
        fs.renameSync(partial, path.join(directory, actualName));
        files.push({ relativePath: actualName, storedName: actualName, fileName: actualName, folderName: 'LibriVox Import',
          ...media, sizeBytes: sectionBytes, isProbed: true });
        sections.push({ ...section, fileName: actualName, startSeconds: start, endSeconds: start + media.durationSeconds, durationSeconds: media.durationSeconds });
        start += media.durationSeconds;
      } finally { clearTimeout(timer!); await handle?.close(); }
    }
    signal.throwIfAborted();
    return { directory, files, sections, bytes, durationSeconds: start };
  } catch (error) {
    // This directory was freshly allocated by this invocation, never a source
    // or user-chosen folder. Failed/cancelled imports cannot leave valid parts.
    removeIncomplete(directory);
    throw error;
  }
}
const languages: Record<string, string> = { English: 'eng', French: 'fra', German: 'deu', Spanish: 'spa', Italian: 'ita', Portuguese: 'por', Dutch: 'nld', Russian: 'rus', Latin: 'lat', Chinese: 'zho', Japanese: 'jpn' };
export function importedMetadata(book: LibriVoxBook): Partial<AudiobookMetadata> {
  const readers = [...new Set(book.sections.flatMap(s => s.readers))];
  return { title: book.title, author: book.authors.join('; '), narrator: readers.join('; '), description: book.description,
    genres: book.genres, ...(languages[book.language] ? { language: languages[book.language] } : {}),
    ...(book.coverUrl ? { cover: { source: 'url' as const, url: book.coverUrl } } : {}) };
}
export function mergeImportMetadata(existing: AudiobookJob['metadata'], incoming: Partial<AudiobookMetadata>, replace: boolean): AudiobookMetadata {
  const result: any = { title: '', author: '', narrator: '', genres: [], language: '', abridged: false, explicit: false, ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
    if (replace || !result[key] || (Array.isArray(result[key]) && !result[key].length)) result[key] = value;
  }
  return result;
}
export function mountLibriVox(app: Express, deps: {
  jobs: AudiobookJob[]; save: () => void; root: string; probe: Probe; locks: Set<string>; busy: () => boolean;
  catalog?: LibriVoxCatalog; request?: typeof fetch; requireImport: any;
}) {
  const catalog = deps.catalog || new LibriVoxCatalog();
  const tasks = new Map<string, { controller: AbortController; progress: LibriVoxProgress }>();
  const fail = (res: any, error: any) => {
    console.error('[LibriVox] Catalog request failed:', error.message);
    const status = error instanceof LibriVoxError ? error.status : 502;
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
    res.status(status).json({ error: error.message || 'LibriVox could not be reached. Try again later.' });
  };
  app.get('/api/librivox/search', async (req, res) => {
    try { res.json(await catalog.search(req.query.field || 'title', req.query.q, req.query.page)); } catch (error) { fail(res, error); }
  });
  app.get('/api/librivox/books/:id', async (req, res) => {
    try { res.json(await catalog.detail(req.params.id)); } catch (error) { fail(res, error); }
  });
  app.get('/api/librivox/import/:jobId', (req, res) => {
    res.json(tasks.get(req.params.jobId)?.progress || { status: 'idle', section: 0, totalSections: 0, title: '', bytes: 0, sectionBytes: 0 });
  });
  app.post('/api/librivox/import/:jobId/cancel', (req, res) => {
    const task = tasks.get(req.params.jobId);
    if (task?.progress.status === 'downloading') task.controller.abort();
    res.json({ status: 'ok' });
  });
  app.post('/api/librivox/import/:jobId', deps.requireImport, (req, res) => {
    const job = deps.jobs.find(j => j.id === req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Project not found.' });
    if (!/^\d{1,12}$/.test(String(req.body.projectId))) return res.status(400).json({ error: 'Choose a LibriVox book first.' });
    if ([...tasks.values()].some(t => t.progress.status === 'downloading')) return res.status(409).json({ error: 'Wait for the active LibriVox import to finish or cancel it first.' });
    if (deps.locks.has(job.id) || deps.busy() || job.exports?.some(e => ['running', 'queued'].includes(e.status))) return res.status(409).json({ error: 'Wait for the active import, processing or export to finish.' });
    if (job.parts.length && req.body.confirmReplaceSource !== true) return res.status(409).json({ error: 'Replace this project’s source audio and processing results? Existing downloaded/source files are kept.', requiresConfirmation: true });
    const replaceMetadata = req.body.replaceMetadata === true;
    const originalSource = JSON.stringify([job.parts, job.sourceFolderPath, job.sourceKey, job.preparedAudioKey]);
    const controller = new AbortController();
    const task = { controller, progress: { status: 'downloading' as const, section: 0, totalSections: 0, title: 'Loading sections…', bytes: 0, sectionBytes: 0, projectId: String(req.body.projectId) } as LibriVoxProgress };
    // Drop old completed task records; never remove running cancellation handles.
    if (tasks.size >= 100) for (const [id, old] of tasks) if (old.progress.status !== 'downloading') { tasks.delete(id); break; }
    tasks.set(job.id, task); deps.locks.add(job.id);
    res.json({ status: 'started' });
    void (async () => {
      let completedDirectory: string | undefined;
      try {
        const book = structuredClone(await cancellable(catalog.detail(task.progress.projectId!), controller.signal));
        controller.signal.throwIfAborted();
        const download = await downloadLibriVox(book, deps.root, controller.signal, progress => { task.progress = progress; }, deps.probe, deps.request);
        completedDirectory = download.directory;
        controller.signal.throwIfAborted();
        if (!deps.jobs.includes(job)) throw new Error('Project was removed before import completed.');
        if (deps.busy() || job.exports?.some(e => ['running', 'queued'].includes(e.status)) || originalSource !== JSON.stringify([job.parts, job.sourceFolderPath, job.sourceKey, job.preparedAudioKey])) throw new Error('Project processing or source changed during import. Previous source kept; retry when the project is idle.');
        const metadata = mergeImportMetadata(job.metadataDraft || job.metadata, importedMetadata(book), replaceMetadata);
        const replacement: Partial<AudiobookJob> = {
          inputMethod: 'librivox', sourceFolderPath: download.directory, mergeMethod: 'standard', chapterSource: job.chapterSource || 'whisperx',
          parts: download.files.map((file, i) => ({ id: 'lv-' + i, name: file.fileName, sourceRelativePath: file.fileName, sizeBytes: file.sizeBytes, durationSeconds: file.durationSeconds, bitrate: file.bitrate || 0, order: i + 1 })),
          discoveredFiles: download.files, totalDurationSeconds: download.durationSeconds, totalSizeBytes: download.bytes,
          hasNestedChapterFolders: false, status: 'draft', metadata, metadataDraft: undefined,
          name: metadata.title || job.name, author: metadata.author, narrator: metadata.narrator,
          librivox: { ...book, sections: download.sections }, sourceSummary: { inputMethod: 'librivox', sourcePath: book.projectUrl || 'LibriVox project ' + book.id, formatsDetected: [...new Set(download.files.map(f => f.format!))], totalFiles: download.files.length, totalDurationSeconds: download.durationSeconds, chapterWorkflow: job.chapterSource || 'whisperx', mergeMethod: 'standard' },
          mergedMp3: null, previewPath: undefined, sourceKey: undefined, preparedAudioKey: undefined, transcriptKey: undefined,
          transcription: null, transcriptWords: [], transcriptSegments: [], existingChapters: [], chapters: [], candidates: [],
          outputM4b: null, validation: null, exports: [], pipelineSteps: {}, staleSteps: [], chapterDetectionKey: undefined,
          sourceTags: {}, importedMetadata: undefined, youtubeUrl: undefined, downloadedAudioFile: undefined,
          logs: [...job.logs, { timestamp: new Date().toISOString(), level: 'INFO', message: 'LibriVox import completed: project ' + book.id + ', ' + download.files.length + ' sections. Source boundaries retained as hints; normal chapter detection remains available.' }],
        };
        const previous = { ...job };
        Object.assign(job, replacement);
        try { deps.save(); } catch (error) {
          for (const key of Object.keys(replacement)) if (!(key in previous)) delete (job as any)[key];
          Object.assign(job, previous); throw error;
        }
        completedDirectory = undefined; // Committed source files must never be cleaned as a failed download.
        task.progress = { ...task.progress, status: 'completed' };
        console.log('[LibriVox] Import completed:', book.id, download.files.length, 'sections');
      } catch (error: any) {
        if (completedDirectory) { try { removeIncomplete(completedDirectory); } catch (cleanup) { error = cleanup; } }
        const cancelled = controller.signal.aborted && !(error instanceof CleanupError);
        task.progress = { ...task.progress, status: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : error.message };
        console.error('[LibriVox] Import', task.progress.status, error.message);
      } finally { deps.locks.delete(job.id); }
    })();
  });
}
