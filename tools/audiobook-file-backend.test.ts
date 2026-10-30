import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createAudiobookFileBackend, createAudiobookFileState } from '../packages/audiobooks/src/backend';
import type { AudiobookFilePorts, FileCommandInput } from '../packages/audiobooks/src/file-ports';
import type { AudiobookJob } from '../src/types';
import { createTestFixture } from './test-fixtures.mjs';

function harness(t: { after: (fn: () => void) => void }) {
  const fixture = createTestFixture('.cache/audiobook-file-service-'); t.after(() => fixture.cleanup());
  const inbox = path.join(fixture.root, 'Inbox'), library = path.join(fixture.root, 'Library'); fs.mkdirSync(inbox); fs.mkdirSync(library);
  const calls: string[] = [];
  const unexpected = new Proxy({}, { get: (_target, name) => () => { calls.push(String(name)); throw new Error('Unexpected engine call: ' + String(name)); } });
  const job = { id: 'stable-book', name: 'Book', createdAt: '2026-01-01T00:00:00Z', status: 'draft', importPending: true,
    parts: [], totalSizeBytes: 0, totalDurationSeconds: 0, chapters: [], candidates: [], logs: [],
    metadata: { title: 'Book', author: '', narrator: '', genres: [], language: 'eng', abridged: false, explicit: false },
  } as AudiobookJob;
  const host: AudiobookFilePorts = {
    store: { projects: [job], get: id => host.store.projects.find(book => book.id === id), adopt: id => host.store.get(id), commit: () => { calls.push('commit'); }, rollback: () => host.store.projects, outputRoots: () => [], snapshot: value => JSON.parse(JSON.stringify(value)) },
    activity: createAudiobookFileState(),
    work: { processing: false, configSaving: false, validating: false, mutations: 0, metadataWriters: new Set(), cleanupReason: () => undefined },
    locations: { appRoot: fixture.root, appPath: (...parts) => path.join(fixture.root, ...parts), output: library, upload: path.join(fixture.root, 'inputs'), config: { inbox_folder: inbox, library_folder: library } },
    files: unexpected as AudiobookFilePorts['files'], media: unexpected as AudiobookFilePorts['media'],
    availability: unexpected as AudiobookFilePorts['availability'],
    views: { book: () => { throw new Error('Unexpected view'); }, visibleBooks: () => [], listening: { has: () => false } },
    metadata: unexpected as AudiobookFilePorts['metadata'], chapters: unexpected as AudiobookFilePorts['chapters'],
    validation: { signature: () => '' }, providers: unexpected as AudiobookFilePorts['providers'],
    logs: { event: () => {}, import: () => {}, failure: () => {} }, system: unexpected as AudiobookFilePorts['system'],
    catalog: { invalidate: () => {}, ready: async () => {}, publish: async () => {}, call: async () => ({ items: [] }) },
  };
  const backend = createAudiobookFileBackend(host);
  const input = (body: object = {}): FileCommandInput => ({ params: { id: job.id }, body, query: {}, getHeader: () => undefined });
  return { backend, host, job, calls, input, root: fixture.root };
}

test('source commands reject busy work and protected membership before reading media or committing', async t => {
  const { backend, host, job, calls, input } = harness(t);
  assert.deepEqual(calls, []); // Constructing the backend never probes tools or starts work.
  host.work.processing = true;
  const blocked = await backend.commands.postJobsLocalSource(input({ path: 'irrelevant' }));
  assert.equal(blocked.status, 409); assert.equal(host.activity.imports.size, 0); assert.deepEqual(calls, []);
  host.work.processing = false;
  job.sourceMembership = 'confirmed'; job.sourceFolderPath = 'original-root';
  job.parts = [{ id: 'stable-part', name: 'chosen.mp3', order: 1, sizeBytes: 10, durationSeconds: 2, bitrate: 128 }];
  const before = JSON.stringify(job);
  const rejected = await backend.commands.postJobsStep1Settings(input({ sourceFolderPath: 'replacement-root', parts: [] }));
  assert.equal(rejected.status, 409); assert.equal(JSON.stringify(job), before); assert.deepEqual(calls, []);
});

test('a failed local selection releases its shared import lock without changing saved work', async t => {
  const { backend, host, job, calls, input, root } = harness(t);
  const before = JSON.stringify(job);
  const result = await backend.commands.postJobsLocalSource(input({ path: path.join(root, 'missing.mp3'), commit: true }));
  assert.equal(result.status, 400); assert.match(result.body.error, /does not exist/);
  assert.equal(host.activity.imports.size, 0); assert.equal(host.activity.moving, false);
  assert.equal(JSON.stringify(job), before); assert.deepEqual(calls, []);
});

test('membership changes preserve surviving part IDs, saved transcript/rating and physical source bytes', t => {
  const { backend, job, calls, root } = harness(t);
  const source = path.join(root, 'one.mp3'); fs.writeFileSync(source, 'Original bytes');
  job.sourceFolderPath = root;
  job.parts = [{ id: 'part-one', name: 'one.mp3', order: 1, sizeBytes: 10, durationSeconds: 5, bitrate: 128 }, { id: 'part-two', name: 'two.mp3', order: 2, sizeBytes: 20, durationSeconds: 7, bitrate: 128 }];
  job.transcriptSegments = [{ start: 0, end: 1, text: 'Keep this saved transcript', id: 1, words: [] }]; job.personalRating = 8;
  backend.helpers.removeSourceMembership(job, ['one.mp3']);
  assert.equal(job.parts[0].id, 'part-two'); assert.equal(job.parts[0].order, 1); assert.equal(job.totalDurationSeconds, 7);
  assert.deepEqual(job.excludedSourceFiles, ['one.mp3']); assert.equal(job.sourceMembership, 'confirmed');
  assert.equal(job.transcriptSegments[0].text, 'Keep this saved transcript'); assert.equal(job.personalRating, 8);
  assert.equal(fs.readFileSync(source, 'utf8'), 'Original bytes'); assert.deepEqual(calls, []);
});

test('discovery requests share one scan promise and release it after all scanning work settles', async t => {
  const { backend, host } = harness(t);
  host.store.projects = [];
  let release!: () => void, scans = 0;
  const gate = new Promise<void>(done => { release = done; });
  host.files = { ...host.files, pathKey: file => path.resolve(file), within: (root, file) => !!path.relative(root, file) && !path.relative(root, file).startsWith('..'), scanRoot: async () => { scans++; await gate; return []; } };
  const first = backend.helpers.reconcileLibrary(), second = backend.helpers.reconcileLibrary();
  assert.equal(first, second); assert.equal(host.activity.scan, first);
  release(); await first;
  assert.equal(scans, 2); assert.equal(host.activity.scan, undefined); assert.equal(host.activity.progress.phase, 'Finished');
});
