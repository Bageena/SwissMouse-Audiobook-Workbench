import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createTestFixture, stopTestServer } from './test-fixtures.mjs';
import { readProjectState, rejectProjectWrites } from './project-store-fixture';

test('project commands preserve stored work, revisions and source files through errors and restarts', { timeout: 60000 }, async t => {
  const fixture = createTestFixture('.cache/audiobook-command-api-'), root = fixture.root;
  let child: ReturnType<typeof spawn> | undefined;
  t.after(async () => { if (child) await stopTestServer(child); fixture.cleanup(); });
  const source = path.join(root, 'external-source'); fs.mkdirSync(source);
  const audio = path.join(source, 'original.mp3'); fs.writeFileSync(audio, 'Original source bytes, never processed by this test.');
  const sourceHash = createHash('sha256').update(fs.readFileSync(audio)).digest('hex');
  const metadataJson = path.join(source, 'metadata.json'); fs.writeFileSync(metadataJson, 'Existing third-party metadata is preserved.');
  fs.mkdirSync(path.join(root, 'inbox')); fs.mkdirSync(path.join(root, 'Library'));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ audiobookshelf_metadata: false, inbox_folder: path.join(root, 'inbox'), library_folder: path.join(root, 'Library') }));
  const metadata = { title: 'Existing Book', author: 'Author', narrator: 'Narrator', genres: [], language: 'eng', explicit: false, abridged: false };
  const saved = { id: 'stable-existing-book', name: 'Existing Book', createdAt: '2026-01-01T00:00:00Z', status: 'transcribed', metadata, metadataRevision: 0,
    source: { kind: 'external', path: audio, mode: 'file' }, sourceFolderPath: source,
    parts: [{ id: 'stable-part', name: 'original.mp3', durationSeconds: 60, sizeBytes: fs.statSync(audio).size, bitrate: 128, order: 1 }], totalDurationSeconds: 60, totalSizeBytes: fs.statSync(audio).size,
    chapters: [{ id: 'stable-chapter', start: '00:00:00.000', title: 'Original chapter', titleManuallyEdited: true }], candidates: [], logs: [], personalRating: 7,
    transcriptSegments: [{ start: 0, end: 1, text: 'Previously saved transcript.' }], metadataDraft: { ...metadata, description: 'Unfinished description' },
  };
  const legacy = JSON.stringify([saved]); fs.writeFileSync(path.join(root, 'jobs.json'), legacy);
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = (listener.address() as net.AddressInfo).port; await new Promise<void>(done => listener.close(() => done()));
  const base = `http://127.0.0.1:${port}`;
  const boot = async () => {
    let output = '';
    child = spawn(process.execPath, [path.resolve('dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, PORT: String(port), NODE_ENV: 'production', SWISSMOUSE_RUNTIME_MODE: 'managed', SWISSMOUSE_OPEN_BROWSER: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout!.on('data', chunk => { output += chunk; }); child.stderr!.on('data', chunk => { output += chunk; });
    const deadline = Date.now() + 20000;
    while (!output.includes('SwissMouse server running')) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(output);
      await new Promise(done => setTimeout(done, 50));
    }
  };
  const json = async (route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + route, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const read = async () => { const result = await json('/api/jobs/' + saved.id); assert.equal(result.status, 200); return result.data; };
  await boot();
  assert.equal((await read()).personalRating, 7);
  assert.equal((await json('/api/jobs/missing')).status, 404);
  const pending = await json('/api/jobs', { name: 'Pending', importPending: true });
  assert.equal(pending.status, 201);
  assert.equal((await json('/api/jobs?limit=1')).data.length, 1);
  const edited = { ...metadata, title: 'Edited title', author: '', cover: null };
  assert.equal((await json(`/api/jobs/${saved.id}/metadata`, { metadata: edited, expectedRevision: 99 })).status, 409);
  assert.equal((await json(`/api/jobs/${saved.id}/metadata`, { metadata: { ...metadata, author: 42 }, expectedRevision: 0 })).status, 400);
  assert.equal((await json(`/api/jobs/${saved.id}/metadata-draft`, { metadata: [], expectedRevision: 0 })).status, 400);
  assert.equal((await read()).metadata.title, metadata.title);
  assert.equal((await json(`/api/jobs/${saved.id}/metadata-draft`, { metadata: { ...metadata, description: 'Draft retained on restart' }, expectedRevision: 0 })).status, 200);
  assert.equal((await json(`/api/jobs/${saved.id}/chapters`, { chapters: [{ id: 'bad', start: 'bad', title: 'Invalid' }] })).status, 400);
  assert.equal((await read()).chapters[0].id, 'stable-chapter');
  const manual = [{ id: 'stable-chapter', start: '00:00:00.000', title: 'Reviewed manually', titleManuallyEdited: true }];
  assert.equal((await json(`/api/jobs/${saved.id}/chapters`, { chapters: manual })).status, 200);
  await stopTestServer(child!); await boot();
  let current = await read();
  assert.equal(current.metadataDraft.description, 'Draft retained on restart');
  assert.equal(current.chapters[0].id, 'stable-chapter'); assert.equal(current.chapters[0].title, 'Reviewed manually');
  assert.equal(current.transcriptSegments[0].text, 'Previously saved transcript.');
  const allowWrites = rejectProjectWrites(root);
  try {
    const result = await json(`/api/jobs/${saved.id}/metadata`, { metadata: edited, expectedRevision: 0 });
    assert.equal(result.status, 500); assert.match(result.data.error, /Fixture project write failed/);
    current = await read(); assert.equal(current.metadata.title, metadata.title); assert.equal(current.metadataRevision || 0, 0);
    assert.equal(current.metadataDraft.description, 'Draft retained on restart');
    const bulk = await json('/api/library/metadata', { changes: [{ id: saved.id, fields: { title: 'Reject first' } }, { id: pending.data.id, fields: { title: 'Reject second' } }] });
    assert.equal(bulk.status, 500); assert.match(bulk.data.error, /Fixture project write failed/);
    assert.equal((await read()).metadata.title, metadata.title);
    assert.equal((await json('/api/jobs/' + pending.data.id)).data.metadata.title, 'Pending');
  } finally { allowWrites(); }
  const result = await json(`/api/jobs/${saved.id}/metadata`, { metadata: edited, expectedRevision: 0 });
  assert.equal(result.status, 200); assert.equal(result.data.job.metadataRevision, 1); assert.equal(result.data.job.metadata.cover, null);
  assert.equal((await json(`/api/jobs/${saved.id}/metadata-draft`, { metadata, expectedRevision: 0 })).status, 409);
  assert.equal((await json(`/api/jobs/${saved.id}/metadata-json`, { expectedRevision: 1 })).status, 200);
  assert.equal(fs.readFileSync(metadataJson, 'utf8'), 'Existing third-party metadata is preserved.');
  assert.equal(JSON.parse(fs.readFileSync(path.join(source, 'exmetadata.json'), 'utf8')).fileTags.title, 'Edited title');
  assert.equal((await json(`/api/jobs/${saved.id}/import/chapters-csv`, { csvText: 'start,end,title\n00:00:00.000,00:00:09.999,"Imported, One"\n00:00:10.000,,Two' })).status, 200);
  const csv = await fetch(`${base}/api/jobs/${saved.id}/export/chapters-csv`); assert.equal(csv.status, 200); assert.match(await csv.text(), /"Imported, One"/);
  await stopTestServer(child!); await boot();
  current = await read(); assert.equal(current.chapters[0].title, 'Imported, One'); assert.equal(current.chapters[0].id, 'imported-1');
  assert.equal(current.personalRating, 7); assert.ok(current.staleSteps.includes('export')); assert.ok(current.staleSteps.includes('validation'));
  assert.equal(readProjectState(root).find(project => project.id === saved.id)!.chapters[0].title, 'Imported, One');
  assert.equal(fs.readFileSync(path.join(root, 'jobs.json'), 'utf8'), legacy);
  assert.equal((await json(`/api/jobs/${saved.id}`, undefined, 'DELETE')).status, 200);
  assert.equal((await json(`/api/jobs/${saved.id}`)).status, 404);
  assert.equal(createHash('sha256').update(fs.readFileSync(audio)).digest('hex'), sourceHash);
});
