import fs from 'node:fs';
import path from 'node:path';
import { CHAPTER_DETECTOR_VERSION, detectChapterHeadings } from './chapter-detection';
import { formatTimestamp } from './ffmetadata';
import type { AlignedWord, AudiobookJob, ChapterCandidate } from './legacy-domain';
import type { AudiobookProcessingPorts } from './processing-ports';
import { processingKey } from './transcription-cache';
import type { NormalizedTranscription, TranscriptionEngineId } from './transcription-contracts';
import { transcriptionSettings } from './transcription-policy';
import { buildTranscriptWords, findTranscriptWordIndex } from './word-alignment';
export function buildChapterCandidates(transcriptSegments: NormalizedTranscription['segments'], transcriptWords: ReturnType<typeof buildTranscriptWords>, engine: TranscriptionEngineId): ChapterCandidate[] {
  const headings = detectChapterHeadings(transcriptSegments);
  return headings.map((heading, headingIndex) => {
    const rawTime = heading.start;
    const endTime = heading.end;
    const indexedWord = heading.transcriptWordIndex === undefined ? undefined : transcriptWords[heading.transcriptWordIndex];
    const headingWordIndex = indexedWord && Math.abs(indexedWord.startSeconds - rawTime) < 0.0005
      ? heading.transcriptWordIndex!
      : findTranscriptWordIndex(transcriptWords, rawTime - 0.0005);
    const hasHeadingWord = heading.transcriptWordIndex !== undefined && headingWordIndex < transcriptWords.length
      && Math.abs(transcriptWords[headingWordIndex].startSeconds - rawTime) < 0.0005;
    const contextStart = Math.max(0, headingWordIndex - 18);
    const contextEnd = Math.min(transcriptWords.length, headingWordIndex + 26);
    const contextWords = hasHeadingWord ? transcriptWords.slice(contextStart, contextEnd) : [];
    const headingEndIndex = findTranscriptWordIndex(transcriptWords, endTime + 0.000001);
    const headingWords = hasHeadingWord ? transcriptWords.slice(headingWordIndex, headingEndIndex) : [];
    // The word clicked in review and the detected heading share one timestamp.
    // A legacy wordless segment must not snap forward to unrelated narration.
    const refinedStartIndex = headingWordIndex;
    const refinedStart = hasHeadingWord ? transcriptWords[headingWordIndex].startSeconds : rawTime;
    return {
      candidate_id: headingIndex + 1,
      candidate_start: formatTimestamp(refinedStart),
      candidate_end: formatTimestamp(endTime),
      matched_text: heading.text,
      context_before: contextWords.filter(word => word.startSeconds < rawTime).map(word => word.word).join(' '),
      context_after: contextWords.filter(word => word.startSeconds > endTime).map(word => word.word).join(' '),
      confidence: headingWords.length ? String(headingWords.reduce((sum, word) => sum + (word.confidence ?? 0), 0) / headingWords.length) : '0',
      proposed_title: heading.text,
      headingType: heading.headingType,
      chapterNumber: heading.chapterNumber,
      recovered: heading.recovered,
      transcriptWordIndex: hasHeadingWord ? refinedStartIndex : undefined,
      status: headingIndex === 0 ? 'approved' : 'review',
      notes: `${engine === 'faster-whisper' ? 'Faster Whisper' : 'OpenAI Whisper'} heading at ${formatTimestamp(refinedStart)}${hasHeadingWord ? '; anchored to saved transcript word' : '; legacy segment timing'}`,
      words: contextWords,
    };
  });
}

export function createProcessingDetection(host: AudiobookProcessingPorts, logStep1: (message: string) => void) {
  function chapterDetectionCacheKey(job: AudiobookJob, musicEnabled: boolean): string {
    let previewSignature: string | undefined;
    if (musicEnabled && job.previewPath && fs.existsSync(job.previewPath)) {
      const stat = fs.statSync(job.previewPath);
      previewSignature = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    }
    // Version the decisions, not just the transcription request. Retranscribing
    // with identical settings can still produce a different word timeline.
    return processingKey('chapter-detection', job.transcriptKey || '', {
      spokenVersion: CHAPTER_DETECTOR_VERSION,
      segments: job.transcriptSegments,
      words: job.transcriptWords,
      ...(musicEnabled ? {
        improvedVersion: host.detection.versions.improved, musicVersion: host.detection.versions.music, titleVersion: host.detection.versions.title, previewSignature,
        existingChapters: job.existingChapters, parts: job.parts, transcription: job.transcription, settings: job.transcriptionSettings
      } : {}),
    });
  }
  function logChapterDetectionResult(candidates: ChapterCandidate[], musicEnabled: boolean) {
    const musical = candidates.filter(candidate => candidate.headingType === 'music_transition').length;
    logStep1(`Chapter detection: ${candidates.filter(candidate => !candidate.suggestionOnly).length} chapter markers, ${candidates.filter(candidate => candidate.suggestionOnly).length} suggestions awaiting acceptance (${musical} unconfirmed acoustic cues); experimental detection ${musicEnabled ? 'enabled' : 'disabled'}.`);
    if (!candidates.length)
      logStep1(musicEnabled
        ? 'No supported chapter boundaries found. Review the transcript and audio; pauses alone do not establish chapters.'
        : 'No spoken chapter headings found. Improved Chapter Detection (Experimental) can suggest isolated titles, numbered sections and source boundaries for review.');
  }
  async function improvedChapterCandidates(job: AudiobookJob, words: AlignedWord[], spoken: ChapterCandidate[], signal: AbortSignal): Promise<ChapterCandidate[]> {
    const sources = host.detection.sourceBoundaries(job.existingChapters || [], job.parts, job.totalDurationSeconds);
    let suggestions = host.detection.structuralSuggestions(words, spoken, job.totalDurationSeconds, sources);
    logStep1(`Experimental structure detection: ${suggestions.length} isolated section/title suggestions.`);
    if (job.previewPath && fs.existsSync(job.previewPath)) {
      const titles = await host.detection.titles(job.previewPath, words, spoken, { signal, log: logStep1 });
      const acoustic = await host.detection.music(job.previewPath, words, titles, { signal, log: logStep1 });
      suggestions = host.detection.merge(suggestions, acoustic.filter(candidate => candidate.suggestionOnly));
      const windows = host.detection.recoveryWindows(words, spoken, suggestions, job.totalDurationSeconds, sources);
      if (windows.length) {
        const engine = job.transcription?.engine || host.runtime.engine(undefined);
        const model = job.transcription?.profile || job.selectedModelId || host.config.selected_model;
        const installed = await host.runtime.modelStatus(model, engine);
        if (!installed.isInstalled)
          logStep1('Heading recheck skipped: the original model is unavailable locally. No model was downloaded.');
        else {
          const settings = { ...transcriptionSettings(engine, job.transcriptionSettings?.[engine]), batching: 'off' as const };
          const capability = await host.runtime.capabilities(engine, true);
          try {
            const recovered = await host.detection.recheck({
              audio: job.previewPath, directory: host.source.projectIntermediatesDir(job), windows, original: words,
              settingsKey: processingKey('heading-recheck', engine, { model, settings, runtime: capability.runtimeVersion }), signal, log: logStep1,
              run: (audioPath, outputPath) => host.runtime.transcribe(capability, settings, model, attempt => host.runtime.engines[engine].transcribe({
                pythonPath: host.runtime.python(engine), audioPath, outputPath, engine, ...attempt, batchSize: null,
                modelId: engine === 'openai-whisper' && model === 'large-v3-turbo' ? 'turbo' : model,
                fasterModelRepository: host.runtime.repositories[model], localFilesOnly: true,
                localModelFile: engine === 'openai-whisper' ? installed.installedFile : undefined,
                fasterCacheDir: host.locations.whisper, openAiCacheDir: path.join(host.locations.openai, model),
                beamSize: settings.beamSize, language: job.transcription?.language || settings.language, signal,
                env: { ...host.runtime.env(engine), HF_HUB_OFFLINE: '1', HF_HOME: host.locations.whisper, TORCH_HOME: host.locations.torch, MPLCONFIGDIR: host.locations.matplotlib },
              }), logStep1, signal),
            });
            suggestions = host.detection.merge(suggestions, recovered);
          }
          catch (error) {
            signal.throwIfAborted();
            logStep1(`Heading recheck unavailable; keeping transcript-based results: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
    else
      logStep1('Acoustic checks and heading recheck skipped: prepared audio is unavailable.');
    signal.throwIfAborted();
    return host.detection.merge([], host.detection.reconcile(host.detection.merge(spoken, suggestions), sources));
  }
  return { chapterDetectionCacheKey, logChapterDetectionResult, improvedChapterCandidates };
}
