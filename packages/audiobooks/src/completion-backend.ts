import fs from 'node:fs';
import path from 'node:path';
import { createCompletionCleanup } from './completion-cleanup';
import { createCompletionExport } from './completion-export';
import { createCompletionMetadata } from './completion-metadata';
import type { AudiobookCompletionPorts, CompletionInput, CompletionReply, FinishLocation } from './completion-ports';
import { completionReply as reply } from './completion-ports';
import type { AudiobookJob } from './legacy-domain';
import { DEFAULT_LIBRARY_TEMPLATE, libraryRelativePath } from './library-path';

export function createAudiobookCompletionBackend(host: AudiobookCompletionPorts) {
  const state = host.state;
  const { removeManagedChild, clearManagedDirectory, cleanupInProgress, cleanupBusyReason, resetGeneratedJobState, resetImportedJobState, removeProjectManagedFiles, removeOrphanedProjectFolders, removeProjectTemporaryFiles, managedPcmFiles, clearProjectPcm, processingStorage, getStorageProcessing, postCleanup, postJobsPurge } = createCompletionCleanup(host);
  const { savedAudiobookshelfPaths, writeAudiobookshelfJson, writeCoverImage, postLibraryWriteAudioMetadata } = createCompletionMetadata(host);
  const { getJobsExportProgress, postJobsBuildM4b, postJobsExportOpenFolder, getJobsExportCandidatesCsv } = createCompletionExport(host, { clearProjectPcm, writeCoverImage, writeAudiobookshelfJson });

  function finalCheckFiles(job: AudiobookJob) {
    return job.outputM4b ? [...new Set(host.files.projectFiles(job, []).filter(file => file.roles.includes('output')).map(file => file.path))] : host.source.sourceFilePaths(job);
  }
  function currentFinalCheckSignature(job: AudiobookJob) {
    return host.checks.signature(job, host.config, finalCheckFiles(job), host.source.availableOriginalPaths(job), [...(job.previewPath ? [job.previewPath, job.previewPath + '.analysis.json'] : []), ...(job.originalsArchive?.path ? [job.originalsArchive.path] : []), ...(job.retainedWaveform ? [job.retainedWaveform.audio + '.analysis.json'] : [])]);
  }
  function assertFinishReady(job: AudiobookJob) {
    if (!job.finalCheck || job.finalCheck.state !== 'complete' || job.finalCheck.items.some(item => item.status === 'failed') || job.finalCheck.inputSignature !== currentFinalCheckSignature(job))
      throw new Error('Run a current Final Check and fix required items before finishing.');
  }
  function finishPlan(job: AudiobookJob, location: FinishLocation) {
    assertFinishReady(job);
    if (location === 'current')
      return { location, target: host.source.bookSourceRoot(job) || path.dirname(job.outputM4b?.fullPath || ''), alreadyOrganized: true, conflict: false, files: host.source.projectFilePaths(job) };
    const root = path.resolve(location === 'inbox' ? host.config.inbox_folder || host.locations.appPath('inbox') : host.locations.output);
    const target = path.resolve(root, ...libraryRelativePath(host.config.library_template || DEFAULT_LIBRARY_TEMPLATE, job.metadata!));
    if (!host.source.isManagedChild(root, target))
      throw new Error('The folder pattern resolves outside the configured location.');
    const sourceRoot = host.source.bookSourceRoot(job);
    const folders = [...new Set(host.source.projectFilePaths(job).filter(file => fs.existsSync(file)).map(file => path.dirname(file)))];
    const alreadyOrganized = !!sourceRoot && host.files.pathKey(sourceRoot) === host.files.pathKey(target) && folders.every(folder => host.files.pathKey(folder) === host.files.pathKey(target) || host.files.within(target, folder));
    return { location, root, target, alreadyOrganized, conflict: !alreadyOrganized && host.source.pathEntryExists(target), files: host.source.projectFilePaths(job) };
  }

  async function getJobsFinalCheck(input: CompletionInput): Promise<CompletionReply> {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    const run = state.checks.get(job.id);
    return reply(200, {
      running: !!run, message: run?.message, items: run?.items, report: job.finalCheck,
      outdated: !!job.finalCheck && job.finalCheck.inputSignature !== currentFinalCheckSignature(job)
    });
  }
  async function postJobsFinalCheckCancel(input: CompletionInput): Promise<CompletionReply> {
    const run = state.checks.get(input.params.id);
    if (run) {
      run.message = 'Cancelling…';
      run.controller.abort();
    }
    return reply(200, { status: 'ok' });
  }
  async function postJobsFinalCheckRepair(input: CompletionInput): Promise<CompletionReply> {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    if (state.validating || host.work.processing || host.work.imports.size || state.metadataWriters.size || host.work.mutations > 1 || host.store.projects.some(item => item.exports?.some(output => ['running', 'queued'].includes(output.status))))
      return reply(409, { error: 'Wait for current file operations to finish.' });
    if (!job.outputM4b)
      return reply(400, { error: 'Convert into a dedicated book folder before repairing sidecars.' });
    const files = finalCheckFiles(job);
    state.metadataWriters.add(job.id);
    try {
      if (input.body.kind === 'sidecar')
        writeAudiobookshelfJson(job, files);
      else if (input.body.kind === 'cover') {
        if (host.config.save_cover_beside_audio === false || !job.metadata?.cover?.url)
          return reply(400, { error: 'Enable cover saving and select a cover in Metadata first.' });
        for (const folder of [...new Set(files.map(file => path.dirname(file)))]) {
          host.files.assertSidecarOwnership(job, folder, host.store.projects, host.source.sourceFilePaths, host.files.extensions);
          if (['cover.jpg', 'cover.png'].some(name => {
            try {
              return fs.statSync(path.join(folder, name)).size > 0;
            }
            catch {
              return false;
            }
          }))
            continue;
          host.source.associateProjectFile(job, await writeCoverImage(folder, job.metadata.cover.url, 'cover'), 'cover');
        }
      }
      else
        return reply(400, { error: 'Unsupported repair. Return to Metadata, Chapters, or Processing.' });
      job.processingStatus = 'incomplete';
      host.store.save();
      return reply(200, { status: 'ok' });
    }
    finally {
      state.metadataWriters.delete(job.id);
    }
  }
  async function getJobsFinish(input: CompletionInput): Promise<CompletionReply> {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    const location = input.query.location as FinishLocation;
    if (!['current', 'inbox', 'library'].includes(location))
      return reply(400, { error: 'Choose a finish location.' });
    try {
      const plan = finishPlan(job, location);
      if (location === 'library' && plan.conflict && await host.source.ownedProjectDestination(job, plan.target))
        plan.conflict = false;
      return reply(200, plan);
    }
    catch (error: any) {
      return reply(409, { error: error.message });
    }
  }
  async function postJobsFinish(input: CompletionInput): Promise<CompletionReply> {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    const location = input.body.location as FinishLocation;
    if (!['current', 'inbox', 'library'].includes(location))
      return reply(400, { error: 'Choose a finish location.' });
    if (host.work.mutations > 1 || host.work.processing || host.work.imports.size || state.metadataWriters.size || host.store.projects.some(item => item.exports?.some(output => ['running', 'queued'].includes(output.status))))
      return reply(409, { error: 'Wait for current file operations to finish.' });
    try {
      const plan = finishPlan(job, location);
      if (plan.target !== input.body.target)
        return reply(409, { error: 'The destination changed. Review the location again.' });
      if (plan.conflict && !(location === 'library' && await host.source.ownedProjectDestination(job, plan.target)))
        return reply(409, { error: 'Destination already exists; existing files were kept.' });
      host.work.moving = true;
      let warning: string | undefined;
      job.processingStatus = 'complete';
      job.completionSignature = await host.source.completionSignature(job);
      if (location !== 'current' && !plan.alreadyOrganized) {
        warning = await host.source.transferAssociatedProject(job, plan.target, 'move', { finalCheck: true, destinationRoot: plan.root, destinationKind: location === 'inbox' ? 'inbox' : 'managed' });
      }
      // Only disposable SwissMouse PCM is removed. Analysis levels and transcript
      // state remain in the project's processing workspace for later use.
      const clearedBytes = clearProjectPcm(job);
      job.finishedAt = new Date().toISOString();
      job.finishLocation = location;
      job.importFinished = true;
      job.lastCompletedAt = job.finishedAt;
      job.completionSignature = await host.source.completionSignature(job);
      if (job.finalCheck) {
        job.finalCheck.inputSignature = currentFinalCheckSignature(job);
      }
      job.logs.push({ timestamp: job.finishedAt, level: 'INFO', message: `Finished in ${location}; cleared ${clearedBytes} bytes of temporary PCM. Waveform and transcript retained.` });
      host.store.save();
      await host.catalog!.publish([job.id]);
      return reply(200, { job: { ...job, canMoveToLibrary: host.source.canMoveInboxBook(job) }, warning, clearedBytes, path: plan.target });
    }
    catch (error: any) {
      return reply(409, { error: error.message || 'Could not finish. Original files were kept if transfer verification failed.' });
    }
    finally {
      host.work.moving = false;
    }
  }
  async function postJobsValidate(input: CompletionInput): Promise<CompletionReply> {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    if (state.validating || host.work.mutations > 1 || host.work.imports.size || host.work.processing || state.metadataWriters.size || host.store.projects.some(item => item.exports?.some(output => ['running', 'queued'].includes(output.status))))
      return reply(409, { error: 'Wait for current file operations before the final check.' });
    const run = { controller: new AbortController(), message: 'Starting final check…', items: [] as import("./legacy-domain").FinalCheckItem[] };
    state.checks.set(job.id, run);
    state.validating = true;
    job.processingStatus = 'incomplete';
    let initialSignature = '';
    try {
      initialSignature = currentFinalCheckSignature(job);
      const snapshot = host.store.snapshot(job);
      const report = await host.checks.run({
        job: snapshot, config: { ...host.config }, files: finalCheckFiles(job), originals: host.source.availableOriginalPaths(job), artifacts: {}, ffmpeg: host.media.ffmpeg(), ffprobe: host.media.ffprobe(), signal: run.controller.signal,
        progress: (message, items) => { run.message = message; run.items = [...items]; }
      });
      if (initialSignature !== currentFinalCheckSignature(job))
        report.items.push({ id: 'changed', label: 'Files or settings changed', status: 'failed', detail: 'Inputs changed while checking. Save your work and run Final Check again.' });
      job.finalCheck = report;
      job.validations = report.files.map(file => {
        const index = finalCheckFiles(job).indexOf(file.file);
        const failures = report.items.filter(item => item.status === 'failed' && (item.id.startsWith(`file-${index}-`) || !item.id.startsWith('file-')));
        return { file: file.file, size_mb: Number(((fs.existsSync(file.file) ? fs.statSync(file.file).size : 0) / 1048576).toFixed(2)), duration_seconds: file.duration, chapters_count: file.chapters, status: failures.length ? 'FAIL' as const : 'PASS' as const, reason: failures.map(item => item.detail).join('\n') || 'Full decoding, timestamps, metadata, chapters, sidecars and duration checked. Player navigation has not been tested.' };
      });
      const failed = report.items.some(item => item.status === 'failed');
      const summary = job.validations.find(item => item.status === 'FAIL') || job.validations[job.validations.length - 1] || { file: job.name, size_mb: 0, duration_seconds: report.expectedDuration, chapters_count: job.chapters.length, status: 'FAIL' as const, reason: 'No readable audio files.' };
      job.validation = { ...summary, file: job.outputM4b?.filename || summary.file, status: failed ? 'FAIL' : summary.status };
      let { status, reason } = job.validation;
      if (job.outputM4b) {
        job.status = status === 'FAIL' ? 'built' : 'validated';
        if (status !== 'FAIL')
          job.staleSteps = (job.staleSteps || []).filter(step => step !== 'validation');
        job.processingStatus = 'incomplete';
        if (status === 'PASS' && !(job.staleSteps || []).some(step => ['export', 'chapter_review', 'chapter_detection'].includes(step))) {
          try {
            if (job.sourceKey && !host.source.archiveCurrent(job) && job.sourceKey !== await host.source.sourceFingerprint(job, host.source.sourceFilePaths(job)))
              throw new Error('Source audio changed since processing. Run Step 1 and export again before finalizing.');
            job.completionSignature = await host.source.completionSignature(job);
            job.processingStatus = 'complete';
            job.lastCompletedAt = new Date().toISOString();
            host.logs.event('Library', `Processing status changed to complete: ${job.name}`);
          }
          catch (error: any) {
            status = 'FAIL';
            reason = error.message;
            job.validation.status = status;
            job.validation.reason = reason;
            job.status = 'built';
            report.items.push({ id: 'completion', label: 'Source identity', status: 'failed', detail: error.message, fix: 'processing' });
            host.logs.failure(job.id, 'Completion', error.message);
          }
        }
        if (job.processingStatus === 'complete' && host.config.pcm_retention === 'until_finalized') {
          try {
            clearProjectPcm(job);
          }
          catch (error: any) {
            job.logs.push({ timestamp: new Date().toISOString(), level: 'WARNING', message: `PCM cleanup did not finish: ${error.message}` });
          }
        }
      }
      else {
        job.processingStatus = 'incomplete';
      }
      // Cleanup can remove preview PCM. Stamp the final filesystem state, so the
      // successful check does not invalidate itself immediately after cleanup.
      if ((!job.previewPath || !fs.existsSync(job.previewPath)) && !job.retainedWaveform) {
        const waveform = report.items.find(item => item.id === 'waveform');
        if (waveform) {
          waveform.status = 'optional';
          waveform.detail = 'Waveform cache is unavailable or was cleared by your storage setting.';
        }
      }
      report.inputSignature = currentFinalCheckSignature(job);
      job.logs.push({ timestamp: new Date().toISOString(), level: job.validation.status === 'FAIL' ? 'ERROR' : 'INFO', message: `Final Check: ${job.validation.status}. ${report.files.length} audio files, ${report.removedSeconds.toFixed(3)} seconds intentionally cut.` });
      host.store.save();
      await host.catalog!.publish([job.id]);
      return reply(200, { status: 'ok', validation: job.validation, validations: job.validations, finalCheck: job.finalCheck });
    }
    catch (error: any) {
      if (run.controller.signal.aborted) {
        job.finalCheck = { checkedAt: new Date().toISOString(), inputSignature: initialSignature, state: 'cancelled', items: run.items, files: [], sourceDuration: job.totalDurationSeconds, expectedDuration: job.totalDurationSeconds, removedSeconds: 0 };
        job.processingStatus = 'incomplete';
        host.store.save();
        return reply(200, { status: 'cancelled' });
      }
      job.finalCheck = { checkedAt: new Date().toISOString(), inputSignature: initialSignature, state: 'complete', items: [...run.items, { id: 'check-error', label: 'Check could not finish', status: 'failed', detail: error.message, fix: 'processing' }], files: [], sourceDuration: job.totalDurationSeconds, expectedDuration: job.totalDurationSeconds, removedSeconds: 0 };
      job.processingStatus = 'incomplete';
      host.store.save();
      return reply(500, { error: error.message });
    }
    finally {
      state.checks.delete(job.id);
      state.validating = false;
    }
  }

  async function recoverArchives() {
    for (const name of fs.readdirSync(host.locations.appRoot).filter(name => /^originals-archive-[\w-]+\.json$/.test(name))) {
      try {
        await host.archive.restore(host.locations.appPath(name));
        host.logs.event('Originals archive', 'Interrupted original cleanup recovered: ' + name, 'WARNING');
      }
      catch (error: any) {
        host.logs.event('Originals archive', 'Original audio recovery needs attention: ' + name + ': ' + error.message, 'ERROR');
      }
    }
  }
  return { recover: recoverArchives, helpers: { removeManagedChild, clearManagedDirectory, cleanupInProgress, cleanupBusyReason, resetGeneratedJobState, resetImportedJobState, removeProjectManagedFiles, removeOrphanedProjectFolders, removeProjectTemporaryFiles, managedPcmFiles, clearProjectPcm, processingStorage, savedAudiobookshelfPaths, writeAudiobookshelfJson, writeCoverImage, finalCheckFiles, currentFinalCheckSignature, assertFinishReady, finishPlan }, commands: { getStorageProcessing, postLibraryWriteAudioMetadata, getJobsExportProgress, postJobsBuildM4b, getJobsFinalCheck, postJobsFinalCheckCancel, postJobsFinalCheckRepair, getJobsFinish, postJobsFinish, postJobsValidate, postJobsExportOpenFolder, postCleanup, postJobsPurge, getJobsExportCandidatesCsv } };
}
export type AudiobookCompletionBackend = ReturnType<typeof createAudiobookCompletionBackend>;
