import fs from 'node:fs';
import path from 'node:path';
import type { AudiobookJob } from './legacy-domain';
import type { AudiobookProcessingPorts } from './processing-ports';
import { sourceProcessingKeys, transcriptionRequestKey, transcriptionResultKey } from './transcription-cache';
import { capabilityLabel, selectTranscriptionAttempt, transcriptionSettings } from './transcription-policy';
import { buildTranscriptWords, formatTimestamp as formatTranscriptTimestamp, missingWordTimestampSegments } from './word-alignment';

export function createProcessingSpeech(host: AudiobookProcessingPorts, logStep1: (message: string) => void) {
  async function transcriptionPlan(job: AudiobookJob, preparedAudioKey: string, engine = host.runtime.engine(undefined)) {
    const model = host.runtime.models.find(item => item.id === (job.selectedModelId || 'small')) || host.runtime.models[1];
    const settings = transcriptionSettings(engine, job.transcriptionSettings?.[engine]);
    const capability = await host.runtime.capabilities(engine, true);
    const attempt = selectTranscriptionAttempt(capability, settings, model.id);
    const requestKey = transcriptionRequestKey(preparedAudioKey, model.id, settings, capability, attempt);
    logStep1(`${engine}: ${capabilityLabel(capability, settings.device)}; runtime ${capability.runtimeVersion || 'unknown'}; GPU initialization ${capability.initialization}.${capability.reason ? ' Reason: ' + capability.reason : ''}`);
    return { engine, model, settings, capability, requestKey };
  }
  async function transcribeExistingPreview(job: AudiobookJob, signal: AbortSignal, plan?: Awaited<ReturnType<typeof transcriptionPlan>>) {
    if (!job.previewPath || !fs.existsSync(job.previewPath))
      throw new Error('Generate the review preview before rerunning transcription.');
    if (!plan) {
      const sources = job.parts.map(part => path.resolve(host.locations.appRoot, job.sourceFolderPath || '', part.name));
      const keys = await sourceProcessingKeys(sources, job.mergeMethod || 'standard', files => host.source.sourceFingerprint(job, files));
      if (keys.sourceKey !== job.sourceKey || keys.preparedAudioKey !== job.preparedAudioKey)
        throw new Error('Source audio or preparation settings changed. Run full source processing before retranscribing.');
      plan = await transcriptionPlan(job, keys.preparedAudioKey);
    }
    const { engine, model, settings, capability, requestKey } = plan;
    const python = host.runtime.python(engine);
    if (!fs.existsSync(python))
      throw new Error('The selected transcription runtime is not ready. Open System Requirements.');
    for (const dir of [host.locations.torch, host.locations.matplotlib, host.locations.openai])
      fs.mkdirSync(dir, { recursive: true });
    const normalizedPath = path.join(path.dirname(job.previewPath), `${path.parse(job.previewPath).name}.rerun-${Date.now()}.transcript.json`);
    try {
      const env = { ...host.runtime.env(engine), HF_HOME: host.locations.whisper, TORCH_HOME: host.locations.torch, MPLCONFIGDIR: host.locations.matplotlib };
      logStep1(`Transcription runtime: ${host.runtime.isSystem(engine) ? 'system' : 'app-managed'} — ${python}`);
      logStep1('Transcript cache: Miss (or explicit transcription rerun).');
      const normalized = await host.runtime.transcribe(capability, settings, model.id, attempt => host.runtime.engines[engine].transcribe({
        pythonPath: python, audioPath: job.previewPath!, outputPath: normalizedPath,
        modelId: engine === 'openai-whisper' && model.id === 'large-v3-turbo' ? 'turbo' : model.id,
        fasterModelRepository: host.runtime.repositories[model.id], engine, ...attempt,
        beamSize: settings.beamSize, language: settings.language, signal, env,
        fasterCacheDir: host.locations.whisper, openAiCacheDir: path.join(host.locations.openai, model.id),
      }), logStep1, signal);
      if (normalized.device === 'cuda')
        capability.initialization = 'verified';
      const untimedSegments = missingWordTimestampSegments(normalized.segments);
      if (untimedSegments.length) {
        logStep1(`WARNING: ${untimedSegments.length} speech segments have no word timestamps. Their text and segment ranges are saved for manual review; available timed words remain usable.`);
        for (const segment of untimedSegments)
          logStep1(`Missing word timestamps [${formatTranscriptTimestamp(segment.start)} – ${formatTranscriptTimestamp(segment.end)}]: ${segment.text.trim()}`);
      }
      const words = buildTranscriptWords(normalized.segments);
      const transcription = {
        model: model.name, profile: model.id, language: normalized.language || settings.language, engine: normalized.engine,
        device: normalized.device, computeType: normalized.computeType, batchSize: normalized.batchSize, beamSize: normalized.beamSize,
        segmentsCount: normalized.segments.length, wordsCount: words.length, requestKey,
        completedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      };
      return { segments: normalized.segments, words, transcription, transcriptKey: transcriptionResultKey(requestKey, transcription) };
    }
    finally {
      if (fs.existsSync(normalizedPath))
        fs.unlinkSync(normalizedPath);
    }
  }
  return { transcriptionPlan, transcribeExistingPreview };
}
