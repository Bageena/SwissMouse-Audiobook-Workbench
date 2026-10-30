import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { promisify } from 'node:util';
import { initialDetectedChapters } from './chapter-suggestions';
import { applyDefaultChapterEnds } from './chapters';
import type { AudiobookMetadata, ChapterEntry, RerunnablePipelineStep } from './domain';
import { formatTimestamp, generateFFMetaContent } from './ffmetadata';
import { fileReply as reply } from './file-ports';
import type { AudiobookJob, ChapterCandidate } from './legacy-domain';
import { canRerunStep, canReviewChapters, hasManualChapterWork } from './pipeline-eligibility';
import { beginStepRerun, completeStepRerun, failStepRerun, markDependentResultsStale } from './pipeline-state';
import { buildChapterCandidates, createProcessingDetection } from './processing-detection';
import type { AudiobookProcessingPorts, ProcessingCommandInput } from './processing-ports';
import { createProcessingSpeech } from './processing-speech';
import type { Step1ProcessStage, Step1ProgressStage } from './processing-state';
import { createAudiobookProcessingState } from './processing-state';
import { hasExplicitSourceOrder, manualChapterGroups, sourceChapterGroups, sourceOrderCompare } from './source-structure';
import { reusableTranscription, sourceProcessingKeys } from './transcription-cache';
import { transcriptionSettings } from './transcription-policy';
import { buildTranscriptWords } from './word-alignment';
const execFileAsync = promisify(execFile);

export function createAudiobookProcessingBackend(host: AudiobookProcessingPorts, state = createAudiobookProcessingState()) {
  const { transcriptionPlan, transcribeExistingPreview } = createProcessingSpeech(host, logStep1);
  const { chapterDetectionCacheKey, logChapterDetectionResult, improvedChapterCandidates } = createProcessingDetection(host, logStep1);

  const speechRecognitionStages: Step1ProgressStage[] = [
    { key: 'scanning_folder', label: 'Inspect source audio', desc: 'Verify each input file and read its audio metadata.' },
    { key: 'merging_audio', label: 'Prepare master audio', desc: 'Normalize and stitch audio, or verify a direct stitch.' },
    { key: 'generating_waveform', label: 'Generate waveform (optional)', desc: 'Create waveform data for chapter review.' },
    { key: 'transcribing_whisper', label: 'Speech recognition', desc: 'Transcribe the recording with the selected local Whisper engine.' },
    { key: 'detecting_chapters', label: 'Detect chapter candidates', desc: 'Find headings and refine their timestamps from the transcript.' },
    { key: 'saving_project', label: 'Finalize for review', desc: 'Save the transcript and proposed chapter markers for review.' },
  ];

  const directChapterStages: Step1ProgressStage[] = [
    { key: 'scanning_folder', label: 'Inspect source audio', desc: 'Verify each input file and read its audio metadata.' },
    { key: 'merging_audio', label: 'Prepare master audio', desc: 'Normalize and stitch audio, or verify a direct stitch.' },
    { key: 'generating_waveform', label: 'Generate waveform (optional)', desc: 'Create waveform data for chapter review.' },
    { key: 'extracting_chapters', label: 'Create chapters from files', desc: 'Derive chapter markers from the source-file structure.' },
    { key: 'saving_project', label: 'Finalize for review', desc: 'Save the chapter markers for review.' },
  ];

  function validatedTranscriptionSettingsMap(input: unknown): AudiobookJob['transcriptionSettings'] {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid transcription settings');
    return Object.fromEntries(Object.entries(input).map(([engine, value]) => {
      if (engine !== 'faster-whisper' && engine !== 'openai-whisper')
        throw new Error('Unknown transcription engine');
      return [engine, transcriptionSettings(engine, value)];
    }));
  }

  function setStep1Stage(stage: Step1ProcessStage, task: string, logDetail?: string) {
    const previousStage = state.progress.stage;
    const previousIndex = state.progress.stages.findIndex(item => item.key === previousStage);
    const index = state.progress.stages.findIndex(item => item.key === stage);
    const definition = state.progress.stages[index];
    if (previousIndex >= 0 && previousStage !== stage) {
      logStep1(`Stage ${previousIndex + 1}/${state.progress.totalStages} completed: ${state.progress.stages[previousIndex].label}.`);
    }
    state.progress.stage = stage;
    state.progress.currentStageNumber = index >= 0 ? index + 1 : 0;
    state.progress.label = definition?.label || task;
    state.progress.currentTask = task;
    state.progress.liveStatusMessage = task;
    if (logDetail)
      logStep1(`Stage ${index + 1}/${state.progress.totalStages} started: ${logDetail}`);
  }

  function failStep1Stage(error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    const failedStage = state.progress.stage;
    const definition = state.progress.stages.find(item => item.key === failedStage);
    state.progress.isActive = false;
    state.progress.canCancel = false;
    state.progress.failedStage = failedStage;
    state.progress.stage = 'error';
    state.progress.error = `${definition?.label || 'Processing'} failed: ${detail}`;
    state.progress.liveStatusMessage = state.progress.error;
    logStep1(`ERROR: ${state.progress.error}`);
  }

  function logStep1(msg: string) {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${msg}`;
    state.progress.logs.push(formatted);
    host.logs.event(`Step 1 ${state.jobId || ''}`.trim(), msg, msg.startsWith('ERROR:') ? 'ERROR' : 'INFO');
    const terminalMessage = `[Step1: ${state.jobId || 'Global'}] ${formatted}`;
    if (msg.startsWith('ERROR:'))
      console.error(terminalMessage);
    else
      console.log(terminalMessage);
  };

  const rerunnableSteps = new Set<RerunnablePipelineStep>(['generating_waveform', 'transcribing_whisper', 'detecting_chapters', 'extracting_chapters', 'metadata_processing']);

  async function processSource(input: ProcessingCommandInput) {
    if (host.work.installing)
      return reply(409, { error: 'Wait for runtime installation to finish.' });
    if (state.running)
      return reply(409, { error: 'Another source is being processed or finishing cancellation.' });
    state.jobId = input.params.id;
    const job = host.store.get(input.params.id);
    if (!job) {
      return reply(404, { error: 'Job not found' });
    }
    if (host.work.imports.has(job.id) || job.exports?.some(e => ['running', 'queued'].includes(e.status)))
      return reply(409, { error: 'Wait for import or export to finish.' });
    const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
    const requestedEngine = host.runtime.engine(undefined);
    const { chapterSource = job.chapterSource || 'whisperx', mergeMethod = job.mergeMethod || 'standard', generateTranscript = job.generateTranscript || false, generateWaveform = job.generateWaveform || false, selectedModelId = job.selectedModelId || 'small', sourceFolderPath = job.sourceFolderPath, outputFolderPath = job.outputFolderPath || host.locations.output, parts = null, } = input.body || {};
    if (input.body?.transcriptionSettings !== undefined) {
      try {
        job.transcriptionSettings = validatedTranscriptionSettingsMap(input.body.transcriptionSettings);
      }
      catch (error: any) {
        return reply(400, { error: error.message });
      }
    }
    // A run may reorder the manifest, but must not silently attach a stale browser
    // inventory. Membership changes go through the source-file actions.
    if (job.source) {
      const saved = job.parts.map(part => part.name).sort();
      const requested = Array.isArray(parts) ? parts.map((part: any) => part.name).sort() : saved;
      if (sourceFolderPath !== job.sourceFolderPath || JSON.stringify(saved) !== JSON.stringify(requested))
        return reply(409, { error: 'Project files changed. Refresh Review Files before processing.' });
    }
    if (!['whisperx', 'existing_files', 'grouped_files', 'existing_chapters', 'manual'].includes(chapterSource))
      return reply(400, { error: 'Choose a supported chapter source.' });
    if (!['standard', 'quick', 'skip'].includes(mergeMethod))
      return reply(400, { error: 'Choose a supported audio preparation method.' });
    const runTranscript = chapterSource === 'whisperx' || generateTranscript === true;
    if (chapterSource === 'grouped_files') {
      try {
        manualChapterGroups(job.parts);
      }
      catch (error: any) {
        return reply(400, { error: error.message });
      }
    }
    const previousChapterSource = job.chapterSource;
    const selectedTranscriptionSettings = job.transcriptionSettings;
    const previousMergeMethod = job.mergeMethod;
    const previousPreparedDurations = job.parts.map(part => part.durationSeconds);
    // Update job settings
    job.chapterSource = chapterSource;
    job.mergeMethod = mergeMethod;
    job.generateTranscript = generateTranscript === true;
    job.generateWaveform = generateWaveform === true;
    if (!job.generateWaveform)
      job.waveformReady = false;
    job.selectedModelId = selectedModelId;
    if (sourceFolderPath)
      job.sourceFolderPath = sourceFolderPath;
    if (outputFolderPath)
      job.outputFolderPath = outputFolderPath;
    job.outputFolderPath = host.source.resolvedOutputRoot(job);
    // Update parts if provided from folder import
    if (Array.isArray(parts) && parts.length > 0) {
      job.parts = parts.map((p: any, idx: number) => ({
        id: p.id || `p-${idx + 1}`,
        name: p.name || `part_${idx + 1}.mp3`,
        sourceRelativePath: p.sourceRelativePath,
        chapterGroup: job.parts.find(part => part.name === p.name)?.chapterGroup,
        discNumber: p.discNumber,
        trackNumber: p.trackNumber,
        sizeBytes: p.sizeBytes || 25000000,
        durationSeconds: p.durationSeconds || 1500,
        bitrate: p.bitrate || 128,
        order: idx + 1,
      })).sort(job.sourceOrderManual ? (a, b) => a.order - b.order : sourceOrderCompare);
      job.totalDurationSeconds = job.parts.reduce((acc, p) => acc + p.durationSeconds, 0);
      job.totalSizeBytes = job.parts.reduce((acc, p) => acc + p.sizeBytes, 0);
    }
    if (job.parts.length === 0) {
      return reply(400, { error: 'No MP3 files found in the selected folder.' });
    }
    try {
      host.source.importedSourcePaths(job);
    }
    catch (error: any) {
      return reply(409, { error: error.message });
    }
    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: `=== Starting Step 1 for: ${job.name} (Workflow: ${chapterSource !== 'whisperx' ? 'Existing Audio Files' : 'Speech Recognition'}) ===`,
    });
    // Initialize live Step 1 progress state
    state.startedAt = Date.now();
    const stages = (chapterSource === 'whisperx' ? speechRecognitionStages : [
      ...directChapterStages.slice(0, 3),
      ...(runTranscript ? speechRecognitionStages.filter(stage => stage.key === 'transcribing_whisper') : []),
      ...directChapterStages.slice(3),
    ]).filter(stage => !(mergeMethod === 'skip' && stage.key === 'merging_audio') &&
      !(stage.key === 'generating_waveform' && !runTranscript && !generateWaveform && job.parts.length === 1))
      .map(stage => stage.key === 'generating_waveform' && !generateWaveform ? { ...stage, label: 'Create review preview', desc: 'Prepare audio for playback or transcription without waveform data.' } : stage);
    state.progress = {
      jobId: job.id,
      isActive: true,
      stage: 'scanning_folder',
      label: chapterSource !== 'whisperx' ? 'Scanning & validating input audio files' : 'Scanning input audio files',
      currentTask: `Verifying ${job.parts.length} source audio files...`,
      currentStageNumber: 1,
      totalStages: stages.length,
      stages,
      failedStage: null,
      percentage: 0,
      isDeterminate: false,
      elapsedSeconds: 0,
      liveStatusMessage: `Discovered ${job.parts.length} input files. Checking format & integrity.`,
      logs: [
        `[${new Date().toLocaleTimeString()}] Step 1 initiated for: ${job.name}`,
        `[${new Date().toLocaleTimeString()}] Target output folder: ${job.outputFolderPath || host.locations.output}`,
        `[${new Date().toLocaleTimeString()}] Workflow: ${chapterSource !== 'whisperx' ? 'Direct Audio File Preservation' : 'Whisper Speech Recognition'}`,
        `[${new Date().toLocaleTimeString()}] Stage 1/${stages.length} started: Inspect source audio`,
      ],
      canCancel: true,
      isCancelling: false,
      error: null,
      summary: null,
    };
    // Respond immediately so the client can begin polling without NetworkError timeouts
    const response = reply(200, { status: 'started', message: 'Step 1 processing started in background' });
    const controller = new AbortController();
    state.abort = controller;
    state.running = true;
    const signal = controller.signal;
    // Run the heavy processing in the background
    (async () => {
      try {
        // Let the HTTP adapter send the start reply before synchronous probing.
        // The running lock is already held, including while cancellation settles.
        await yieldToEventLoop();
        signal.throwIfAborted();
        // ----------------------------------------------------
        job.parts.sort((a, b) => (a.order || 0) - (b.order || 0));
        let sourcePaths = host.source.importedSourcePaths(job);
        let media = sourcePaths.map(p => host.media.inspect(host.media.ffprobe(), p));
        const numberTag = (tags: Record<string, string>, keys: string[]) => {
          const value = Object.entries(tags).find(([key]) => keys.includes(key.toLowerCase()))?.[1];
          const number = Number(/^\s*(\d+)/.exec(String(value || ''))?.[1]);
          return number > 0 ? number : undefined;
        };
        const ordered = job.parts.map((part, index) => {
          part.discNumber = numberTag(media[index].tags, ['disc', 'discnumber', 'disk', 'disknumber', 'tpos']) ?? part.discNumber;
          part.trackNumber = numberTag(media[index].tags, ['track', 'tracknumber', 'trck']) ?? part.trackNumber;
          return { part, file: sourcePaths[index], info: media[index] };
        }).sort((a, b) => (a.part.order || 0) - (b.part.order || 0));
        job.parts = ordered.map(item => item.part);
        sourcePaths = ordered.map(item => item.file);
        media = ordered.map(item => item.info);
        job.parts.forEach((part, index) => { part.order = index + 1; });
        job.sourceOrderWarning = job.parts.length > 1 && job.parts.some(part => !hasExplicitSourceOrder({ relativePath: part.sourceRelativePath || part.name, discNumber: part.discNumber, trackNumber: part.trackNumber }))
          ? 'Some files have no clear disc or track number. Check the processing order before running.' : undefined;
        if (job.sourceOrderWarning)
          logStep1(job.sourceOrderWarning);
        job.discoveredFiles = job.parts.map((part, i) => ({
          relativePath: part.sourceRelativePath || part.name,
          storedName: part.name, fileName: path.basename(part.sourceRelativePath || part.name), folderName: path.dirname(part.sourceRelativePath || part.name),
          format: media[i].format, codec: media[i].codec, sampleRate: media[i].sampleRate, channels: media[i].channels,
          bitrate: media[i].bitrate, durationSeconds: media[i].durationSeconds, sizeBytes: fs.statSync(sourcePaths[i]).size,
          isProbed: true, streamSignature: media[i].streamSignature,
        }));
        const { sourceKey, preparedAudioKey } = await sourceProcessingKeys(sourcePaths, mergeMethod, files => host.source.sourceFingerprint(job, files));
        signal.throwIfAborted();
        const existing = await host.source.chaptersForJob(job, sourcePaths.map((file, index) => ({ file, ...media[index] })), sourceKey);
        if (chapterSource === 'existing_chapters' && !existing.chapters.length)
          throw new Error('No confidently matched existing chapters were found. Choose manual editing or another chapter source.');
        if (existing.sidecar)
          host.source.associateProjectFile(job, existing.sidecar, 'chapters');
        const plan = !runTranscript ? undefined : await transcriptionPlan({ ...job, selectedModelId, transcriptionSettings: selectedTranscriptionSettings }, preparedAudioKey, requestedEngine);
        const cachedTranscript = plan && reusableTranscription(job, plan.requestKey);
        const musicEnabled = host.config.detect_musical_transitions === true;
        const detectionKey = chapterDetectionCacheKey(job, musicEnabled);
        if (chapterSource === 'whisperx' && cachedTranscript && (!generateWaveform || job.waveformReady) && previousChapterSource === chapterSource && job.chapterDetectionKey === detectionKey && !job.staleSteps?.includes('chapter_detection') && job.previewPath && fs.existsSync(job.previewPath) && job.mergedMp3?.fullPath && fs.existsSync(job.mergedMp3.fullPath)) {
          logStep1(`Transcript cache: Hit; ${job.transcription!.engine}, ${job.transcription!.profile}, ${job.transcription!.device}, ${job.transcription!.computeType}, batch ${job.transcription!.batchSize ?? 'Off'}, beam ${job.transcription!.beamSize ?? 'native'}. Reusing reviewed chapters.`);
          host.store.save();
          state.progress.isActive = false;
          state.progress.canCancel = false;
          state.progress.stage = 'completed';
          state.progress.percentage = 100;
          return;
        }
        const sameSource = job.sourceKey === sourceKey;
        const savedBookMetadata = job.metadataUpdatedAt ? job.metadata : undefined;
        const existingMaster = job.mergedMp3?.fullPath;
        const reusePreparedAudio = sameSource && Boolean(existingMaster && fs.existsSync(existingMaster)) && (job.preparedAudioKey === preparedAudioKey || (!job.preparedAudioKey && previousMergeMethod === mergeMethod));
        job.status = 'draft';
        job.outputM4b = null;
        job.validation = null;
        job.exports = [];
        if (!reusePreparedAudio) {
          job.mergedMp3 = null;
          job.previewPath = undefined;
          job.preparedAudioKey = undefined;
        }
        if (chapterSource !== 'manual' || (job.sourceFilesChanged && !sameSource)) {
          job.chapters = [];
          job.chapterReviewBaseline = undefined;
        }
        job.candidates = [];
        if (!sameSource) {
          job.transcriptWords = [];
          job.transcriptSegments = [];
          job.transcription = null;
          job.transcriptKey = undefined;
        }
        if (!sameSource) {
          job.existingChapters = [];
          job.sourceTags = {};
          job.importedMetadata = undefined;
        }
        const intermediatesDir = host.source.projectIntermediatesDir(job);
        if (sourcePaths.some(p => { const relative = path.relative(intermediatesDir, p); return !relative.startsWith('..') && !path.isAbsolute(relative); }))
          throw new Error('Move source files outside this project’s intermediate directory before processing.');
        fs.mkdirSync(intermediatesDir, { recursive: true });
        if (mergeMethod !== 'skip')
          setStep1Stage('merging_audio', reusePreparedAudio
            ? 'Using the previously prepared master audio.'
            : 'Preparing a single review master from the source audio.', reusePreparedAudio ? 'Reuse prepared master audio' : 'Prepare master audio');
        const prepared = mergeMethod === 'skip'
          ? {
            master: sourcePaths.length === 1 ? sourcePaths[0] : path.join(intermediatesDir, 'master.wav'),
            media, durations: media.map(info => info.durationSeconds), normalized: false
          }
          : reusePreparedAudio
            ? {
              master: existingMaster!,
              media,
              durations: job.parts.map((part, index) => previousPreparedDurations[index] || part.durationSeconds || media[index].durationSeconds),
              normalized: mergeMethod === 'standard',
            }
            : await host.media.prepare(host.media.ffmpeg(), host.media.ffprobe(), sourcePaths, intermediatesDir, mergeMethod, logStep1, signal);
        if (reusePreparedAudio)
          logStep1('Reusing prepared master audio; skipping PCM conversion and stitching.');
        const master = prepared.master;
        job.sourceBitrate = Math.max(...media.map(m => m.bitrate));
        const masterInfo = mergeMethod === 'skip' && sourcePaths.length > 1
          ? { ...media[0], durationSeconds: prepared.durations.reduce((sum, duration) => sum + duration, 0) }
          : host.media.inspect(host.media.ffprobe(), master);
        job.sourceCodec = masterInfo.codec;
        job.sourceFormat = media.every(m => m.format === media[0].format) ? media[0].format : 'wav';
        job.totalDurationSeconds = masterInfo.durationSeconds;
        job.totalSizeBytes = sourcePaths.reduce((sum, p) => sum + fs.statSync(p).size, 0);
        job.parts.forEach((part, i) => { part.durationSeconds = prepared.durations[i]; part.bitrate = media[i].bitrate; });
        job.mergedMp3 = { filename: path.basename(master), fullPath: master, duration: masterInfo.durationSeconds, bitrate: masterInfo.bitrate, sizeBytes: fs.existsSync(master) ? fs.statSync(master).size : job.totalSizeBytes };
        job.sourceKey = sourceKey;
        job.preparedAudioKey = preparedAudioKey;
        host.store.save();
        if (!sameSource && sourcePaths.length === 1 && job.inputMethod !== 'librivox') {
          job.existingChapters = media[0].chapters;
          const tags = Object.fromEntries(Object.entries(media[0].tags).map(([k, v]) => [k.toLowerCase(), String(v)]));
          job.sourceTags = media[0].tags;
          const importedMetadata: AudiobookMetadata = { title: tags.album || tags.title || job.name, author: tags.artist || tags.album_artist || '', narrator: tags.composer || '', genres: (tags.genre || '').split(/[;,]/).map(value => value.trim()).filter(Boolean), language: tags.language || 'eng', abridged: tags.abridged === '1', explicit: tags.explicit === '1', subtitle: tags.subtitle || tags.tit3, series: tags.series, seriesSequence: tags['series-part'], publishedYear: tags.date, releaseDate: tags.releasetime, publisher: tags.publisher, description: tags.description || tags.desc || tags.comment, copyright: tags.copyright, isbn: tags.isbn, asin: tags.asin };
          job.importedMetadata = JSON.parse(JSON.stringify(importedMetadata));
          job.metadata = {
            ...importedMetadata,
            ...savedBookMetadata,
            title: savedBookMetadata?.title?.trim() || job.metadata?.title?.trim() || job.name,
            author: savedBookMetadata?.author?.trim() || job.metadata?.author?.trim() || job.author || importedMetadata.author,
            narrator: savedBookMetadata?.narrator?.trim() || job.metadata?.narrator?.trim() || job.narrator || importedMetadata.narrator,
          };
          if (media[0].artwork && job.metadata.cover === undefined) {
            const coverPath = path.join(intermediatesDir, media[0].artwork.codec_name === 'png' ? 'original-cover.png' : 'original-cover.jpg');
            await execFileAsync(host.media.ffmpeg(), ['-v', 'error', '-y', '-i', master, '-map', '0:' + media[0].artwork.index, '-c', 'copy', coverPath]);
            job.metadata.cover = { source: 'local', filename: path.basename(coverPath), url: 'data:image/' + (coverPath.endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + fs.readFileSync(coverPath).toString('base64') };
          }
        }
        const reusablePreview = reusePreparedAudio && job.previewPath && fs.existsSync(job.previewPath);
        const needsPreview = generateWaveform || runTranscript || sourcePaths.length > 1;
        if (needsPreview) {
          setStep1Stage('generating_waveform', reusablePreview
            ? `Reusing the review preview${generateWaveform ? ' and preparing waveform data' : ''}.`
            : `Creating a review preview${generateWaveform ? ' with waveform data' : ' without waveform data'}.`, generateWaveform ? 'Generate waveform and review preview' : 'Prepare review preview');
          if (reusablePreview) {
            logStep1('Reusing existing review preview.');
          }
          else {
            job.previewPath = path.join(intermediatesDir, 'analysis.wav');
            if (mergeMethod === 'skip')
              await host.media.reviewPreview(host.media.ffmpeg(), sourcePaths, job.previewPath, signal, logStep1, generateWaveform);
            else
              await host.media.preview(host.media.ffmpeg(), master, job.previewPath, signal, logStep1, generateWaveform, generateWaveform);
            logStep1(`Review preview created${generateWaveform ? ' with waveform data' : '; waveform generation skipped'}.`);
          }
          signal.throwIfAborted();
          if (generateWaveform) {
            await host.media.ensureAnalysis(job.previewPath!, true);
            job.waveformReady = true;
            job.pipelineSteps = completeStepRerun(job.pipelineSteps, 'generating_waveform', now());
          }
          else {
            job.waveformReady = false;
            if (job.pipelineSteps)
              delete job.pipelineSteps.generating_waveform;
          }
        }
        job.existingChapters = existing.chapters;
        job.existingChapterSource = existing.source;
        host.store.save();
        // WORKFLOW A: Use existing MP3 files as individual chapters
        // ----------------------------------------------------
        if (chapterSource !== 'whisperx') {
          if (runTranscript) {
            setStep1Stage('transcribing_whisper', 'Generating a transcript without changing chapter markers.', 'Generate transcript only');
            if (!cachedTranscript) {
              const replacement = await transcribeExistingPreview(job, signal, plan);
              signal.throwIfAborted();
              job.transcriptWords = replacement.words;
              job.transcriptSegments = replacement.segments;
              job.transcription = replacement.transcription;
              job.transcriptKey = replacement.transcriptKey;
            }
            job.pipelineSteps = completeStepRerun(job.pipelineSteps, 'transcribing_whisper', now());
          }
          setStep1Stage('extracting_chapters', 'Creating chapter markers from source-file order and embedded chapters.', 'Create chapters from source files');
          logStep1(`Using durations and embedded chapter tags from ${job.parts.length} inspected files.`);
          job.logs.push({
            timestamp: now(),
            level: 'INFO',
            message: `Chapter source: ${chapterSource}. Audio preparation: ${mergeMethod}. Transcript: ${runTranscript ? 'generated separately' : 'skipped'}. All chapter entries remain editable.`,
          });
          const relativeNames = job.parts.map(part => part.sourceRelativePath || (path.isAbsolute(part.name) ? path.relative(job.sourceFolderPath || path.dirname(part.name), part.name) : part.name));
          const structure = job.chapterSource === 'grouped_files' ? manualChapterGroups(job.parts) : sourceChapterGroups(relativeNames);
          job.chapterStructure = structure.mode;
          const starts: number[] = [];
          let cumulativeSec = 0;
          for (const duration of prepared.durations) {
            starts.push(cumulativeSec);
            cumulativeSec += duration;
          }
          const directChapters: ChapterEntry[] = structure.groups.map((group, index) => ({
            id: 'chap-' + (index + 1), start: formatTimestamp(starts[group.indices[0]]), title: group.title,
            notes: group.indices.map(i => relativeNames[i]).join(' → '),
          }));
          job.chapters = chapterSource === 'manual' ? job.chapters : chapterSource === 'existing_chapters' ? [...job.existingChapters!] : directChapters;
          job.chapterDetectionKey = undefined;
          job.candidates = []; // No AI candidates needed
          job.pipelineSteps = completeStepRerun(job.pipelineSteps, 'extracting_chapters', now());
          job.status = 'transcribed';
          job.staleSteps = [];
          job.sourceFilesChanged = false;
          if (chapterSource === 'existing_files' && sourcePaths.length === 1 && job.existingChapters?.length)
            job.chapters = [...job.existingChapters];
          if (chapterSource !== 'manual')
            job.chapterReviewBaseline = host.store.snapshot(job.chapters);
          job.ffmetaContent = generateFFMetaContent(job.chapters, job.totalDurationSeconds, job.metadata);
          setStep1Stage('saving_project', 'Saving chapter markers for review.', 'Finalize direct chapter workflow');
          logStep1(`Chapter list ready for editing (${job.chapters.length} total).`);
          state.progress.summary = {
            totalFilesProcessed: job.parts.length,
            totalDurationSeconds: cumulativeSec,
            chaptersFound: job.chapters.length,
            wordsTranscribed: runTranscript ? job.transcription?.wordsCount || 0 : 0,
            modelUsed: runTranscript ? plan!.model.name : 'No transcription',
          };
          job.logs.push({
            timestamp: now(),
            level: 'INFO',
            message: `Step 1 Complete: ${job.chapters.length} editable chapters (${chapterSource}). Total duration: ${formatTimestamp(cumulativeSec)}. Ready for review.`,
          });
          host.store.save();
          state.progress.stage = 'completed';
          state.progress.currentStageNumber = state.progress.totalStages;
          state.progress.percentage = 0;
          state.progress.label = 'Ready for chapter review';
          state.progress.currentTask = 'Chapter markers saved successfully';
          state.progress.isActive = false;
          state.progress.canCancel = false;
          state.progress.liveStatusMessage = `${job.chapters.length} chapters ready for editing. You can add, remove, rename, and adjust chapter markers.`;
          logStep1(`Stage ${state.progress.totalStages}/${state.progress.totalStages} completed: Direct chapter markers saved.`);
          logStep1(`Step 1 completed in ${Math.round((Date.now() - state.startedAt) / 1000)}s.`);
          return;
        }
        // ----------------------------------------------------
        // WORKFLOW B: Generate chapters with WhisperX
        // ----------------------------------------------------
        const model = plan!.model;
        setStep1Stage('transcribing_whisper', `Using ${plan!.engine} with ${model.name}...`, 'Speech recognition');
        let generatedCandidates: ChapterCandidate[] = [];
        try {
          if (!cachedTranscript) {
            const replacement = await transcribeExistingPreview(job, signal, plan);
            signal.throwIfAborted();
            job.transcriptWords = replacement.words;
            job.transcriptSegments = replacement.segments;
            job.transcription = replacement.transcription;
            job.transcriptKey = replacement.transcriptKey;
          }
          else
            logStep1('Transcript cache: Hit; reusing aligned words for chapter detection.');
          const transcriptSegments = job.transcriptSegments!;
          const transcriptWords = job.transcriptWords!;
          const transcriptWordCount = job.transcription!.wordsCount;
          job.pipelineSteps = completeStepRerun(job.pipelineSteps, 'transcribing_whisper', now());
          logStep1(`Speech recognition completed: ${transcriptSegments.length} segments and ${transcriptWordCount} words aligned.`);
          setStep1Stage('detecting_chapters', 'Finding chapter headings and refining their timestamps.', 'Detect chapter candidates');
          generatedCandidates = buildChapterCandidates(transcriptSegments, transcriptWords, job.transcription!.engine!);
          if (musicEnabled) {
            generatedCandidates = await improvedChapterCandidates(job, transcriptWords, generatedCandidates, signal);
          }
          job.chapterDetectionKey = chapterDetectionCacheKey(job, musicEnabled);
          logChapterDetectionResult(generatedCandidates, musicEnabled);
          job.pipelineSteps = completeStepRerun(job.pipelineSteps, 'detecting_chapters', now());
        }
        catch (err: any) {
          if (signal.aborted)
            throw err;
          console.error('Step 1 processing stage failed:', err);
          const failedStage = state.progress.stage;
          const failedLabel = state.progress.stages.find(item => item.key === failedStage)?.label || 'Processing';
          job.logs.push({ timestamp: now(), level: 'ERROR', message: `${failedLabel} failed. ${err.message}` });
          host.store.save();
          failStep1Stage(err);
          return;
        }
        job.candidates = generatedCandidates;
        // Every detected candidate is included for human review, regardless of confidence.
        job.chapters = initialDetectedChapters(generatedCandidates);
        if (!job.chapters.length || job.chapters[0].start !== '00:00:00.000')
          job.chapters.unshift({ id: 'opening', start: '00:00:00.000', title: 'Prologue' });
        job.chapterReviewBaseline = host.store.snapshot(job.chapters);
        setStep1Stage('saving_project', 'Saving transcript and candidate chapter markers for review.', 'Finalize chapter review data');
        job.status = 'transcribed';
        job.staleSteps = [];
        job.sourceFilesChanged = false;
        job.logs.push({
          timestamp: now(),
          level: 'INFO',
          message: `Step 1 Complete. Extracted ${generatedCandidates.length} candidate chapter markers. Ready for Step 2 human review.`,
        });
        host.store.save();
        state.progress.stage = 'completed';
        state.progress.currentStageNumber = state.progress.totalStages;
        state.progress.percentage = 0;
        state.progress.label = 'Ready for chapter review';
        state.progress.currentTask = 'Transcript and candidate chapters saved successfully';
        state.progress.isActive = false;
        state.progress.canCancel = false;
        state.progress.liveStatusMessage = `Step 1 complete. Extracted ${generatedCandidates.length} candidate markers. Ready for Step 2 review.`;
        state.progress.summary = {
          totalFilesProcessed: job.parts.length,
          totalDurationSeconds: job.totalDurationSeconds,
          chaptersFound: generatedCandidates.length,
          wordsTranscribed: job.transcription.wordsCount,
          modelUsed: model.name,
        };
        logStep1(`Stage ${state.progress.totalStages}/${state.progress.totalStages} completed: Chapter review data saved.`);
        logStep1(`Step 1 completed in ${Math.round((Date.now() - state.startedAt) / 1000)}s.`);
      }
      catch (err: any) {
        if (signal.aborted) {
          state.progress.isActive = false;
          state.progress.isCancelling = false;
          state.progress.canCancel = false;
          state.progress.stage = 'cancelled';
          state.progress.label = 'Processing cancelled';
          state.progress.currentTask = 'Ready to restart with updated settings';
          state.progress.currentStageNumber = 0;
          state.progress.percentage = 0;
          state.progress.liveStatusMessage = 'Processing cancelled. Completed audio preparation is preserved for the next run.';
          return;
        }
        console.error('Fatal Step 1 background error:', err);
        const failedStage = state.progress.stage;
        const failedLabel = state.progress.stages.find(item => item.key === failedStage)?.label || 'Processing';
        job.logs.push({ timestamp: now(), level: 'ERROR', message: `${failedLabel} failed. ${err.message}` });
        host.store.save();
        failStep1Stage(err);
      }
      finally {
        state.running = false;
        state.abort = undefined;
      }
    })();
    return response;
  }
  async function progress(input: ProcessingCommandInput) {
    return reply(200, state.progress);
  }
  async function cancel(input: ProcessingCommandInput) {
    if (!state.running) {
      return reply(400, { error: 'No active Step 1 processing job.' });
    }
    state.abort?.abort();
    state.progress.isActive = false;
    state.progress.stage = 'cancelled';
    state.progress.label = 'Processing cancelled';
    state.progress.currentTask = 'Ready to restart with updated settings';
    state.progress.currentStageNumber = 0;
    state.progress.percentage = 0;
    state.progress.isCancelling = false;
    state.progress.canCancel = false;
    state.progress.error = null;
    state.progress.summary = null;
    state.progress.liveStatusMessage = 'Processing cancelled. Completed audio preparation is preserved for the next run.';
    logStep1(`User cancelled processing. Completed audio preparation was preserved.`);
    return reply(200, { status: 'ok', message: 'Processing cancelled.', progress: state.progress });
  }
  async function rerun(input: ProcessingCommandInput) {
    const job = host.store.get(input.params.id);
    const step = input.params.step as RerunnablePipelineStep;
    if (!job)
      return reply(404, { error: 'Job not found' });
    if (!rerunnableSteps.has(step))
      return reply(400, { error: 'This processing step cannot be run independently.' });
    if (host.work.installing)
      return reply(409, { error: 'Wait for runtime installation to finish.' });
    if (state.running)
      return reply(409, { error: 'Another processing step is already running.' });
    if (!canRerunStep(job, step))
      return reply(400, { error: 'Required input for this step is unavailable.' });
    if ((step === 'detecting_chapters' || step === 'extracting_chapters') && hasManualChapterWork(job) && input.body?.confirmReplaceManualChapters !== true) {
      return reply(409, {
        error: 'Running this step will replace chapter names, Start and End timestamps, inserted chapters, and missing placeholders. Confirm to continue.',
        requiresConfirmation: true,
      });
    }
    const definition = [...speechRecognitionStages, ...directChapterStages].find(item => item.key === step)
      || { key: step as Step1ProcessStage, label: 'Process metadata', desc: 'Regenerate chapter metadata from the current reviewed data.' };
    const inferredOutput = step === 'generating_waveform' ? !!job.waveformReady
      : step === 'transcribing_whisper' ? !!job.transcription
        : step === 'detecting_chapters' ? job.candidates.length > 0
          : step === 'extracting_chapters' ? job.chapters.length > 0
            : ['metadata_ready', 'built', 'validated'].includes(job.status);
    const previousStepState = job.pipelineSteps?.[step] || (inferredOutput ? { status: 'current' as const, hasOutput: true } : undefined);
    const isRerun = previousStepState?.hasOutput === true;
    const action = isRerun ? 'Rerun' : 'Run';
    job.pipelineSteps = { ...job.pipelineSteps, [step]: beginStepRerun(previousStepState) };
    if (step === 'transcribing_whisper' && job.candidates.length && !job.pipelineSteps.detecting_chapters) {
      job.pipelineSteps.detecting_chapters = { status: 'current', hasOutput: true };
    }
    host.store.save();
    state.jobId = job.id;
    state.startedAt = Date.now();
    state.progress = {
      jobId: job.id, rerunStep: step,
      isActive: true, stage: definition.key, label: `${isRerun ? 'Rerunning' : 'Running'} ${definition.label}`,
      currentTask: definition.desc, currentStageNumber: 1, totalStages: 1, stages: [definition], failedStage: null,
      percentage: 0, isDeterminate: false, elapsedSeconds: 0,
      liveStatusMessage: `${isRerun ? 'Rerunning' : 'Running'} ${definition.label}.${isRerun ? ' Previous successful output is preserved until completion.' : ''}`,
      logs: [`[${new Date().toLocaleTimeString()}] ${action} started: ${definition.label}`],
      canCancel: true, isCancelling: false, error: null, summary: null,
    };
    const controller = new AbortController();
    state.abort = controller;
    state.running = true;
    const response = reply(200, { status: 'started', step });
    void (async () => {
      try {
        await yieldToEventLoop();
        controller.signal.throwIfAborted();
        if ((step === 'transcribing_whisper' || step === 'generating_waveform') && (!job.previewPath || !fs.existsSync(job.previewPath))) {
          const sources = host.source.importedSourcePaths(job);
          if (job.sourceKey !== await host.source.sourceFingerprint(job, sources))
            throw new Error('Source audio changed. Run source processing again before generating a preview.');
          const preview = path.join(host.source.projectIntermediatesDir(job), 'analysis.wav');
          await host.media.reviewPreview(host.media.ffmpeg(), sources, preview, controller.signal, logStep1, step === 'generating_waveform');
          controller.signal.throwIfAborted();
          job.previewPath = preview;
        }
        if (step === 'generating_waveform') {
          await host.media.rebuildAnalysis(job.previewPath!);
          job.generateWaveform = true;
          job.waveformReady = true;
        }
        else if (step === 'transcribing_whisper') {
          const replacement = await transcribeExistingPreview(job, controller.signal);
          controller.signal.throwIfAborted();
          job.transcriptSegments = replacement.segments;
          job.transcriptWords = replacement.words;
          job.transcription = replacement.transcription;
          job.transcriptKey = replacement.transcriptKey;
        }
        else if (step === 'detecting_chapters') {
          const words = job.transcriptWords?.length ? job.transcriptWords : buildTranscriptWords(job.transcriptSegments!);
          const musicEnabled = host.config.detect_musical_transitions === true;
          let candidates = buildChapterCandidates(job.transcriptSegments!, words, job.transcription?.engine || 'openai-whisper');
          if (musicEnabled) {
            candidates = await improvedChapterCandidates(job, words, candidates, controller.signal);
          }
          const chapters = initialDetectedChapters(candidates);
          if (!chapters.length || chapters[0].start !== '00:00:00.000')
            chapters.unshift({ id: 'opening', start: '00:00:00.000', title: 'Prologue' });
          const replacementChapters = applyDefaultChapterEnds(chapters, job.totalDurationSeconds);
          const replacementMetadata = generateFFMetaContent(replacementChapters, job.totalDurationSeconds, job.metadata);
          controller.signal.throwIfAborted();
          job.chapterDetectionKey = chapterDetectionCacheKey(job, musicEnabled);
          logChapterDetectionResult(candidates, musicEnabled);
          job.candidates = candidates;
          job.chapters = replacementChapters;
          job.chapterReviewBaseline = host.store.snapshot(replacementChapters);
          job.ffmetaContent = replacementMetadata;
        }
        else if (step === 'extracting_chapters') {
          const relativeNames = job.parts.map(part => part.sourceRelativePath || part.name);
          const structure = job.chapterSource === 'grouped_files' ? manualChapterGroups(job.parts) : sourceChapterGroups(relativeNames);
          const starts: number[] = [];
          let cumulative = 0;
          for (const part of job.parts) {
            starts.push(cumulative);
            cumulative += part.durationSeconds;
          }
          const chapters = structure.groups.map((group, index) => ({
            id: `chap-${index + 1}`, start: formatTimestamp(starts[group.indices[0]]), title: group.title,
            notes: group.indices.map(i => relativeNames[i]).join(' → '),
          }));
          const existing = job.chapterSource === 'existing_chapters'
            ? await host.source.chaptersForJob(job, host.source.importedSourcePaths(job).map(file => ({ file, ...host.media.inspect(host.media.ffprobe(), file) }))) : undefined;
          if (existing && !existing.chapters.length)
            throw new Error('No confidently matched existing chapters were found.');
          const replacementChapters = applyDefaultChapterEnds(existing?.chapters || chapters, job.totalDurationSeconds);
          const replacementMetadata = generateFFMetaContent(replacementChapters, job.totalDurationSeconds, job.metadata);
          controller.signal.throwIfAborted();
          job.chapterStructure = structure.mode;
          job.chapterDetectionKey = undefined;
          job.candidates = [];
          job.chapters = replacementChapters;
          job.chapterReviewBaseline = host.store.snapshot(replacementChapters);
          job.ffmetaContent = replacementMetadata;
        }
        else if (step === 'metadata_processing') {
          const replacement = generateFFMetaContent(job.chapters, job.totalDurationSeconds, job.metadata);
          controller.signal.throwIfAborted();
          job.ffmetaContent = replacement;
        }
        const completedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const independentTranscript = step === 'transcribing_whisper' && job.chapterSource !== 'whisperx';
        const priorDetection = job.pipelineSteps?.detecting_chapters;
        job.pipelineSteps = completeStepRerun(job.pipelineSteps, step, completedAt);
        if (independentTranscript)
          job.pipelineSteps = { ...job.pipelineSteps, detecting_chapters: priorDetection };
        if (step === 'detecting_chapters')
          job.staleSteps = (job.staleSteps || []).filter(item => item !== 'chapter_detection');
        if (!independentTranscript)
          job.staleSteps = markDependentResultsStale(job.staleSteps, step);
        if ((step === 'detecting_chapters' || step === 'extracting_chapters') && job.status === 'draft' && canReviewChapters(job))
          job.status = 'transcribed';
        job.logs.push({ timestamp: completedAt, level: 'INFO', message: `${action} completed: ${definition.label}.` });
        host.store.save();
        state.progress = {
          ...state.progress, isActive: false, stage: 'completed', label: `${definition.label} ${isRerun ? 'rerun' : 'run'} complete`,
          currentTask: `${isRerun ? 'Replacement output' : 'Output'} saved successfully.`, percentage: 100, isDeterminate: true,
          canCancel: false, liveStatusMessage: `${definition.label} is current.`,
          summary: { rerunStep: step },
        };
        logStep1(`${action} completed successfully: ${definition.label}.`);
      }
      catch (error: any) {
        const message = controller.signal.aborted ? `${action} cancelled.${isRerun ? ' Previous successful output was preserved.' : ''}` : error.message || String(error);
        job.pipelineSteps = { ...job.pipelineSteps, [step]: failStepRerun(previousStepState, message) };
        job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'ERROR', message: `${action} failed: ${definition.label}. ${message}` });
        host.store.save();
        state.progress.failedStage = definition.key;
        state.progress.stage = controller.signal.aborted ? 'cancelled' : 'error';
        state.progress.isActive = false;
        state.progress.canCancel = false;
        state.progress.error = message;
        state.progress.liveStatusMessage = message;
        logStep1(`${action} failed: ${message}`);
      }
      finally {
        state.running = false;
        state.abort = undefined;
      }
    })();
    return response;
  }
  return { commands: { processSource, progress, cancel, rerun }, helpers: { validatedTranscriptionSettingsMap, buildChapterCandidates, chapterDetectionCacheKey } };
}
