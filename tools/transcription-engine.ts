import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

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
    stream, info = model.transcribe(cfg['audio'], language=cfg.get('language'),
                                    word_timestamps=True, vad_filter=False, beam_size=5)
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
              'device': cfg['device'], 'computeType': cfg['compute_type'], 'segments': segments}
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
    };
    await execFileAsync(request.pythonPath, ['-c', PYTHON_DLL_SETUP + PYTHON_RUNNER, JSON.stringify(config)], {
      signal: request.signal,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: request.env,
    });
    if (!fs.existsSync(request.outputPath)) throw new Error(`${this.id} finished without producing a transcript.`);
    return validateNormalizedTranscription(JSON.parse(fs.readFileSync(request.outputPath, 'utf8')));
  }
}

export const transcriptionEngines: Record<TranscriptionEngineId, TranscriptionEngine> = {
  'faster-whisper': new PythonTranscriptionEngine('faster-whisper'),
  'openai-whisper': new PythonTranscriptionEngine('openai-whisper'),
};

export function chooseFasterWhisperAttempts(hasNvidiaGpu: boolean): Array<{ device: 'cpu' | 'cuda'; computeType: string }> {
  return hasNvidiaGpu
    ? [{ device: 'cuda', computeType: 'float16' }, { device: 'cpu', computeType: 'int8' }]
    : [{ device: 'cpu', computeType: 'int8' }];
}
