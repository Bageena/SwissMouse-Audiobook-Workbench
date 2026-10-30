import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { bitrateOptions, canCopy, defaultBitrate, outputFormats, stitchCompatibility } from './audio-formats';
import { audiobookTags } from './audio-metadata';
import { planChapterExport } from './chapter-export';
import { applyDefaultChapterEnds, validateChapterEntries } from './chapters';
import type { CompletionCleanup } from './completion-cleanup';
import type { CompletionMetadata } from './completion-metadata';
import type { AudiobookCompletionPorts, CompletionInput, CompletionReply } from './completion-ports';
import { completionReply as reply } from './completion-ports';
import type { OutputAudioFormat } from './legacy-domain';
import { DEFAULT_LIBRARY_TEMPLATE, finalOutputRoot, libraryRelativePath } from './library-path';

export function createCompletionExport(host: AudiobookCompletionPorts, helpers: Pick<CompletionCleanup, 'clearProjectPcm'> & Pick<CompletionMetadata, 'writeCoverImage' | 'writeAudiobookshelfJson'>) {
  const state = host.state;
  const { clearProjectPcm, writeCoverImage, writeAudiobookshelfJson } = helpers;
  async function getJobsExportProgress(input: CompletionInput): Promise<CompletionReply> {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    return reply(200, { running: state.exports.has(job.id), message: state.messages.get(job.id), exports: job.exports || [], status: job.status });
  }

  async function postJobsBuildM4b(input: CompletionInput): Promise<CompletionReply> {
    const job = host.store.get(input.params.id);
    const rejectExport = (status: number, message: string) => {
      host.logs.failure(job?.id, 'Audio export', message);
      console.error(`[Audio export] ${message}`);
      return reply(status, { error: message });
    };
    if (!job?.mergedMp3?.fullPath || job.status === 'draft')
      return rejectExport(400, 'Complete Step 1 first.');
    if (job.staleSteps?.some(step => step === 'chapter_detection' || step === 'chapter_review'))
      return rejectExport(409, 'Rerun and review chapter detection before exporting.');
    const preparedChapters = applyDefaultChapterEnds(job.chapters, job.totalDurationSeconds);
    const chapterError = validateChapterEntries(preparedChapters, job.totalDurationSeconds);
    if (chapterError)
      return rejectExport(400, `Fix chapter timestamps before exporting: ${chapterError}`);
    job.chapters = preparedChapters;
    if (host.work.processing)
      return rejectExport(409, 'Wait for source processing to complete.');
    if (state.exports.has(job.id))
      return rejectExport(409, 'An export is already running.');
    state.exports.add(job.id);
    try {
      let exportSampleRateCeiling: number;
      try {
        const paths = job.parts.map(part => path.resolve(host.locations.appRoot, job.sourceFolderPath || '', part.name));
        if (host.source.archiveCurrent(job) && paths.some(file => !fs.existsSync(file)))
          return rejectExport(400, 'Original audio is in Originals.zip. Restore those audio files before creating another export.');
        if (job.sourceKey !== await host.source.sourceFingerprint(job, paths))
          return rejectExport(409, 'Source audio changed. Run Step 1 again to refresh the transcript and review timeline.');
        // Also cap older, higher-rate cached masters against the original inputs.
        const rates: number[] = [];
        for (const file of paths)
          rates.push((await host.media.inspectAsync(host.media.ffprobe(), file)).sampleRate);
        exportSampleRateCeiling = Math.min(...rates);
        if (!Number.isSafeInteger(exportSampleRateCeiling) || exportSampleRateCeiling <= 0)
          throw new Error('Cannot detect a valid source sample rate.');
      }
      catch (error: any) {
        return rejectExport(400, error.message);
      }
      if (job.exports?.some(e => e.status === 'running' || e.status === 'queued'))
        return rejectExport(409, 'An export is already running.');
      if (state.metadataWriters.has(job.id))
        return rejectExport(409, 'Wait for metadata to finish writing to the exported file.');
      if (input.body.zipOriginals !== undefined && typeof input.body.zipOriginals !== 'boolean')
        return rejectExport(400, 'Choose whether to zip original audio.');
      const requestedFormats = input.body.outputFormats ?? [input.body.outputFormat || 'm4b'];
      if (!Array.isArray(requestedFormats))
        return rejectExport(400, 'Output formats must be a list.');
      const formats = [...new Set(requestedFormats)] as OutputAudioFormat[];
      if (!formats.length || formats.some(f => !outputFormats.includes(f)))
        return rejectExport(400, 'Select supported output formats.');
      if ((job.mergeMethod === 'skip' && job.parts.length > 1) || !fs.existsSync(job.mergedMp3.fullPath)) {
        const cacheMaster = path.join(host.source.projectIntermediatesDir(job), 'master.wav');
        if (job.mergeMethod !== 'skip' && host.files.pathKey(job.mergedMp3.fullPath) !== host.files.pathKey(cacheMaster))
          return rejectExport(400, 'Prepared audio is missing. Run Step 1 again before exporting.');
        try {
          const sources = host.source.sourceFilePaths(job);
          const sourceMedia = sources.map(file => host.media.inspect(host.media.ffprobe(), file));
          const method = job.mergeMethod === 'skip' && stitchCompatibility(sourceMedia.map(info => ({ ...info, isProbed: true }))).compatible ? 'quick' : 'standard';
          const prepared = await host.media.prepare(host.media.ffmpeg(), host.media.ffprobe(), sources, host.source.projectIntermediatesDir(job), method, message => job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message: `Rebuilding PCM for another export: ${message}` }));
          job.mergedMp3.fullPath = prepared.master;
          job.mergedMp3.duration = prepared.durations.reduce((sum, value) => sum + value, 0);
          job.mergedMp3.sizeBytes = fs.statSync(prepared.master).size;
          job.sourceCodec = host.media.inspect(host.media.ffprobe(), prepared.master).codec;
          host.store.save();
        }
        catch (error: any) {
          return rejectExport(400, `Could not rebuild PCM for another export: ${error.message}`);
        }
      }
      try {
        host.media.validateChapters(job.chapters, job.totalDurationSeconds);
      }
      catch (error: any) {
        return rejectExport(400, error.message);
      }
      const outputDir = path.resolve(host.locations.appRoot, finalOutputRoot(job.outputFolderPath, host.locations.output));
      try {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.accessSync(outputDir, fs.constants.W_OK);
      }
      catch (error: any) {
        return rejectExport(400, 'Cannot write output folder: ' + error.message);
      }
      const previousExports = job.exports || [];
      const previousOutput = job.outputM4b;
      const previousValidation = job.validation;
      const snapshot = JSON.parse(JSON.stringify(job));
      const saveCoverBesideAudio = host.config.save_cover_beside_audio !== false;
      const exportPlan = planChapterExport(snapshot.chapters, job.totalDurationSeconds);
      // Record provenance at export time; later chapter edits cannot establish it.
      let playbackSource: Awaited<ReturnType<typeof host.media.playback>> | undefined;
      if (!exportPlan.trimmed) {
        try {
          playbackSource = await host.media.playback(snapshot, { sourcePaths: host.source.sourceFilePaths(snapshot), ffprobe: host.media.ffprobe(), preferFinalized: false, inspect: (tool, file) => host.media.read(tool, file) });
        }
        catch { /* Export can continue; listening positions will restart safely without provenance. */ }
      }
      let libraryParts: string[];
      try {
        libraryParts = libraryRelativePath(host.config.library_template || DEFAULT_LIBRARY_TEMPLATE, snapshot.metadata);
      }
      catch (error: any) {
        return rejectExport(400, error.message);
      }
      const desiredDir = path.resolve(outputDir, ...libraryParts);
      const relativeExportDir = path.relative(outputDir, desiredDir);
      if (relativeExportDir.startsWith('..') || path.isAbsolute(relativeExportDir))
        return rejectExport(400, 'Folder pattern resolves outside the library.');
      const safeName = libraryParts[libraryParts.length - 1];
      // Prefer this project's prior export, then check the selected library path.
      const existingOutputs = new Map<OutputAudioFormat, string>();
      for (const format of formats) {
        const previous = previousExports.find(item => item.format === format && item.status === 'success' && item.fullPath && fs.existsSync(item.fullPath));
        const recordedPath = [job.exportedFiles?.[format], previous?.fullPath,
        previousOutput?.format === format ? previousOutput.fullPath : undefined,
        path.join(desiredDir, safeName + '.' + format)].map(file => file && path.resolve(file)).find(file => {
          if (!file || !fs.existsSync(file))
            return false;
          const relative = path.relative(outputDir, file);
          return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative) && fs.statSync(file).isFile();
        });
        if (!recordedPath)
          continue;
        existingOutputs.set(format, recordedPath);
      }
      const conflictPaths = [...existingOutputs.values()];
      if (conflictPaths.length && (input.body.overwriteExisting !== true ||
        JSON.stringify(input.body.confirmedOverwritePaths) !== JSON.stringify(conflictPaths))) {
        return reply(409, { error: 'An exported audiobook already exists for this book.', requiresOverwriteConfirmation: true, existingFiles: conflictPaths });
      }
      job.outputM4b = null;
      job.validation = null;
      job.exports = formats.map(format => ({ format, status: 'queued', progress: 0 }));
      // New formats still get a new directory; existing formats keep their recorded paths.
      let exportDir = desiredDir;
      for (let copy = 2;fs.existsSync(exportDir);copy++)
        exportDir = `${desiredDir} (${copy})`;
      for (const item of job.exports) {
        const existingTarget = existingOutputs.get(item.format);
        let stagingDir: string | undefined;
        let temporaryCover: string | undefined;
        try {
          item.status = 'running';
          host.store.save();
          stagingDir = existingTarget ? fs.mkdtempSync(path.join(path.dirname(existingTarget), '.swissmouse-export-')) : undefined;
          const destinationDir = stagingDir || exportDir;
          // Export the saved screen values, including defaults such as language.
          // Preserve unrelated source tags, but do not skip unchanged imported fields.
          const tags = audiobookTags(snapshot.metadata, undefined, snapshot.sourceTags, item.format);
          const lossy = !['flac', 'wav'].includes(item.format);
          const selectedRate = input.body.bitrates?.[item.format] ?? defaultBitrate(snapshot.sourceBitrate);
          if (lossy && !bitrateOptions.includes(Number(selectedRate) as any))
            throw new Error('Unsupported bitrate selection');
          const encodingBitrate = input.body.bitrate || ((exportPlan.trimmed || input.body.convert === true || !canCopy(snapshot.sourceCodec, item.format)) && lossy ? selectedRate + 'k' : undefined);
          let cover: string | null | undefined;
          let coverPath: string | undefined;
          const coverUrl = snapshot.metadata?.cover?.url;
          if (coverUrl && saveCoverBesideAudio) {
            coverPath = await writeCoverImage(destinationDir, coverUrl, 'cover');
          }
          if (JSON.stringify(snapshot.metadata?.cover) !== JSON.stringify(snapshot.importedMetadata?.cover)) {
            cover = null;
            if (coverPath)
              cover = coverPath;
            else if (coverUrl) {
              temporaryCover = await writeCoverImage(host.source.projectIntermediatesDir(job), coverUrl, 'export-cover-' + randomUUID());
              cover = temporaryCover;
            }
          }
          fs.mkdirSync(destinationDir, { recursive: true });
          const output = path.join(destinationDir, existingTarget ? path.basename(existingTarget) : safeName + '.' + item.format);
          const result = await host.media.exportAudio({ ffmpeg: host.media.ffmpeg(), ffprobe: host.media.ffprobe(), source: snapshot.mergedMp3.fullPath, output, format: item.format, chapters: snapshot.chapters, tags, cover, convert: input.body.convert === true, bitrate: encodingBitrate, cue: input.body.cue !== false, sampleRateCeiling: exportSampleRateCeiling, onLog: message => { job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'INFO', message: `${item.format.toUpperCase()} export: ${message}` }); host.store.progress(); }, onProgress: n => { item.progress = n; host.store.progress(); } });
          if (existingTarget) {
            const replacements: {
              from?: string;
              to: string;
            }[] = [{ from: output, to: existingTarget }, { from: fs.existsSync(output + '.cue') ? output + '.cue' : undefined, to: existingTarget + '.cue' }];
            if (coverPath)
              replacements.push({ from: coverPath, to: path.join(path.dirname(existingTarget), path.basename(coverPath)) });
            const backups: {
              backup: string;
              to: string;
            }[] = [];
            const installed: string[] = [];
            try {
              for (const replacement of replacements) {
                if (fs.existsSync(replacement.to)) {
                  const backup = replacement.to + '.' + randomUUID() + '.backup';
                  fs.renameSync(replacement.to, backup);
                  backups.push({ backup, to: replacement.to });
                }
                if (replacement.from) {
                  fs.renameSync(replacement.from, replacement.to);
                  installed.push(replacement.to);
                }
              }
            }
            catch (error) {
              for (const installedPath of installed.reverse())
                fs.rmSync(installedPath, { force: true });
              for (const { backup, to } of backups.reverse())
                fs.renameSync(backup, to);
              throw error;
            }
            for (const { backup } of backups)
              fs.rmSync(backup, { force: true });
            if (coverPath)
              coverPath = path.join(path.dirname(existingTarget), path.basename(coverPath));
            result.fullPath = existingTarget;
          }
          Object.assign(result, {
            fileIdentity: (await host.files.stamp(result.fullPath)).identity,
            ...(playbackSource && Math.abs(result.duration - playbackSource.manifest.totalDurationSeconds) <= 0.15
              ? { playbackSourceSignature: playbackSource.manifest.signature } : {})
          });
          Object.assign(item, result, { coverPath, status: 'success' });
          if (coverPath)
            host.source.associateProjectFile(job, coverPath, 'cover');
          job.exportedFiles = { ...job.exportedFiles, [item.format]: result.fullPath };
          job.outputM4b = result;
          job.status = 'built';
          try {
            for (const file of writeAudiobookshelfJson({ ...job, metadata: snapshot.metadata, chapters: snapshot.chapters }, [result.fullPath]))
              host.source.associateProjectFile(job, file, 'metadata');
            if (fs.existsSync(result.fullPath + '.cue'))
              host.source.associateProjectFile(job, result.fullPath + '.cue', 'chapters');
          }
          catch (error: any) {
            item.warnings = [...(item.warnings || []), `Audiobook exported, but exmetadata.json could not be written: ${error.message}`];
            job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'ERROR', message: item.warnings[item.warnings.length - 1] });
          }
          fs.rmSync(result.fullPath + '.ffmeta', { force: true });
        }
        catch (error: any) {
          item.status = 'failed';
          item.error = error.message;
          console.error(`[Export ${item.format}] ${error.stack || error.message}`);
          job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'ERROR', message: `Audio export failed (${item.format.toUpperCase()}). ${error.message}` });
        }
        finally {
          if (temporaryCover)
            fs.rmSync(temporaryCover, { force: true });
          if (stagingDir) {
            try {
              fs.rmSync(stagingDir, { recursive: true, force: true });
            }
            catch (error: any) {
              job.logs.push({ timestamp: new Date().toISOString(), level: 'WARNING', message: 'Export temporary folder retained: ' + error.message });
            }
          }
        }
        host.store.save();
      }
      const succeeded = job.exports.some(item => item.status === 'success');
      const attemptedExports = job.exports;
      if (!succeeded && (previousOutput || previousExports.length)) {
        job.exports = previousExports;
        job.outputM4b = previousOutput;
        job.validation = previousValidation;
        host.store.save();
      }
      if (succeeded)
        job.staleSteps = (job.staleSteps || []).filter(step => step !== 'export');
      if (attemptedExports.length && attemptedExports.every(item => item.status === 'success') && (host.config.pcm_retention || 'after_verified_export') === 'after_verified_export') {
        try {
          for (const item of attemptedExports) {
            if (!item.fullPath || !fs.statSync(item.fullPath).isFile())
              throw new Error('Export file is missing.');
            const checked = await host.media.inspectAsync(host.media.ffprobe(), item.fullPath);
            if (Math.abs(checked.durationSeconds - exportPlan.durationSeconds) > 0.15)
              throw new Error('Export duration differs from the reviewed timeline.');
          }
          clearProjectPcm(job);
        }
        catch (error: any) {
          job.logs.push({ timestamp: new Date().toISOString(), level: 'WARNING', message: `PCM kept because export read-back verification did not pass: ${error.message}` });
        }
        host.store.save();
      }
      if (input.body.zipOriginals === true && attemptedExports.every(item => item.status === 'success')) {
        host.work.moving = true;
        job.originalsArchiveError = undefined;
        try {
          // Establish sidecar ownership while source audio is still present. After
          // archiving removes it, a folder scan cannot safely infer those links.
          await host.source.backfillProjectCompanions(job);
          const outputs = new Set(host.source.exportedAudioPaths(job).map(host.files.pathKey));
          const originals = host.source.sourceFilePaths(job);
          if (originals.some(file => outputs.has(host.files.pathKey(file))))
            throw new Error('An original is also a finished output. It was not archived or deleted.');
          const protectedFiles = new Set(host.store.projects.filter(other => other.id !== job.id && !other.libraryScan?.superseded).flatMap(other => host.source.projectFilePaths(other)).map(host.files.pathKey));
          const { warning } = await host.archive.create({
            folder: path.dirname(job.outputM4b!.fullPath!), sourceKey: job.sourceKey!,
            sources: originals.map((source, index) => ({ source, name: host.source.sourceRelative(job, job.parts[index]) })), protectedFiles,
            journal: host.locations.appPath('originals-archive-' + randomUUID() + '.json'),
            log: message => { state.messages.set(job.id, message); job.logs.push({ timestamp: new Date().toISOString(), level: 'INFO', message }); },
            commit: archive => {
              const previousArchive = job.originalsArchive, previousFiles = job.associatedFiles;
              job.originalsArchive = archive;
              host.source.associateProjectFile(job, archive.path, 'sidecar');
              try {
                host.store.save();
              }
              catch (error) {
                job.originalsArchive = previousArchive;
                job.associatedFiles = previousFiles;
                throw error;
              }
            }
          });
          if (warning)
            job.originalsArchiveError = warning;
        }
        catch (error: any) {
          job.originalsArchiveError = error.message;
          job.logs.push({ timestamp: new Date().toISOString(), level: 'ERROR', message: 'Originals archive: ' + error.message });
        }
        finally {
          host.work.moving = false;
        }
        host.store.save();
      }
      return reply(succeeded ? 200 : 500, { status: succeeded ? 'ok' : 'error', error: succeeded ? undefined : attemptedExports.map(item => item.error).join('; '), exports: attemptedExports, outputM4b: job.outputM4b });
    }
    finally {
      state.exports.delete(job.id);
      state.messages.delete(job.id);
      // Setup, persistence and cleanup failures must never leave queued/running
      // records blocking every future conversion and library operation.
      const current = host.store.get(job.id);
      const unfinished = current?.exports?.filter(item => ['running', 'queued'].includes(item.status)) || [];
      for (const item of unfinished) {
        item.status = 'failed';
        item.error = 'Export stopped before completion. Check the technical log and retry.';
      }
      if (unfinished.length) {
        try {
          host.store.flushStopped();
          host.catalog?.invalidate();
        }
        catch (error: any) {
          host.logs.event('Audio export', 'Could not persist stopped export: ' + error.message, 'ERROR');
        }
      }
    }
  }

  async function postJobsExportOpenFolder(input: CompletionInput): Promise<CompletionReply> {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Project not found.' });
    const exportedFile = job.outputM4b?.fullPath || (job.outputM4b?.filename
      ? path.join(job.outputFolderPath || host.locations.output, job.outputM4b.filename)
      : undefined);
    if (!job.validation || !exportedFile || job.validation.file !== job.outputM4b?.filename) {
      return reply(400, { error: 'Complete the final check before opening the export folder.' });
    }
    let directory: string;
    try {
      if (!fs.statSync(exportedFile).isFile())
        throw new Error('Export is not a file.');
      directory = path.dirname(fs.realpathSync(exportedFile));
    }
    catch {
      return reply(404, { error: 'The exported file is no longer at its saved location.' });
    }
    try {
      await host.system.openFolder(directory);
      return reply(200, { status: 'ok', directory });
    }
    catch (error: any) {
      return reply(500, { error: `Could not open the folder: ${error.message}` });
    }
  }

  async function getJobsExportCandidatesCsv(input: CompletionInput): Promise<CompletionReply> {
    const responseHeaders: Record<string, string> = {};
    const job = host.store.get(input.params.id);
    if (!job)
      return { status: 404, body: null, headers: responseHeaders, text: 'Job not found' };
    const headers = [
      "candidate_id", "candidate_start", "candidate_end", "matched_text",
      "context_before", "context_after", "confidence", "proposed_title",
      "approved_start", "approved_title", "status", "notes"
    ];
    let csv = headers.join(',') + '\n';
    for (const c of job.candidates) {
      const escapeCsv = (val: string = '') => `"${val.replace(/"/g, '""')}"`;
      csv += [
        c.candidate_id,
        escapeCsv(c.candidate_start),
        escapeCsv(c.candidate_end),
        escapeCsv(c.matched_text),
        escapeCsv(c.context_before),
        escapeCsv(c.context_after),
        c.confidence,
        escapeCsv(c.proposed_title),
        escapeCsv(c.approved_start || ''),
        escapeCsv(c.approved_title || ''),
        c.status,
        escapeCsv(c.notes || ''),
      ].join(',') + '\n';
    }
    responseHeaders['Content-Type'] = 'text/csv';
    responseHeaders['Content-Disposition'] = `attachment; filename="${job.name}-candidates.csv"`;
    return { status: 200, body: null, headers: responseHeaders, text: csv };
  }
  return { getJobsExportProgress, postJobsBuildM4b, postJobsExportOpenFolder, getJobsExportCandidatesCsv };
}
export type CompletionExport = ReturnType<typeof createCompletionExport>;
