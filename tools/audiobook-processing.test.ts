import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { createAudiobookProcessingBackend, createAudiobookProcessingState } from '../packages/audiobooks/src/backend';
import type { AudiobookProcessingPorts, ProcessingCommandInput } from '../packages/audiobooks/src/processing-ports';
import type { AudiobookJob } from '../packages/audiobooks/src/legacy-domain';
import type { NormalizedTranscription, TranscriptionRequest } from '../packages/audiobooks/src/transcription-contracts';
import { preparationKey, transcriptionRequestKey, transcriptionResultKey } from '../packages/audiobooks/src/transcription-cache';
import { selectTranscriptionAttempt, transcriptionSettings } from '../packages/audiobooks/src/transcription-policy';
import { createTestFixture } from './test-fixtures.mjs';

function harness(t: { after: (fn: () => void) => void }) {
  const fixture = createTestFixture('.cache/audiobook-processing-'); t.after(() => fixture.cleanup());
  const source = path.join(fixture.root, 'source.mp3'), preview = path.join(fixture.root, 'analysis.wav');
  fs.writeFileSync(source, 'Original source bytes'); fs.writeFileSync(preview, 'Saved preview');
  let resolve!: (value: NormalizedTranscription) => void, reject!: (error: Error) => void;
  const pending = new Promise<NormalizedTranscription>((done, fail) => { resolve = done; reject = fail; });
  const requests: TranscriptionRequest[] = [], events: string[] = [];
  const unexpected = new Proxy({}, { get: (_target, name) => () => { throw new Error('Unexpected engine call: ' + String(name)); } });
  const job = { id: 'stable-book', name: 'Book', createdAt: '2026-01-01', status: 'transcribed', chapterSource: 'whisperx', mergeMethod: 'standard',
    parts: [{ id: 'stable-part', name: 'source.mp3', order: 1, durationSeconds: 10, bitrate: 128, sizeBytes: 21 }],
    sourceFolderPath: fixture.root, sourceKey: 'source-key', preparedAudioKey: preparationKey('source-key', 'standard'),
    previewPath: preview, mergedMp3: { fullPath: source, filename: 'source.mp3', duration: 10, bitrate: 128, sizeBytes: 21 },
    totalDurationSeconds: 10, totalSizeBytes: 21, chapters: [{ id: 'saved-chapter', title: 'Saved chapter', start: '00:00:00.000' }], candidates: [], logs: [], personalRating: 7,
    metadata: { title: 'Book', author: '', narrator: '', genres: [], language: 'eng', abridged: false, explicit: false },
    transcriptSegments: [{ id: 0, start: 0, end: 1, text: 'Saved transcript', words: [] }], transcriptWords: [],
    transcription: { model: 'Small', profile: 'small', engine: 'faster-whisper', device: 'cpu', computeType: 'int8', batchSize: null, beamSize: 5, segmentsCount: 1, wordsCount: 0 },
    pipelineSteps: { transcribing_whisper: { status: 'current', hasOutput: true } },
  } as AudiobookJob;
  const host: AudiobookProcessingPorts = {
    store: { get: id => id === job.id ? job : undefined, save: () => { events.push('save'); }, snapshot: value => structuredClone(value) },
    work: { installing: false, imports: new Set() }, config: { selected_model: 'small', detect_musical_transitions: false },
    locations: { appRoot: fixture.root, output: fixture.root, torch: path.join(fixture.root, 'torch'), matplotlib: path.join(fixture.root, 'mpl'), whisper: path.join(fixture.root, 'whisper'), openai: path.join(fixture.root, 'openai') },
    source: { sourceFingerprint: async () => 'source-key', projectIntermediatesDir: () => path.join(fixture.root, 'work'), resolvedOutputRoot: () => fixture.root,
      importedSourcePaths: () => [source], chaptersForJob: async () => ({ chapters: [], source: 'None' }), associateProjectFile: () => {} },
    runtime: { engine: () => 'faster-whisper', models: [{ id: 'small', name: 'Small' }] as AudiobookProcessingPorts['runtime']['models'], modelStatus: async () => ({ isInstalled: true }),
      capabilities: async () => ({ engine: 'faster-whisper', installed: true, version: 'fixture', runtimeVersion: 'fixture', gpuDetected: false, gpuAvailable: false, deviceCount: 0, cpuComputeTypes: ['int8'], gpuComputeTypes: [], supportsBatching: false, initialization: 'not-tested' }),
      python: () => source, isSystem: () => false, env: () => ({}), repositories: { small: 'fixture' },
      engines: { 'faster-whisper': { id: 'faster-whisper', transcribe: request => { requests.push(request); return pending; } }, 'openai-whisper': { id: 'openai-whisper', transcribe: async () => { throw new Error('Unexpected backend'); } } },
      transcribe: async (_capability, _settings, _model, run) => run({ device: 'cpu', computeType: 'int8', batchSize: null }),
    },
    media: unexpected as AudiobookProcessingPorts['media'], detection: unexpected as AudiobookProcessingPorts['detection'], logs: { event: () => {} },
  };
  const state = createAudiobookProcessingState(), backend = createAudiobookProcessingBackend(host, state);
  const input = (step = 'transcribing_whisper', body: object = {}): ProcessingCommandInput => ({ params: { id: job.id, step }, body });
  const normalized: NormalizedTranscription = { engine: 'faster-whisper', model: 'small', device: 'cpu', computeType: 'int8', batchSize: null,
    segments: [{ id: 0, start: 2, end: 3, text: 'New transcript', words: [{ word: 'New', start: 2, end: 2.5 }, { word: 'transcript', start: 2.5, end: 3 }] }] };
  return { host, state, backend, job, input, requests, events, source, resolve, reject, normalized };
}

async function until(predicate: () => boolean) {
  for (let count = 0; count < 200; count++) { if (predicate()) return; await setImmediate(); }
  assert.fail('Background processing did not reach its expected state');
}

test('processing guards and manual-chapter confirmation reject work before mutating saved output', async t => {
  const h = harness(t), before = JSON.stringify(h.job);
  h.host.work.installing = true;
  assert.equal((await h.backend.commands.processSource(h.input())).status, 409);
  assert.equal((await h.backend.commands.rerun(h.input())).status, 409);
  h.host.work.installing = false;
  h.job.chapters[0].titleManuallyEdited = true;
  const confirm = await h.backend.commands.rerun(h.input('detecting_chapters'));
  assert.equal(confirm.status, 409); assert.equal(confirm.body.requiresConfirmation, true);
  delete h.job.chapters[0].titleManuallyEdited;
  assert.equal(JSON.stringify(h.job), before); assert.equal(h.state.running, false); assert.equal(h.events.length, 0);
  assert.equal((await h.backend.commands.cancel(h.input())).status, 400);
});

test('cancellation holds the shared lock until the engine settles and preserves previous transcript and chapters', async t => {
  const h = harness(t), before = structuredClone({ segments: h.job.transcriptSegments, chapters: h.job.chapters, transcription: h.job.transcription });
  assert.equal((await h.backend.commands.rerun(h.input())).body.status, 'started');
  await until(() => h.requests.length === 1);
  assert.equal((await h.backend.commands.progress(h.input())).body.jobId, h.job.id);
  assert.equal((await h.backend.commands.cancel(h.input())).status, 200);
  assert.equal(h.requests[0].signal?.aborted, true); assert.equal(h.state.running, true);
  assert.equal((await h.backend.commands.processSource(h.input())).status, 409);
  h.resolve(h.normalized); await until(() => !h.state.running);
  assert.deepEqual({ segments: h.job.transcriptSegments, chapters: h.job.chapters, transcription: h.job.transcription }, before);
  assert.equal(h.job.personalRating, 7); assert.equal(h.state.abort, undefined); assert.equal(h.state.progress.stage, 'cancelled');
  assert.equal(fs.readFileSync(h.source, 'utf8'), 'Original source bytes');
});

test('start acknowledges before media probing and immediate cancellation prevents background inspection', async t => {
  const h = harness(t), old = structuredClone(h.job.transcriptSegments);
  // Every media method throws in this fixture: none may run before the reply,
  // or after cancellation before the first background turn.
  assert.equal((await h.backend.commands.processSource(h.input())).body.status, 'started');
  assert.equal(h.state.running, true); assert.equal(h.requests.length, 0);
  assert.equal((await h.backend.commands.cancel(h.input())).status, 200);
  await until(() => !h.state.running);
  assert.equal(h.state.progress.stage, 'cancelled'); assert.equal(h.state.progress.error, null);
  assert.deepEqual(h.job.transcriptSegments, old);
});

test('failed transcription keeps successful output and records a retryable failed stage', async t => {
  const h = harness(t), old = structuredClone(h.job.transcriptSegments);
  await h.backend.commands.rerun(h.input()); await until(() => h.requests.length === 1);
  h.reject(new Error('Fixture engine failure')); await until(() => !h.state.running);
  assert.deepEqual(h.job.transcriptSegments, old); assert.equal(h.job.pipelineSteps?.transcribing_whisper?.hasOutput, true);
  assert.equal(h.state.progress.stage, 'error'); assert.match(h.state.progress.error!, /Fixture engine failure/);
});

test('an independent transcription rerun replaces transcript only after success without redetecting chapters', async t => {
  const h = harness(t), old = structuredClone(h.job.chapters);
  h.job.chapterSource = 'existing_files'; h.job.pipelineSteps!.detecting_chapters = { status: 'current', hasOutput: true, updatedAt: 'unchanged' };
  await h.backend.commands.rerun(h.input()); await until(() => h.requests.length === 1);
  assert.equal(h.job.transcriptSegments![0].text, 'Saved transcript');
  h.resolve(h.normalized); await until(() => !h.state.running);
  assert.equal(h.job.transcriptSegments![0].text, 'New transcript'); assert.equal(h.job.transcriptWords?.length, 2);
  assert.deepEqual(h.job.chapters, old); assert.equal(h.job.pipelineSteps!.detecting_chapters?.updatedAt, 'unchanged');
  assert.equal(h.job.staleSteps?.includes('chapter_detection') || false, false); assert.equal(h.state.progress.stage, 'completed');
});

test('unchanged source and detection keys reuse saved transcript, master, preview and reviewed chapters', async t => {
  const h = harness(t), old = structuredClone(h.job.chapters);
  const settings = transcriptionSettings('faster-whisper'), capability = await h.host.runtime.capabilities('faster-whisper');
  const key = transcriptionRequestKey(h.job.preparedAudioKey!, 'small', settings, capability, selectTranscriptionAttempt(capability, settings, 'small'));
  h.job.transcription!.requestKey = key; h.job.transcriptKey = transcriptionResultKey(key, h.job.transcription!);
  h.job.chapterDetectionKey = h.backend.helpers.chapterDetectionCacheKey(h.job, false);
  h.host.media = { ...h.host.media, ffprobe: () => 'fixture-probe', inspect: () => ({ tags: {}, chapters: [], format: 'mp3', codec: 'mp3', sampleRate: 44100, channels: 2, bitrate: 128, durationSeconds: 10 }) };
  assert.equal((await h.backend.commands.processSource(h.input())).status, 200);
  await until(() => !h.state.running);
  assert.equal(h.requests.length, 0); assert.equal(h.state.progress.stage, 'completed');
  assert.deepEqual(h.job.chapters, old); assert.equal(h.job.transcriptSegments![0].text, 'Saved transcript');
  assert.equal(h.state.progress.logs.some(line => line.includes('Reusing reviewed chapters')), true);
});
