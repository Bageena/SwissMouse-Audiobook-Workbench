import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createAudiobookCompletionBackend, createAudiobookCompletionState } from '../packages/audiobooks/src/backend';
import { createAudiobookFileBackend } from '../packages/audiobooks/src/file-backend';
import type { AudiobookFilePorts } from '../packages/audiobooks/src/file-ports';
import type { AudiobookCompletionPorts, CompletionInput } from '../packages/audiobooks/src/completion-ports';
import type { AudiobookJob } from '../packages/audiobooks/src/legacy-domain';
import { pathKey, within } from './library-filesystem';
import { createTestFixture } from './test-fixtures.mjs';

function harness(t: { after: (fn: () => void) => void }) {
  const fixture = createTestFixture('.cache/audiobook-completion-'); t.after(() => fixture.cleanup());
  const root = fixture.root, library = path.join(root, 'Library'), upload = path.join(root, 'inputs'), inbox = path.join(upload, 'Inbox');
  fs.mkdirSync(library); fs.mkdirSync(inbox, { recursive: true });
  const original = path.join(inbox, 'original.m4b'); fs.writeFileSync(original, 'Original bytes');
  const job = { id: 'stable-book', name: 'Book', createdAt: '2026-01-01', status: 'review', parts: [{ id: 'stable-part', name: 'original.m4b', order: 1, sizeBytes: 14, durationSeconds: 10, bitrate: 128 }],
    source: { kind: 'inbox', mode: 'folder', path: inbox }, sourceFolderPath: inbox, outputFolderPath: library, sourceKey: 'source-key',
    totalDurationSeconds: 10, totalSizeBytes: 14, chapters: [{ id: 'stable-chapter', start: '00:00:00.000', title: 'Chapter' }], candidates: [], logs: [],
    metadata: { title: 'Book', author: '', narrator: '', genres: [], language: 'eng', abridged: false, explicit: false }, personalRating: 8,
    transcriptSegments: [{ id: 0, start: 0, end: 1, text: 'Saved transcript', words: [] }],
  } as AudiobookJob;
  const fileHost = { locations: { appRoot: root, appPath: (...parts: string[]) => path.join(root, ...parts), output: library, upload, config: { inbox_folder: inbox } },
    store: { projects: [job], outputRoots: () => [] }, files: { pathKey, within } } as unknown as AudiobookFilePorts;
  const source = createAudiobookFileBackend(fileHost).helpers;
  const events: string[] = [], state = createAudiobookCompletionState();
  const unexpected = new Proxy({}, { get: (_target, name) => () => { throw new Error('Unexpected engine call: ' + String(name)); } });
  const host: AudiobookCompletionPorts = {
    state, store: { projects: [job], get: id => id === job.id ? job : undefined, save: () => { events.push('save'); }, progress: () => {}, flushStopped: () => {}, snapshot: value => structuredClone(value) },
    work: { processing: false, imports: new Set(), moving: false, installing: false, runtimeMutation: false, youtubeInstalling: false, modelDownloads: 0, fasterInstalls: 0, mutations: 1 },
    locations: { appRoot: root, appPath: (...parts) => path.join(root, ...parts), output: library, upload }, config: { inbox_folder: inbox, library_template: '%Book Title%' },
    source: { ...source, sourceFilePaths: () => [original], exportedAudioPaths: () => [], availableOriginalPaths: () => [original],
      projectFilePaths: () => [original], completionSignature: async () => 'completion', canMoveInboxBook: () => false },
    files: { pathKey, within, stamp: async () => { throw new Error('Unexpected stamp'); }, projectFiles: () => [], assertSidecarOwnership: () => {}, extensions: new Set(['m4b']) },
    media: { ...unexpected, ffmpeg: () => 'fixture-ffmpeg', ffprobe: () => 'fixture-ffprobe', retainWaveform: () => true } as AudiobookCompletionPorts['media'],
    checks: { signature: () => 'current-signature', run: async () => { throw new Error('Unexpected final check'); } },
    archive: { create: async () => { throw new Error('Unexpected archive'); }, restore: async journal => { events.push(journal); } },
    catalog: { publish: async () => {}, invalidate: () => {} }, logs: { event: (_source, message) => { events.push(message); }, failure: (_id, _operation, message) => { events.push(message); } },
    system: { openFolder: async () => { throw new Error('Unexpected folder launch'); } },
  };
  const backend = createAudiobookCompletionBackend(host);
  const input = (body: object = {}, query: object = {}): CompletionInput => ({ params: { id: job.id }, body, query, getHeader: () => undefined });
  return { root, host, state, backend, job, input, events, original, inbox, upload };
}

test('cleanup rejects preflight exports, metadata writes, validation and moves before deleting any files', async t => {
  const h = harness(t), before = JSON.stringify(h.job);
  for (const lock of ['export', 'metadata', 'validation', 'move']) {
    if (lock === 'export') h.state.exports.add(h.job.id);
    if (lock === 'metadata') h.state.metadataWriters.add(h.job.id);
    if (lock === 'validation') h.state.validating = true;
    if (lock === 'move') h.host.work.moving = true;
    const result = await h.backend.commands.postCleanup(h.input({ cleanupType: 'all-working', confirmation: 'CLEAR ALL WORKING FILES' }));
    assert.equal(result.status, 409, lock);
    h.state.exports.clear(); h.state.metadataWriters.clear(); h.state.validating = false; h.host.work.moving = false;
  }
  assert.equal(JSON.stringify(h.job), before); assert.equal(fs.readFileSync(h.original, 'utf8'), 'Original bytes'); assert.deepEqual(h.events, []);
});

test('cleanup refuses paths outside its managed root and retains an Inbox nested inside uploads', t => {
  const h = harness(t);
  assert.throws(() => h.backend.helpers.removeManagedChild(h.upload, path.join(h.root, 'outside')), /outside the managed cleanup area/);
  assert.equal(h.backend.helpers.removeManagedChild(h.upload, h.inbox), false);
  assert.equal(fs.readFileSync(h.original, 'utf8'), 'Original bytes');
});

test('PCM cleanup protects source and export paths and retains transcript, chapters, rating and waveform identity', t => {
  const h = harness(t), work = h.host.source.projectIntermediatesDir(h.job); fs.mkdirSync(work, { recursive: true });
  const analysis = path.join(work, 'analysis.wav'), master = path.join(work, 'master.wav'), output = path.join(work, 'part-1.wav');
  for (const file of [analysis, master, output, path.join(work, 'transcript.json')]) fs.writeFileSync(file, 'Saved bytes');
  h.host.source.sourceFilePaths = () => [master]; h.host.source.exportedAudioPaths = () => [output]; h.job.previewPath = analysis;
  const before = structuredClone({ chapters: h.job.chapters, transcript: h.job.transcriptSegments, rating: h.job.personalRating });
  assert.equal(h.backend.helpers.clearProjectPcm(h.job), Buffer.byteLength('Saved bytes'));
  assert.equal(fs.existsSync(analysis), false); assert.equal(fs.readFileSync(master, 'utf8'), 'Saved bytes'); assert.equal(fs.existsSync(output), true);
  assert.equal(fs.existsSync(path.join(work, 'transcript.json')), true);
  assert.deepEqual({ chapters: h.job.chapters, transcript: h.job.transcriptSegments, rating: h.job.personalRating }, before);
  assert.deepEqual(h.job.retainedWaveform, { audio: analysis, sourceKey: 'source-key' });
});

test('a final-check signature failure releases shared validation state and leaves source audio intact', async t => {
  const h = harness(t); h.host.checks.signature = () => { throw new Error('Fixture signature failure'); };
  const result = await h.backend.commands.postJobsValidate(h.input());
  assert.equal(result.status, 500); assert.match(result.body.error, /signature failure/);
  assert.equal(h.state.validating, false); assert.equal(h.state.checks.size, 0);
  assert.equal(fs.readFileSync(h.original, 'utf8'), 'Original bytes');
});

test('cancelling Final Check retains its lock until the engine settles and publishes a cancelled report', async t => {
  const h = harness(t); let fail!: (error: Error) => void;
  h.host.checks.run = async options => new Promise((_resolve, reject) => { fail = reject; options.progress('Checking fixture', []); });
  const running = h.backend.commands.postJobsValidate(h.input());
  assert.equal(h.state.validating, true); assert.equal(h.state.checks.size, 1);
  await h.backend.commands.postJobsFinalCheckCancel(h.input());
  assert.equal(h.state.checks.get(h.job.id)?.controller.signal.aborted, true); assert.equal(h.state.validating, true);
  assert.equal((await h.backend.commands.postCleanup(h.input({ cleanupType: 'pcm' }))).status, 409);
  fail(new Error('Cancelled fixture')); assert.equal((await running).body.status, 'cancelled');
  assert.equal(h.state.validating, false); assert.equal(h.state.checks.size, 0); assert.equal(h.job.finalCheck?.state, 'cancelled');
  assert.equal(h.job.transcriptSegments![0].text, 'Saved transcript');
});

test('finish rejects a stale destination without moving or clearing files', async t => {
  const h = harness(t); h.job.finalCheck = { checkedAt: '', inputSignature: 'current-signature', state: 'complete', items: [], files: [], sourceDuration: 10, expectedDuration: 10, removedSeconds: 0 };
  const result = await h.backend.commands.postJobsFinish(h.input({ location: 'current', target: 'stale-destination' }));
  assert.equal(result.status, 409); assert.match(result.body.error, /destination changed/);
  assert.equal(h.host.work.moving, false); assert.equal(fs.readFileSync(h.original, 'utf8'), 'Original bytes'); assert.deepEqual(h.events, []);
});

test('failed export preflight releases the live export lock without changing source bytes', async t => {
  const h = harness(t); h.job.mergedMp3 = { fullPath: h.original, filename: 'original.m4b', duration: 10, bitrate: 128, sizeBytes: 14 };
  h.host.source.sourceFingerprint = async () => { throw new Error('Fixture source changed'); };
  const result = await h.backend.commands.postJobsBuildM4b(h.input({ outputFormats: ['m4b'] }));
  assert.equal(result.status, 400); assert.equal(h.state.exports.size, 0); assert.equal(h.state.messages.size, 0);
  assert.equal((await h.backend.commands.getJobsExportProgress(h.input())).body.running, false);
  assert.equal(fs.readFileSync(h.original, 'utf8'), 'Original bytes');
});

test('archive recovery reports a failed journal and continues recovering the remaining entries', async t => {
  const h = harness(t);
  for (const name of ['originals-archive-a.json', 'originals-archive-b.json']) fs.writeFileSync(path.join(h.root, name), '{}');
  h.host.archive.restore = async journal => { h.events.push(path.basename(journal)); if (journal.endsWith('-a.json')) throw new Error('Review required'); };
  await h.backend.recover();
  assert.ok(h.events.includes('originals-archive-a.json')); assert.ok(h.events.includes('originals-archive-b.json'));
  assert.ok(h.events.some(event => event.includes('needs attention'))); assert.equal(fs.readFileSync(h.original, 'utf8'), 'Original bytes');
});

test('candidate CSV keeps download headers and escaping at the command boundary', async t => {
  const h = harness(t); h.job.candidates = [{ candidate_id: 1, candidate_start: '00:00:01.000', candidate_end: '00:00:02.000', matched_text: 'Chapter "One"', context_before: '', context_after: '', confidence: '1', proposed_title: 'One, Two', status: 'review' }];
  const result = await h.backend.commands.getJobsExportCandidatesCsv(h.input());
  assert.equal(result.status, 200); assert.equal(result.headers?.['Content-Type'], 'text/csv');
  assert.match(result.headers!['Content-Disposition'], /Book-candidates.csv/); assert.match(result.text!, /"Chapter ""One"""/); assert.match(result.text!, /"One, Two"/);
});
