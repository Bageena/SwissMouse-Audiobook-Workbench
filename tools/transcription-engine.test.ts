import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseFasterWhisperAttempts, validateNormalizedTranscription } from './transcription-engine';

test('CPU systems use Faster Whisper INT8 without a GPU requirement', () => {
  assert.deepEqual(chooseFasterWhisperAttempts(false), [{ device: 'cpu', computeType: 'int8' }]);
});

test('NVIDIA systems try GPU and then gracefully fall back to CPU', () => {
  assert.deepEqual(chooseFasterWhisperAttempts(true), [
    { device: 'cuda', computeType: 'float16' },
    { device: 'cpu', computeType: 'int8' },
  ]);
});

test('normalized output preserves segment and word timestamps', () => {
  const value = validateNormalizedTranscription({
    engine: 'faster-whisper', model: 'small', device: 'cpu', computeType: 'int8',
    segments: [{ id: 0, start: 12.5, end: 14, text: 'Chapter one', words: [
      { word: 'Chapter', start: 12.5, end: 13.1, probability: 0.97 },
      { word: 'one', start: 13.2, end: 14, probability: 0.95 },
    ] }],
  });
  assert.equal(value.segments[0].words[1].start, 13.2);
});

test('invalid shifted timelines are rejected', () => {
  assert.throws(() => validateNormalizedTranscription({
    engine: 'faster-whisper', model: 'small', device: 'cpu', computeType: 'int8',
    segments: [{ id: 0, start: 3, end: 2, text: '', words: [] }],
  }), /invalid segment timeline/);
});
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { transcriptionEngines } from './transcription-engine';

const python = path.resolve('runtime/venv/Scripts/python.exe');
test('Python execution routes each engine and cache independently', { skip: !fs.existsSync(python) }, async () => {
  const root = fs.mkdtempSync(path.resolve('.cache/transcription-routing-'));
  // Test-only modules record the actual arguments delivered to each Python backend.
  fs.writeFileSync(path.join(root, 'faster_whisper.py'), `
from types import SimpleNamespace
class WhisperModel:
    def __init__(self, name, device, compute_type, download_root):
        assert name == 'test/ct2-model'
        assert device == 'cpu' and compute_type == 'int8'
        assert download_root.endswith('ct2-cache')
    def transcribe(self, audio, **kwargs):
        assert kwargs['word_timestamps']
        return [], SimpleNamespace(language='en', language_probability=1, duration=1)
`);
  fs.writeFileSync(path.join(root, 'whisper.py'), `
class Model:
    def transcribe(self, audio, **kwargs):
        assert kwargs['word_timestamps']
        return {'segments': [], 'language': 'en'}
def load_model(name, device, download_root):
    assert name == 'tiny' and device == 'cpu'
    assert download_root.endswith('pt-cache')
    return Model()
`);
  for (const engine of ['faster-whisper', 'openai-whisper'] as const) {
    const result = await transcriptionEngines[engine].transcribe({
      pythonPath: python, audioPath: path.join(root, 'input.wav'), outputPath: path.join(root, engine + '.json'),
      modelId: 'tiny', fasterModelRepository: 'test/ct2-model', engine, device: 'cpu',
      computeType: engine === 'faster-whisper' ? 'int8' : 'float32',
      fasterCacheDir: path.join(root, 'ct2-cache'), openAiCacheDir: path.join(root, 'pt-cache'),
      env: {...process.env, PYTHONPATH: root},
    });
    assert.equal(result.engine, engine);
    assert.equal(result.device, 'cpu');
  }
});

const snapshots = path.resolve('models/whisperx/models--Systran--faster-whisper-tiny/snapshots');
const snapshot = fs.existsSync(snapshots) ? fs.readdirSync(snapshots).map(name => path.join(snapshots, name)).find(dir => fs.existsSync(path.join(dir, 'model.bin'))) : undefined;
test('installed Faster Whisper performs real offline CPU inference', { skip: !fs.existsSync(python) || !snapshot, timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.resolve('.cache/transcription-live-'));
  const audio = path.join(root, 'silence.wav');
  execFileSync(python, ['-c', 'import wave,sys; w=wave.open(sys.argv[1],"wb"); w.setparams((1,2,16000,0,"NONE","not compressed")); w.writeframes(bytes(32000)); w.close()', audio], {windowsHide:true});
  const result = await transcriptionEngines['faster-whisper'].transcribe({
    pythonPath: python, audioPath: audio, outputPath: path.join(root, 'result.json'), modelId: 'tiny',
    fasterModelRepository: snapshot, engine: 'faster-whisper', device: 'cpu', computeType: 'int8',
    fasterCacheDir: path.resolve('models/whisperx'), openAiCacheDir: path.join(root, 'unused'), language: 'en',
    env: {...process.env, HF_HUB_OFFLINE:'1'},
  });
  assert.equal(result.engine, 'faster-whisper');
  assert.equal(result.computeType, 'int8');
  assert.ok(Array.isArray(result.segments));
});
