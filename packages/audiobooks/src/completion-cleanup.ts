import fs from 'node:fs';
import path from 'node:path';
import type { AudiobookCompletionPorts, CompletionInput, CompletionReply } from './completion-ports';
import { completionReply as reply } from './completion-ports';
import type { AudiobookJob } from './legacy-domain';

export function createCompletionCleanup(host: AudiobookCompletionPorts) {
  const state = host.state;
  function removeManagedChild(root: string, target: string): boolean {
    if (!host.source.isManagedChild(root, target))
      throw new Error(`Refusing to remove a path outside the managed cleanup area: ${target}`);
    const inbox = host.config.inbox_folder || host.locations.appPath('inbox');
    if ((host.files.pathKey(root) === host.files.pathKey(host.locations.upload) || host.files.pathKey(root) === host.files.pathKey(host.locations.appPath('audiobooks'))) &&
      (host.files.pathKey(target) === host.files.pathKey(inbox) || host.files.within(inbox, target) || host.files.within(target, inbox)))
      return false;
    if (!fs.existsSync(target))
      return false;
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  }

  function clearManagedDirectory(root: string): number {
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
      return 0;
    }
    let removed = 0;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (removeManagedChild(root, path.join(root, entry.name)))
        removed += 1;
    }
    return removed;
  }

  function cleanupInProgress(): boolean {
    return state.exports.size > 0 || state.metadataWriters.size > 0 || state.validating || host.work.moving ||
      host.work.processing || host.work.imports.size > 0 || host.work.installing || host.work.runtimeMutation || host.work.youtubeInstalling ||
      host.work.modelDownloads > 0 || host.work.fasterInstalls > 0 ||
      host.store.projects.some(job => job.exports?.some(item => item.status === 'queued' || item.status === 'running'));
  }

  function cleanupBusyReason(): string | undefined {
    return cleanupInProgress() ? 'Wait for active importing, processing, exporting, installation, or downloads to finish before cleaning up files.' : undefined;
  }

  function resetGeneratedJobState(job: AudiobookJob): void {
    job.processingStatus = 'incomplete';
    job.mergedMp3 = null;
    job.previewPath = undefined;
    job.sourceKey = undefined;
    job.preparedAudioKey = undefined;
    job.transcriptKey = undefined;
    job.transcription = null;
    job.transcriptWords = undefined;
    job.transcriptSegments = undefined;
    job.candidates = [];
    job.chapterDetectionKey = undefined;
    job.pipelineSteps = undefined;
    job.status = job.outputM4b ? 'built' : 'draft';
  }

  function resetImportedJobState(job: AudiobookJob): void {
    resetGeneratedJobState(job);
    // Cleanup may remove working copies, but not an existing referenced Inbox,
    // Library, or external source. Keep its paths and metadata record intact.
    if (job.source && !host.source.sourceMissing(job) && host.source.sourceFilePaths(job).length)
      return;
    job.libraryScan = undefined;
    job.source = undefined;
    job.parts = [];
    job.totalDurationSeconds = 0;
    job.totalSizeBytes = 0;
    job.sourceFolderPath = undefined;
    job.discoveredFiles = undefined;
    job.unsupportedFiles = undefined;
    job.detectedFormats = undefined;
    job.isStreamCopyCompatible = undefined;
    job.streamCopyIncompatibilityReason = undefined;
    job.downloadedAudioFile = undefined;
    job.sourceSummary = undefined;
  }

  function removeProjectManagedFiles(job: AudiobookJob, includeImportedSource: boolean): number {
    let removed = 0;
    const intermediatesRoot = path.join(host.source.resolvedOutputRoot(job), 'intermediates');
    if (removeManagedChild(intermediatesRoot, path.join(intermediatesRoot, job.id)))
      removed += 1;
    if (includeImportedSource) {
      for (const root of [host.locations.upload, host.locations.appPath('audiobooks')]) {
        if (removeManagedChild(root, path.join(root, job.id)))
          removed += 1;
      }
    }
    return removed;
  }

  function removeOrphanedProjectFolders(): number {
    const activeJobIds = new Set(host.store.projects.map(job => job.id));
    let removed = 0;
    for (const root of [host.locations.upload, host.locations.appPath('audiobooks'), ...host.source.knownIntermediatesRoots()]) {
      if (!fs.existsSync(root))
        continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && activeJobIds.has(entry.name))
          continue;
        if (removeManagedChild(root, path.join(root, entry.name)))
          removed += 1;
      }
    }
    return removed;
  }

  function removeProjectTemporaryFiles(job: AudiobookJob): number {
    const root = host.source.projectIntermediatesDir(job);
    if (!fs.existsSync(root))
      return 0;
    let removed = 0;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const disposableFile = entry.isFile() && (/^part-\d+\.wav$/i.test(entry.name) || entry.name === 'concat.txt' ||
        /^analysis\.wav\.analysis\.json\.tmp-[0-9a-f-]{36}$/i.test(entry.name));
      const candidate = path.join(root, entry.name);
      const disposableDirectory = entry.isDirectory() && /^analysis\.wav\.analysis-[0-9a-f-]{36}$/i.test(entry.name) &&
        fs.existsSync(path.join(candidate, 'features.bin')) &&
        fs.readdirSync(candidate, { withFileTypes: true }).every(child => child.isFile() && /^(features|level-\d+)\.bin$/i.test(child.name));
      if ((disposableFile || disposableDirectory) && removeManagedChild(root, candidate))
        removed += 1;
    }
    return removed;
  }

  function managedPcmFiles(job: AudiobookJob): string[] {
    const root = host.source.projectIntermediatesDir(job);
    if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory() || host.files.pathKey(fs.realpathSync(root)) !== host.files.pathKey(root))
      return [];
    let protectedPaths: Set<string>;
    try {
      protectedPaths = new Set([...host.source.sourceFilePaths(job), ...host.source.exportedAudioPaths(job)].map(host.files.pathKey));
    }
    catch {
      return [];
    }
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^(analysis|master|part-\d+)\.wav$/i.test(entry.name))
      .map(entry => path.join(root, entry.name))
      .filter(file => !protectedPaths.has(host.files.pathKey(file)) && !fs.lstatSync(file).isSymbolicLink());
  }

  function clearProjectPcm(job: AudiobookJob): number {
    let bytes = 0;
    for (const file of managedPcmFiles(job)) {
      if (job.previewPath && host.files.pathKey(job.previewPath) === host.files.pathKey(file) && host.media.retainWaveform(file))
        job.retainedWaveform = { audio: file, sourceKey: job.sourceKey };
      bytes += fs.statSync(file).size;
      fs.unlinkSync(file);
      if (job.previewPath && host.files.pathKey(job.previewPath) === host.files.pathKey(file))
        job.previewPath = undefined;
    }
    if (bytes) {
      job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Cleared ${bytes} bytes of SwissMouse PCM cache. Transcript, chapter, and metadata state was kept.` });
      host.logs.event('Processing storage', `Cleared ${bytes} bytes of PCM for ${job.name}.`);
    }
    return bytes;
  }

  function processingStorage() {
    const totals = { pcm: 0, transcripts: 0, waveform: 0, other: 0 };
    const directoryBytes = (folder: string): number => fs.readdirSync(folder, { withFileTypes: true }).reduce((sum, entry) => {
      if (entry.isSymbolicLink())
        return sum;
      const file = path.join(folder, entry.name);
      return sum + (entry.isDirectory() ? directoryBytes(file) : entry.isFile() ? fs.statSync(file).size : 0);
    }, 0);
    for (const job of host.store.projects) {
      const root = host.source.projectIntermediatesDir(job);
      if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory() || host.files.pathKey(fs.realpathSync(root)) !== host.files.pathKey(root))
        continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && /^analysis\.wav\.analysis-[0-9a-f-]{36}$/i.test(entry.name)) {
          totals.waveform += directoryBytes(path.join(root, entry.name));
          continue;
        }
        if (!entry.isFile() || entry.isSymbolicLink())
          continue;
        const file = path.join(root, entry.name);
        const bytes = fs.statSync(file).size;
        if (/^(analysis|master|part-\d+)\.wav$/i.test(entry.name))
          totals.pcm += bytes;
        else if (/transcript|word|chapter/i.test(entry.name) && /\.json$/i.test(entry.name))
          totals.transcripts += bytes;
        else if (/waveform|peaks|analysis/i.test(entry.name))
          totals.waveform += bytes;
        else
          totals.other += bytes;
      }
    }
    return totals;
  }

  async function getStorageProcessing(input: CompletionInput): Promise<CompletionReply> {
    try {
      return reply(200, processingStorage());
    }
    catch (error: any) {
      return reply(500, { error: error.message || 'Could not inspect processing storage.' });
    }
  }

  async function postCleanup(input: CompletionInput): Promise<CompletionReply> {
    const busy = cleanupBusyReason();
    if (busy)
      return reply(409, { error: busy });
    const { cleanupType, confirmation } = input.body || {};
    try {
      if (['pcm', 'completed-temp', 'all-temp'].includes(cleanupType)) {
        let removedBytes = 0;
        for (const job of host.store.projects) {
          if (cleanupType === 'completed-temp' && job.processingStatus !== 'complete')
            continue;
          removedBytes += clearProjectPcm(job);
          if (cleanupType !== 'pcm') {
            const root = host.source.projectIntermediatesDir(job);
            if (fs.existsSync(root) && host.files.pathKey(fs.realpathSync(root)) === host.files.pathKey(root))
              for (const entry of fs.readdirSync(root, { withFileTypes: true }))
                if (entry.isFile() && !entry.isSymbolicLink() && (entry.name === 'concat.txt' || /^analysis\.wav\.analysis\.json\.tmp-[0-9a-f-]{36}$/i.test(entry.name))) {
                  const file = path.join(root, entry.name);
                  removedBytes += fs.statSync(file).size;
                  fs.unlinkSync(file);
                }
          }
        }
        host.store.save();
        return reply(200, { status: 'ok', message: `Cleared ${(removedBytes / 1024 ** 3).toFixed(2)} GB of known processing files. Source audio, exports, transcripts, and book state remain.`, jobs: host.store.projects, storage: processingStorage() });
      }
      if (cleanupType === 'cache') {
        const removed = clearManagedDirectory(host.locations.appPath('.cache'));
        fs.mkdirSync(host.locations.appPath('.cache', 'work'), { recursive: true });
        return reply(200, { status: 'ok', message: `Cache cleared${removed ? ` (${removed} item${removed === 1 ? '' : 's'} removed)` : ''}.`, jobs: host.store.projects });
      }
      if (cleanupType === 'logs') {
        const removed = clearManagedDirectory(host.locations.appPath('logs'));
        return reply(200, { status: 'ok', message: `Saved technical logs cleared${removed ? ` (${removed} item${removed === 1 ? '' : 's'} removed)` : ''}.`, jobs: host.store.projects });
      }
      if (cleanupType === 'orphans') {
        const removed = removeOrphanedProjectFolders();
        return reply(200, {
          status: 'ok',
          message: removed ? `Removed ${removed} orphaned working folder${removed === 1 ? '' : 's'}.` : 'No orphaned project files were found.',
          jobs: host.store.projects,
        });
      }
      if (cleanupType === 'all-working') {
        if (confirmation !== 'CLEAR ALL WORKING FILES') {
          return reply(400, { error: "Confirmation mismatch. Type 'CLEAR ALL WORKING FILES' exactly to continue." });
        }
        let removed = clearManagedDirectory(host.locations.upload) + clearManagedDirectory(host.locations.appPath('audiobooks'));
        for (const root of host.source.knownIntermediatesRoots())
          removed += clearManagedDirectory(root);
        removed += clearManagedDirectory(host.locations.appPath('.cache'));
        fs.mkdirSync(host.locations.appPath('.cache', 'work'), { recursive: true });
        for (const job of host.store.projects) {
          resetImportedJobState(job);
          job.logs.push({
            timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
            level: 'WARNING',
            message: 'All managed source copies and generated working files were removed with Free up space. Book details, chapter edits, and finished exports were kept.',
          });
        }
        host.store.save();
        return reply(200, { status: 'ok', message: `All working files and cache were cleared${removed ? ` (${removed} item${removed === 1 ? '' : 's'} removed)` : ''}.`, jobs: host.store.projects });
      }
      return reply(400, { error: 'Unknown cleanup option.' });
    }
    catch (error: any) {
      return reply(500, { error: `Cleanup could not be completed: ${error.message}` });
    }
  }

  async function postJobsPurge(input: CompletionInput): Promise<CompletionReply> {
    const job = host.store.get(input.params.id);
    if (!job) {
      return reply(404, { error: 'Job not found' });
    }
    const busy = cleanupBusyReason();
    if (busy)
      return reply(409, { error: busy });
    const { purgeType, confirmation } = input.body;
    const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
    try {
      if (purgeType === 'source') {
        const requiredPhrase = `PURGE ${job.name}`;
        if (confirmation !== requiredPhrase) {
          return reply(400, {
            error: `Confirmation mismatch. Type '${requiredPhrase}' exactly to remove this book's source copies.`,
          });
        }
        const removed = removeProjectManagedFiles(job, true);
        resetImportedJobState(job);
        job.logs.push({
          timestamp: now(),
          level: 'WARNING',
          message: 'Managed source copies and generated working files were removed. Original source files, book details, chapter edits, and finished exports were kept.',
        });
        host.store.save();
        return reply(200, { status: 'ok', message: `Working files for ${job.name} were removed${removed ? ` (${removed} folder${removed === 1 ? '' : 's'})` : ''}.`, jobs: host.store.projects });
      }
      if (purgeType === 'intermediate') {
        const removed = removeProjectManagedFiles(job, false);
        resetGeneratedJobState(job);
        job.logs.push({
          timestamp: now(),
          level: 'INFO',
          message: 'Generated audio and transcript files were removed. Imported source copies were kept.',
        });
        host.store.save();
        return reply(200, { status: 'ok', message: removed ? 'Generated files for this book were removed.' : 'No generated files were found for this book.', jobs: host.store.projects });
      }
      if (purgeType === 'temp') {
        const removed = removeProjectTemporaryFiles(job);
        job.logs.push({
          timestamp: now(),
          level: 'INFO',
          message: removed ? `Removed ${removed} temporary processing item${removed === 1 ? '' : 's'}.` : 'Temporary file cleanup completed; no disposable files were found.',
        });
        host.store.save();
        return reply(200, { status: 'ok', message: removed ? `Removed ${removed} temporary item${removed === 1 ? '' : 's'} for this book.` : 'No temporary files were found for this book.', jobs: host.store.projects });
      }
      return reply(400, { error: 'Unknown book cleanup option.' });
    }
    catch (error: any) {
      return reply(500, { error: `Cleanup could not be completed: ${error.message}` });
    }
  }
  return { removeManagedChild, clearManagedDirectory, cleanupInProgress, cleanupBusyReason, resetGeneratedJobState, resetImportedJobState, removeProjectManagedFiles, removeOrphanedProjectFolders, removeProjectTemporaryFiles, managedPcmFiles, clearProjectPcm, processingStorage, getStorageProcessing, postCleanup, postJobsPurge };
}
export type CompletionCleanup = ReturnType<typeof createCompletionCleanup>;
