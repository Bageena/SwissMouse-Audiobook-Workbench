import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { selectTranscriptionAttempt, transcriptionSettings, type BackendCapabilities, type TranscriptionSettings, type TranscriptionAttempt } from '../src/transcription';

const execFileAsync = promisify(execFile);

export type TranscriptionEngineId = 'faster-whisper' | 'openai-whisper';

export interface NormalizedWord {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export interface NormalizedSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: NormalizedWord[];
  averageLogProbability?: number;
  noSpeechProbability?: number;
}

export interface NormalizedTranscription {
  engine: TranscriptionEngineId;
  model: string;
  language?: string;
  languageProbability?: number;
  duration?: number;
  device: 'cpu' | 'cuda';
  computeType: string;
  segments: NormalizedSegment[];
  batchSize?: number | null;
  beamSize?: number;
}

export interface TranscriptionRequest {
  pythonPath: string;
  audioPath: string;
  outputPath: string;
  modelId: string;
  fasterModelRepository?: string;
  engine: TranscriptionEngineId;
  device: 'cpu' | 'cuda';
  computeType: string;
  fasterCacheDir: string;
  openAiCacheDir: string;
  language?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  batchSize?: number | null;
  beamSize?: number;
}

export interface TranscriptionEngine {
  readonly id: TranscriptionEngineId;
  transcribe(request: TranscriptionRequest): Promise<NormalizedTranscription>;
}

// Keep DLL directory handles alive for the lifetime of Python inference.
export const PYTHON_DLL_SETUP = String.raw`
import os
_dll_handles = []
if os.name == 'nt' and hasattr(os, 'add_dll_directory'):
    for directory in os.environ.get('PATH', '').split(os.pathsep):
        if os.path.isdir(directory):
            try:
                _dll_handles.append(os.add_dll_directory(directory))
            except OSError:
                pass
`;

const PYTHON_RUNNER = String.raw`
import json, sys

cfg = json.loads(sys.argv[1])
out = cfg['output']

def clean_word(w):
    return {
        'word': str(w.get('word', '')).strip(),
        'start': float(w.get('start', 0)),
        'end': float(w.get('end', w.get('start', 0))),
        **({'probability': float(w['probability'])} if w.get('probability') is not None else {}),
    }

if cfg['engine'] == 'faster-whisper':
    from faster_whisper import WhisperModel
    model = WhisperModel(cfg.get('repository') or cfg['model'], device=cfg['device'],
                         compute_type=cfg['compute_type'], download_root=cfg['faster_cache'])
    if cfg.get('batch_size') is not None:
        from faster_whisper import BatchedInferencePipeline
        pipeline = BatchedInferencePipeline(model=model)
        # VAD segmentation is required for long-form batching. Faster Whisper
        # restores original source offsets, including every word timestamp.
        stream, info = pipeline.transcribe(cfg['audio'], language=cfg.get('language'),
            word_timestamps=True, vad_filter=True, vad_parameters={'min_silence_duration_ms': 2000, 'speech_pad_ms': 400},
            beam_size=cfg['beam_size'], batch_size=cfg['batch_size'])
    else:
        stream, info = model.transcribe(cfg['audio'], language=cfg.get('language'),
                                        word_timestamps=True, vad_filter=False, beam_size=cfg['beam_size'])
    segments = []
    for i, s in enumerate(stream):
        words = [clean_word({'word': w.word, 'start': w.start, 'end': w.end,
                             'probability': getattr(w, 'probability', None)}) for w in (s.words or [])]
        segments.append({'id': i, 'start': float(s.start), 'end': float(s.end),
                         'text': s.text, 'words': words,
                         'averageLogProbability': getattr(s, 'avg_logprob', None),
                         'noSpeechProbability': getattr(s, 'no_speech_prob', None)})
    result = {'engine': cfg['engine'], 'model': cfg['model'], 'language': info.language,
              'languageProbability': info.language_probability, 'duration': info.duration,
              'device': cfg['device'], 'computeType': cfg['compute_type'], 'segments': segments,
              'batchSize': cfg.get('batch_size'), 'beamSize': cfg['beam_size']}
else:
    import whisper
    model = whisper.load_model(cfg['model'], device=cfg['device'], download_root=cfg['openai_cache'])
    raw = model.transcribe(cfg['audio'], language=cfg.get('language'), word_timestamps=True, verbose=False)
    segments = []
    for i, s in enumerate(raw.get('segments', [])):
        words = [clean_word(w) for w in s.get('words', [])]
        segments.append({'id': int(s.get('id', i)), 'start': float(s['start']), 'end': float(s['end']),
                         'text': s.get('text', ''), 'words': words,
                         'averageLogProbability': s.get('avg_logprob'),
                         'noSpeechProbability': s.get('no_speech_prob')})
    result = {'engine': cfg['engine'], 'model': cfg['model'], 'language': raw.get('language'),
              'duration': max([s['end'] for s in segments], default=0), 'device': cfg['device'],
              'computeType': cfg['compute_type'], 'segments': segments}

with open(out, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False)
`;

export function validateNormalizedTranscription(value: unknown): NormalizedTranscription {
  const result = value as NormalizedTranscription;
  if (!result || !Array.isArray(result.segments)) throw new Error('The transcription engine returned no segment timeline.');
  for (const segment of result.segments) {
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end < segment.start) {
      throw new Error('The transcription engine returned an invalid segment timeline.');
    }
    if (!Array.isArray(segment.words)) segment.words = [];
    for (const word of segment.words) {
      if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end < word.start) {
        throw new Error('The transcription engine returned an invalid word timeline.');
      }
    }
  }
  return result;
}

class PythonTranscriptionEngine implements TranscriptionEngine {
  constructor(readonly id: TranscriptionEngineId) {}

  async transcribe(request: TranscriptionRequest): Promise<NormalizedTranscription> {
    if (this.id === 'openai-whisper' && (request.beamSize !== undefined || request.batchSize != null)) throw new Error('Unsupported regular Whisper decoding controls');
    if (request.batchSize != null && (request.device !== 'cuda' || ![1, 2, 4, 8, 16].includes(request.batchSize))) throw new Error('Unsupported GPU batch size');
    if (this.id === 'faster-whisper') transcriptionSettings(this.id, { beamSize: request.beamSize ?? 5 });
    fs.mkdirSync(path.dirname(request.outputPath), { recursive: true });
    const config = {
      engine: this.id,
      audio: request.audioPath,
      output: request.outputPath,
      model: request.modelId,
      repository: request.fasterModelRepository,
      device: request.device,
      compute_type: request.computeType,
      faster_cache: request.fasterCacheDir,
      openai_cache: request.openAiCacheDir,
      language: request.language,
      batch_size: request.batchSize ?? null,
      beam_size: this.id === 'faster-whisper' ? request.beamSize ?? 5 : undefined,
    };
    try {
      await execFileAsync(request.pythonPath, ['-c', PYTHON_DLL_SETUP + PYTHON_RUNNER, JSON.stringify(config)], {
        signal: request.signal,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: request.env,
      });
    } catch (error: any) {
      if (request.signal?.aborted || error.name === 'AbortError') throw error;
      // Keep the original backend traceback in the server terminal, even when
      // the next attempt recovers. Do not echo execFile's inline Python command.
      console.error(`[Transcription ERROR] ${this.id} | Model: ${request.modelId} | Device: ${request.device.toUpperCase()} | Compute: ${request.computeType} | Batch: ${request.batchSize ?? 'Off'} | Beam: ${request.beamSize ?? (this.id === 'faster-whisper' ? 5 : 'native')}`);
      console.error(String(error.stderr || `Runtime process failed (${error.code || 'unknown error'})`).trim());
      // execFile's default message repeats the entire inline Python program.
      // Keep actionable backend errors without flooding the progress drawer.
      const detail = String(error.stderr || `Runtime process failed (${error.code || 'unknown error'})`).trim().split(/\r?\n/).slice(-4).join('\n').slice(-1200);
      throw new Error(`${this.id} transcription failed: ${detail}`);
    }
    if (!fs.existsSync(request.outputPath)) throw new Error(`${this.id} finished without producing a transcript.`);
    const result = validateNormalizedTranscription(JSON.parse(fs.readFileSync(request.outputPath, 'utf8')));
    validateExecutionSettings(result, request);
    return result;
  }
}

export const transcriptionEngines: Record<TranscriptionEngineId, TranscriptionEngine> = {
  'faster-whisper': new PythonTranscriptionEngine('faster-whisper'),
  'openai-whisper': new PythonTranscriptionEngine('openai-whisper'),
};

export function validateExecutionSettings(result: NormalizedTranscription, request: TranscriptionRequest): void {
  const fields: Array<[string, unknown, unknown]> = [
    ['engine', result.engine, request.engine], ['device', result.device, request.device],
    ['compute type', result.computeType, request.computeType],
    ['batch size', result.batchSize ?? null, request.batchSize ?? null],
    ['beam size', result.beamSize, request.engine === 'faster-whisper' ? request.beamSize ?? 5 : undefined],
  ];
  for (const [field, actual, expected] of fields) {
    if (actual !== expected) throw new Error(`Transcription result settings mismatch: ${field}. Backend output did not confirm the requested setting.`);
  }
}

function attemptDescription(attempt: TranscriptionAttempt, settings: TranscriptionSettings): string {
  return `Device: ${attempt.device.toUpperCase()} | Compute: ${attempt.computeType} | Batching: ${attempt.batchSize === null ? 'Off' : `Experimental / Batch ${attempt.batchSize}`} | Beam: ${settings.beamSize ?? 'native Whisper defaults'}`;
}

export function transcriptionFailure(error: unknown): 'oom' | 'gpu-runtime' | 'other' {
  const text = String((error as any)?.stderr || (error as any)?.message || error);
  if (/out of memory|CUBLAS_STATUS_ALLOC_FAILED|cudaErrorMemoryAllocation/i.test(text)) return 'oom';
  if (/CUDA|cuDNN|cuBLAS|no kernel image|driver version|not compiled with.*GPU/i.test(text)) return 'gpu-runtime';
  return 'other';
}

export async function transcribeWithFallback(
  capability: BackendCapabilities, settings: TranscriptionSettings, model: string,
  run: (attempt: TranscriptionAttempt) => Promise<NormalizedTranscription>,
  log: (message: string) => void, signal?: AbortSignal,
): Promise<NormalizedTranscription> {
  let attempt = selectTranscriptionAttempt(capability, settings, model);
  let attemptNumber = 0;
  log(`Requested batching: ${settings.batching} | Resolved batch: ${attempt.batchSize ?? 'Off'} | Requested beam: ${settings.beamSize ?? 'native Whisper defaults'}`);
  for (;;) {
    signal?.throwIfAborted();
    attemptNumber++;
    log(`${capability.engine} | Model: ${model} | Attempt: ${attemptNumber} | ${attemptDescription(attempt, settings)} | Fallback: ${attemptNumber > 1 ? 'Yes' : 'No'}`);
    try {
      const result = await run(attempt);
      log(`Transcription completed | ${capability.engine} | Model: ${model} | ${attemptDescription(attempt, settings)} | Fallback used: ${attemptNumber > 1 ? 'Yes' : 'No'} | Attempts: ${attemptNumber}`);
      return { ...result, batchSize: attempt.batchSize, ...(settings.beamSize === undefined ? {} : { beamSize: settings.beamSize }) };
    } catch (error: any) {
      signal?.throwIfAborted();
      if (error?.name === 'AbortError') throw error;
      const failure = transcriptionFailure(error);
      const detail = String(error?.stderr || error?.message || error).trim().slice(-1200);
      log(`ERROR: ${capability.engine} | Attempt: ${attemptNumber} | ${attemptDescription(attempt, settings)} | Failure: ${failure} | ${detail}`);
      if (attempt.device === 'cpu' || failure === 'other') throw error;
      if (failure === 'oom' && attempt.batchSize !== null && attempt.batchSize > 1) {
        const smaller = attempt.batchSize / 2;
        log(`Batch size ${attempt.batchSize} exceeded available GPU memory. Retrying with batch size ${smaller}.`);
        attempt = { ...attempt, batchSize: smaller };
        continue;
      }
      if (failure === 'oom' && capability.engine === 'faster-whisper' && attempt.computeType === 'float16' && capability.gpuComputeTypes.includes('int8_float16')) {
        log('CUDA FP16 exceeded available GPU memory. Retrying supported CUDA int8_float16.');
        attempt = { ...attempt, computeType: 'int8_float16' };
        continue;
      }
      log(`CUDA ${attempt.computeType} failed: ${failure === 'oom' ? 'GPU out of memory' : 'GPU runtime unavailable'}. Falling back to CPU with batching Off.`);
      capability.initialization = 'failed';
      capability.reason = failure === 'oom' ? 'This run exceeded GPU memory after reducing settings; CPU fallback used.' : 'GPU runtime initialization/execution failed; CPU fallback used. See transcription logs.';
      attempt = selectTranscriptionAttempt(capability, { ...settings, device: 'cpu', batching: 'off' }, model);
    }
  }
}
