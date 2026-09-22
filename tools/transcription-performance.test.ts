import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { transcriptionSettings, selectTranscriptionAttempt, supportedBatchSizes, capabilityLabel, type BackendCapabilities, type TranscriptionAttempt } from '../src/transcription';
import { transcribeWithFallback, transcriptionFailure, transcriptionEngines, validateExecutionSettings, type TranscriptionRequest, type NormalizedTranscription } from './transcription-engine';
import { BACKEND_CAPABILITY_SCRIPT } from './transcription-capabilities';
import { sourceProcessingKeys, preparationKey, transcriptionRequestKey, transcriptionResultKey, reusableTranscription } from './transcription-cache';
import { pytorchBuildOptions, pytorchInstallPlan } from './requirements';

const gpu: BackendCapabilities = { engine: 'faster-whisper', installed: true, version: '1.2.1', runtimeVersion: '4.8.2', gpuDetected: true, gpuAvailable: true, deviceCount: 1, cpuComputeTypes: ['float32', 'int8'], gpuComputeTypes: ['float16', 'int8_float16', 'float32'], supportsBatching: true, initialization: 'not-tested', freeMemoryMb: 16384 };
const settings = transcriptionSettings('faster-whisper');
const result = (attempt: TranscriptionAttempt): NormalizedTranscription => ({ engine: 'faster-whisper', model: 'small', ...attempt, segments: [{ id: 0, text: 'Chapter One', start: 1, end: 2, words: [{ word: 'Chapter', start: 1, end: 1.5 }, { word: 'One', start: 1.5, end: 2 }] }] });

test('GPU presence cannot override CPU-only PyTorch; Faster Whisper is independent', () => {
  const torch = { ...gpu, engine: 'openai-whisper' as const, gpuAvailable: false, cudaBuilt: false, cpuComputeTypes: ['float32'] };
  assert.equal(selectTranscriptionAttempt(torch, transcriptionSettings('openai-whisper'), 'small').device, 'cpu');
  assert.match(capabilityLabel(torch), /CPU-only/);
  assert.equal(selectTranscriptionAttempt(gpu, settings, 'small').device, 'cuda');
  assert.equal(selectTranscriptionAttempt({ ...gpu, gpuDetected: false, gpuAvailable: false }, settings, 'small').computeType, 'int8');
  assert.equal(selectTranscriptionAttempt(gpu, { ...settings, device: 'cpu' }, 'small').device, 'cpu');
  assert.equal(capabilityLabel(gpu, 'cpu'), 'CPU processing selected');
});
test('batching defaults Off; Auto is conservative; explicit sizes respect capabilities', () => {
  assert.equal(settings.beamSize, 5);
  assert.equal(selectTranscriptionAttempt(gpu, settings, 'small').batchSize, null);
  assert.equal(selectTranscriptionAttempt(gpu, { ...settings, batching: 'auto' }, 'small').batchSize, 4);
  assert.equal(selectTranscriptionAttempt({ ...gpu, freeMemoryMb: undefined }, { ...settings, batching: 'auto' }, 'large-v3').batchSize, 1);
  for (const size of [1, 2, 4, 8, 16] as const) assert.equal(selectTranscriptionAttempt(gpu, { ...settings, batching: size }, 'small').batchSize, size);
  assert.deepEqual(supportedBatchSizes({ ...gpu, gpuAvailable: false }, 'small'), []);
  assert.throws(() => selectTranscriptionAttempt({ ...gpu, freeMemoryMb: 2048 }, { ...settings, batching: 16 }, 'large-v3'), /exceeds/);
  assert.throws(() => selectTranscriptionAttempt({ ...gpu, supportsBatching: false }, { ...settings, batching: 'auto' }, 'small'), /unavailable/);
});
test('unsupported settings and noninteger beam sizes are rejected', () => {
  for (const input of [{ beamSize: 0 }, { beamSize: 6 }, { beamSize: 2.5 }, { beamSize: '3' }, { batching: 3 }, { device: 'cpu', batching: 'auto' }, { madeUp: true }]) assert.throws(() => transcriptionSettings('faster-whisper', input));
  assert.throws(() => transcriptionSettings('openai-whisper', { beamSize: 5 }), /original decoding/);
  assert.throws(() => transcriptionSettings('openai-whisper', { batching: 1 }), /original decoding/);
  assert.equal(transcriptionSettings('openai-whisper').beamSize, undefined);
});
test('OOM reduces batches then supported GPU precision then CPU, preserving words/beam', async () => {
  const calls: TranscriptionAttempt[] = [], logs: string[] = [];
  const output = await transcribeWithFallback({ ...gpu }, { ...settings, batching: 8, beamSize: 2 }, 'small', async attempt => {
    calls.push(attempt);
    if (attempt.device === 'cuda') throw new Error('CUDA out of memory');
    return result(attempt);
  }, log => logs.push(log));
  assert.deepEqual(calls.map(a => [a.device, a.computeType, a.batchSize]), [
    ['cuda', 'float16', 8], ['cuda', 'float16', 4], ['cuda', 'float16', 2], ['cuda', 'float16', 1],
    ['cuda', 'int8_float16', 1], ['cpu', 'int8', null],
  ]);
  assert.equal(output.beamSize, 2);
  assert.equal(output.segments[0].words[1].start, 1.5);
  assert.ok(logs.some(log => /Batch size 8.*batch size 4/.test(log)));
  assert.equal(logs.filter(log => log.startsWith('ERROR:')).length, 5);
  assert.ok(logs.some(log => /ERROR:.*Batch 8.*Beam: 2.*CUDA out of memory/.test(log)));
  assert.match(logs.at(-1)!, /Transcription completed.*Device: CPU.*Batching: Off.*Beam: 2.*Fallback used: Yes.*Attempts: 6/);
});
test('Auto logs the resolved batch and successful no-fallback settings', async () => {
  const logs: string[] = [];
  await transcribeWithFallback({ ...gpu }, { ...settings, batching: 'auto' }, 'small', async attempt => result(attempt), log => logs.push(log));
  assert.match(logs[0], /Requested batching: auto.*Resolved batch: 4.*Requested beam: 5/);
  assert.match(logs[1], /Attempt: 1.*Device: CUDA.*Compute: float16.*Batch 4.*Beam: 5.*Fallback: No/);
  assert.match(logs.at(-1)!, /Transcription completed.*Batch 4.*Fallback used: No.*Attempts: 1/);
});
test('terminal-facing log retains unrelated GPU errors and final CPU failure details', async () => {
  const logs: string[] = [];
  await assert.rejects(transcribeWithFallback({ ...gpu }, settings, 'small', async attempt => {
    throw new Error(attempt.device === 'cuda' ? 'cuDNN library missing: fixture diagnostic' : 'CPU inference failed: fixture diagnostic');
  }, log => logs.push(log)), /CPU inference failed/);
  assert.ok(logs.some(log => /ERROR:.*Device: CUDA.*cuDNN library missing: fixture diagnostic/.test(log)));
  assert.ok(logs.some(log => /ERROR:.*Device: CPU.*CPU inference failed: fixture diagnostic/.test(log)));
  assert.ok(logs.some(log => /Attempt: 2.*Batching: Off.*Fallback: Yes/.test(log)));
  assert.ok(!logs.some(log => /Transcription completed/.test(log)));
});
test('backend output must confirm the requested engine, device, compute, batch and beam', () => {
  const attempt = { device: 'cuda' as const, computeType: 'float16', batchSize: 4 };
  const request: TranscriptionRequest = { pythonPath: '', audioPath: '', outputPath: '', modelId: 'small', engine: 'faster-whisper', fasterCacheDir: '', openAiCacheDir: '', ...attempt, beamSize: 2 };
  const output = { ...result(attempt), beamSize: 2 };
  assert.doesNotThrow(() => validateExecutionSettings(output, request));
  for (const mismatch of [{ engine: 'openai-whisper' as const }, { device: 'cpu' as const }, { computeType: 'int8' }, { batchSize: null }, { beamSize: 5 }, { beamSize: undefined }]) {
    assert.throws(() => validateExecutionSettings({ ...output, ...mismatch }, request), /settings mismatch/);
  }
});
test('batch Off stays non-batched; unsupported GPU quantization is never attempted', async () => {
  const calls: TranscriptionAttempt[] = [];
  await transcribeWithFallback({ ...gpu, gpuComputeTypes: ['float16'] }, settings, 'small', async attempt => {
    calls.push(attempt);
    if (attempt.device === 'cuda') throw new Error('CUDA out of memory');
    return result(attempt);
  }, () => {});
  assert.deepEqual(calls.map(a => [a.device, a.batchSize]), [['cuda', null], ['cpu', null]]);
});
test('unrelated errors/cancellation are not OOM; runtime failures skip batch retries', async () => {
  let attempts = 0;
  await assert.rejects(transcribeWithFallback({ ...gpu }, settings, 'small', async () => { attempts++; throw new Error('corrupt audio'); }, () => {}), /corrupt audio/);
  assert.equal(attempts, 1);
  assert.equal(transcriptionFailure(new Error('CUDA driver version is insufficient')), 'gpu-runtime');
  attempts = 0;
  await transcribeWithFallback({ ...gpu }, { ...settings, batching: 8 }, 'small', async attempt => { attempts++; if (attempt.device === 'cuda') throw new Error('cuDNN library missing'); return result(attempt); }, () => {});
  assert.equal(attempts, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transcribeWithFallback(gpu, settings, 'small', async () => { throw new Error('must not run'); }, () => {}, controller.signal), /abort/i);
});
test('source hashing runs once; stage keys derive without rereading files', async () => {
  let reads = 0;
  const keys = await sourceProcessingKeys(['book.mp3'], 'standard', async files => { reads++; assert.deepEqual(files, ['book.mp3']); return 'content-hash'; });
  assert.equal(reads, 1);
  assert.equal(keys.preparedAudioKey, preparationKey('content-hash', 'standard'));
  assert.notEqual(keys.preparedAudioKey, preparationKey('content-hash', 'stitch'));
});
test('cache ignores UI settings, includes output settings, and retains successful reruns', () => {
  const attempt = selectTranscriptionAttempt(gpu, settings, 'small');
  const key = transcriptionRequestKey('audio', 'small', settings, gpu, attempt);
  assert.equal(key, transcriptionRequestKey('audio', 'small', { ...settings, theme: 'dark', leadIn: 2 } as any, gpu, attempt));
  for (const override of [{ beamSize: 1 }, { language: 'fr' }, { batching: 'auto' as const }, { device: 'cpu' as const }]) assert.notEqual(key, transcriptionRequestKey('audio', 'small', { ...settings, ...override }, gpu, attempt));
  assert.notEqual(key, transcriptionRequestKey('new-audio', 'small', settings, gpu, attempt));
  assert.notEqual(key, transcriptionRequestKey('audio', 'medium', settings, gpu, attempt));
  assert.notEqual(key, transcriptionRequestKey('audio', 'small', settings, { ...gpu, engine: 'openai-whisper' }, attempt));
  assert.notEqual(key, transcriptionRequestKey('audio', 'small', settings, { ...gpu, runtimeVersion: 'new' }, attempt));
  assert.notEqual(key, transcriptionRequestKey('audio', 'small', settings, gpu, { ...attempt, computeType: 'int8_float16' }));
  const actual = { ...result({ device: 'cpu', computeType: 'int8', batchSize: null }), requestKey: key, beamSize: 5 };
  const job = { transcription: actual, transcriptSegments: actual.segments, transcriptKey: transcriptionResultKey(key, actual) };
  assert.equal(reusableTranscription(job, key), true);
  assert.equal(reusableTranscription(job, 'changed-request'), false);
  assert.equal(reusableTranscription({ ...job, transcription: { ...actual, beamSize: 1 } }, key), false);
});
test('PyTorch build selection checks driver/architecture and requires replacement confirmation', () => {
  const hw = { hasNvidiaGpu: true, platform: 'win32', arch: 'x64', cudaVersion: '12.8', computeCapability: 8.6 };
  assert.equal(pytorchBuildOptions(hw).cudaIndex, 'cu126');
  assert.equal(pytorchBuildOptions({ ...hw, computeCapability: 12 }).cudaIndex, 'cu128');
  for (const override of [{ hasNvidiaGpu: false }, { cudaVersion: '11.8' }, { computeCapability: 3.5 }, { arch: 'arm64' }]) assert.equal(pytorchBuildOptions({ ...hw, ...override }).cudaAvailable, false);
  const report = { hardware: hw, components: [{ id: 'pytorch', installedVersion: '2.8.0+cpu' }] } as any;
  assert.throws(() => pytorchInstallPlan(report, 'cuda', false), /Confirm replacement/);
  assert.equal(pytorchInstallPlan(report, 'cuda', true)?.index, 'cu126');
  assert.equal(pytorchInstallPlan(report, undefined, false), null);
  assert.throws(() => pytorchInstallPlan({ ...report, hardware: { ...hw, hasNvidiaGpu: false } }, 'cuda', true), /No NVIDIA/);
  assert.equal(pytorchInstallPlan({ ...report, hardware: { ...hw, hasNvidiaGpu: false } }, 'cpu', true)?.index, 'cpu');
});

const python = path.resolve(process.platform === 'win32' ? 'runtime/venv/Scripts/python.exe' : 'runtime/venv/bin/python');
test('full backend error reaches terminal while the progress error remains compact', { skip: !fs.existsSync(python) }, async t => {
  fs.mkdirSync(path.resolve('.cache'), { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.cache/transcription-error-'));
  fs.writeFileSync(path.join(root, 'faster_whisper.py'), [
    'import sys',
    'class WhisperModel:',
    '    def __init__(self, *args, **kwargs):',
    "        print('Original GPU diagnostic context', file=sys.stderr)",
    "        raise RuntimeError('CUDA out of memory: test allocation')",
  ].join('\n'));
  const terminal: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => terminal.push(args.join(' ')));
  await assert.rejects(transcriptionEngines['faster-whisper'].transcribe({
    pythonPath: python, audioPath: 'test.wav', outputPath: path.join(root, 'result.json'), modelId: 'small',
    engine: 'faster-whisper', device: 'cuda', computeType: 'float16', batchSize: 8, beamSize: 3,
    fasterCacheDir: root, openAiCacheDir: root, env: { ...process.env, PYTHONPATH: root },
  }), error => {
    assert.match(String(error), /CUDA out of memory: test allocation/);
    assert.ok(!String(error).includes('Original GPU diagnostic context'));
    return true;
  });
  assert.match(terminal.join('\n'), /Transcription ERROR.*Device: CUDA.*Batch: 8.*Beam: 3/);
  assert.match(terminal.join('\n'), /Original GPU diagnostic context/);
  assert.match(terminal.join('\n'), /Traceback/);
  assert.ok(!terminal.join('\n').includes('cfg = json.loads'));
});
test('capability script covers CUDA-enabled, CPU-only, unavailable and broken PyTorch', { skip: !fs.existsSync(python) }, () => {
  for (const mode of ['cpu', 'cuda', 'unavailable', 'broken']) {
    const prefix = [
      'import sys, types, importlib.util, importlib.metadata',
      'mode = ' + JSON.stringify(mode),
      "importlib.util.find_spec = lambda name: True",
      "importlib.metadata.version = lambda name: 'test'",
      "def init():",
      "    if mode == 'broken': raise RuntimeError('CUDA init failed')",
      "torch = types.SimpleNamespace(__version__='2.test', version=types.SimpleNamespace(cuda=None if mode == 'cpu' else '12.6'),",
      "    cuda=types.SimpleNamespace(is_available=lambda: mode in ['cuda', 'broken'], init=init,",
      "      synchronize=lambda: None, device_count=lambda: 1, mem_get_info=lambda: (4096*1048576, 8192*1048576)),",
      "    ones=lambda *args, **kwargs: types.SimpleNamespace(add_=lambda n: None))",
      "sys.modules['torch'] = torch", '',
    ].join('\n');
    const output = JSON.parse(execFileSync(python, ['-c', prefix + BACKEND_CAPABILITY_SCRIPT, 'openai-whisper'], { encoding: 'utf8', windowsHide: true }));
    assert.equal(output.gpuAvailable, mode === 'cuda');
    assert.equal(output.cudaBuilt, mode !== 'cpu');
    if (mode === 'cuda') assert.equal(output.initialization, 'verified');
    if (mode === 'broken') assert.equal(output.initialization, 'failed');
  }
});
test('CTranslate2 capability script never consults PyTorch', { skip: !fs.existsSync(python) }, () => {
  const prefix = [
    'import sys, types, importlib.util, importlib.metadata',
    "importlib.util.find_spec = lambda name: True",
    "importlib.metadata.version = lambda name: 'test'",
    "sys.modules['torch'] = None",
    "sys.modules['ctranslate2'] = types.SimpleNamespace(__version__='4.test', get_cuda_device_count=lambda: 1,",
    "    get_supported_compute_types=lambda device, **kwargs: ['float16', 'int8_float16'] if device == 'cuda' else ['int8'])",
    "sys.modules['faster_whisper'] = types.SimpleNamespace(BatchedInferencePipeline=object)", '',
  ].join('\n');
  const output = JSON.parse(execFileSync(python, ['-c', prefix + BACKEND_CAPABILITY_SCRIPT, 'faster-whisper'], { encoding: 'utf8', windowsHide: true }));
  assert.equal(output.gpuAvailable, true);
  assert.equal(output.initialization, 'not-tested');
  assert.deepEqual(output.gpuComputeTypes, ['float16', 'int8_float16']);
});
test('Python runner passes beam and actual batching pipeline with word timestamps', { skip: !fs.existsSync(python) }, async () => {
  fs.mkdirSync(path.resolve('.cache'), { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.cache/batching-test-'));
  fs.writeFileSync(path.join(root, 'faster_whisper.py'), [
    'from types import SimpleNamespace',
    'def answer(kwargs):',
    "    assert kwargs['word_timestamps'] and kwargs['beam_size'] == 2",
    "    word = SimpleNamespace(word='Chapter', start=1.25, end=1.75)",
    "    return [SimpleNamespace(start=1.25, end=1.75, text='Chapter', words=[word])], SimpleNamespace(language='en', language_probability=1, duration=2)",
    'class WhisperModel:',
    '    def __init__(self, *args, **kwargs): pass',
    '    def transcribe(self, audio, **kwargs):',
    "        assert kwargs['vad_filter'] == False and 'batch_size' not in kwargs",
    '        return answer(kwargs)',
    'class BatchedInferencePipeline:',
    '    def __init__(self, model): assert isinstance(model, WhisperModel)',
    '    def transcribe(self, audio, **kwargs):',
    "        assert kwargs['batch_size'] == 4 and kwargs['vad_filter'] == True",
    '        return answer(kwargs)', '',
  ].join('\n'));
  for (const batchSize of [null, 4]) {
    const output = await transcriptionEngines['faster-whisper'].transcribe({
      pythonPath: python, audioPath: 'test.wav', outputPath: path.join(root, 'result.json'), modelId: 'tiny',
      engine: 'faster-whisper', device: 'cuda', computeType: 'float16', batchSize, beamSize: 2,
      fasterCacheDir: root, openAiCacheDir: root, env: { ...process.env, PYTHONPATH: root },
    });
    assert.equal(output.batchSize, batchSize);
    assert.equal(output.beamSize, 2);
    assert.equal(output.segments[0].words[0].start, 1.25);
  }
});
