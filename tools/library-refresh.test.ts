import { readProjectState, rejectProjectWrites } from './project-store-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

test('refresh replaces legacy automatic collection entries and preserves confirmed book state across restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-collection-refresh-'));
  const inbox = path.join(root, 'Inbox'), library = path.join(root, 'Library'), author = path.join(inbox, 'Stephen King');
  const names = ['Carrie/01.mp3', 'Shining/Disc 1/01.mp3', 'Shining/Disc 2/01.mp3', 'Salem (1 of 2).m4b', 'Salem (2 of 2).m4b', 'Fairy Tale.m4b'];
  for (const name of names) { fs.mkdirSync(path.dirname(path.join(author, name)), { recursive: true }); fs.writeFileSync(path.join(author, name), name); }
  fs.mkdirSync(library);
  for (const title of ['Carrie', 'Shining']) fs.writeFileSync(path.join(author, title, 'metadata.json'), JSON.stringify({ title, author: 'Stephen King' }));
  const baseJob = { createdAt: new Date().toISOString(), status: 'draft', totalSizeBytes: 0, totalDurationSeconds: 0, chapters: [], candidates: [], logs: [] };
  const parts = names.map((name, index) => ({ id: `p${index}`, name, sizeBytes: name.length, durationSeconds: 0, bitrate: 0, order: index + 1 }));
  const legacy = { ...baseJob, id: 'legacy-collection', name: 'Wrong combined book', source: { kind: 'inbox', mode: 'folder', path: author }, sourceFolderPath: author,
    parts, metadataDraft: { title: 'Keep unfinished draft' }, chapters: [{ title: 'Keep manual chapter' }], transcript: { text: 'Keep transcript' },
    libraryScan: { type: 'inbox', root: inbox, path: author, signature: 'old', identity: 'old' } };
  const confirmed = { ...baseJob, id: 'confirmed-carrie', name: 'My Carrie', sourceMembership: 'confirmed', source: { kind: 'inbox', mode: 'folder', path: author }, sourceFolderPath: author,
    metadata: { title: 'My Carrie', author: 'Stephen King' }, metadataDraft: { title: 'My unfinished Carrie draft' }, parts: [parts[0]] };
  fs.writeFileSync(path.join(root, 'jobs.json'), JSON.stringify([legacy, confirmed]));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ inbox_folder: inbox, library_folder: library }));
  const port = 51000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  let server: ReturnType<typeof spawn> | undefined;
  const request = async (route: string, body?: object) => {
    const response = await fetch(base + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  const stored = () => readProjectState(root);
  const start = async () => {
    server = spawn(process.execPath, [path.resolve('dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, NODE_ENV: 'production', PORT: String(port) }, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 150; i++) {
      try { if (!(await request('/api/library/scan-status')).scanning) return; } catch { /* Startup. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Isolated server did not start');
  };
  const stop = async () => { if (server && server.exitCode === null) { const exited = new Promise(resolve => server!.once('exit', resolve)); server.kill(); await exited; } };
  try {
    await start();
    assert.equal((await request('/api/library')).length, 4);
    const snapshot = stored();
    const archived = snapshot.find((job: any) => job.id === legacy.id);
    assert.equal(archived.libraryScan.superseded, true);
    assert.equal(archived.libraryScan.missing, true);
    for (const field of ['parts', 'chapters', 'transcript', 'metadataDraft'] as const) assert.deepEqual(archived[field], legacy[field]);
    const manual = snapshot.find((job: any) => job.id === confirmed.id);
    assert.deepEqual(manual.parts, confirmed.parts);
    assert.deepEqual(manual.metadataDraft, confirmed.metadataDraft);
    assert.equal(manual.metadata.title, 'My Carrie');
    const salem = snapshot.find((job: any) => job.id !== legacy.id && job.parts.length === 2 && job.parts[0].name.startsWith('Salem'));
    assert.ok(salem, 'loose multipart book has its own complete membership');
    assert.equal(salem.sourceFolderPath, author);
    await request('/api/library/refresh', {});
    assert.deepEqual(stored(), snapshot, 'refresh is idempotent');
    await request('/api/library/rebuild', { sources: ['inbox'], confirmed: true });
    assert.deepEqual((await request('/api/library')).map((book: any) => book.id).sort(), snapshot.filter((job: any) => !job.libraryScan.missing).map((job: any) => job.id).sort());
    await stop(); await start();
    assert.equal((await request('/api/library')).length, 4, 'restart does not resurrect or duplicate the collection');
    assert.equal(stored().find((job: any) => job.id === salem.id).parts.length, 2);
    for (const name of names) assert.equal(fs.readFileSync(path.join(author, name), 'utf8'), name);
  } finally { await stop(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('incremental refresh and source-specific rebuild preserve files and isolated stored state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-refresh-'));
  const inbox = path.join(root, 'Inbox'), library = path.join(root, 'Library');
  fs.mkdirSync(inbox); fs.mkdirSync(library);
  const add = (source: string, name: string) => {
    const folder = path.join(source, name); fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'audio.mp3'), 'fixture audio bytes');
    fs.writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify({ title: name, author: 'Writer' }));
    return folder;
  };
  const first = add(inbox, 'First'), second = add(library, 'Second');
  const sharedExport = path.join(library, 'First-export.m4b');
  fs.writeFileSync(sharedExport, 'shared export bytes');
  fs.writeFileSync(path.join(root, 'jobs.json'), JSON.stringify([{
    id: 'shared-project', name: 'First', createdAt: new Date().toISOString(), status: 'draft',
    metadata: { title: 'First', author: 'Writer', genres: [], language: 'eng', abridged: false, explicit: false },
    source: { kind: 'inbox', path: first, mode: 'folder' }, sourceFolderPath: first,
    parts: [{ id: 'p1', name: 'audio.mp3', sizeBytes: 19, durationSeconds: 0, bitrate: 0, order: 1 }],
    totalSizeBytes: 19, totalDurationSeconds: 0, chapters: [], candidates: [], logs: [],
    outputM4b: { fullPath: sharedExport, filename: 'First-export.m4b', sizeBytes: 19 },
  }]));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ inbox_folder: inbox, library_folder: library }));
  const port = 50000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.resolve('dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, NODE_ENV: 'production', PORT: String(port) }, stdio: 'ignore', windowsHide: true });
  const request = async (route: string, body?: object, status = 200) => {
    const response = await fetch(base + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
  };
  const stored = () => readProjectState(root);
  const rebuild = (sources: string[]) => request('/api/library/rebuild', { sources, confirmed: true });
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try { if (!(await request('/api/library/scan-status')).scanning) { ready = true; break; } } catch { /* Startup. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'isolated server started');
    const original = stored();
    await request('/api/library/refresh', {});
    assert.deepEqual(stored(), original, 'unchanged refresh does not rebuild stored books');
    const third = add(inbox, 'Third');
    assert.equal((await request('/api/library/refresh', {})).books.length, 3);
    const thirdId = stored().find((job: any) => job.name === 'Third').id;
    const moved = path.join(inbox, 'Renamed'); fs.renameSync(third, moved);
    await request('/api/library/refresh', {});
    assert.equal(stored().find((job: any) => job.id === thirdId).libraryScan.path, moved);
    fs.writeFileSync(path.join(moved, 'metadata.json'), JSON.stringify({ title: 'Changed title', author: 'Writer' }));
    fs.writeFileSync(path.join(moved, 'audio.mp3'), 'changed audio bytes with a different size');
    await request('/api/library/refresh', {});
    assert.equal(stored().find((job: any) => job.id === thirdId).metadata.title, 'Changed title');
    assert.equal(stored().find((job: any) => job.id === thirdId).totalSizeBytes, fs.statSync(path.join(moved, 'audio.mp3')).size);
    fs.rmSync(moved, { recursive: true });
    assert.equal((await request('/api/library/refresh', {})).books.length, 3, 'missing books remain reachable for recovery');
    assert.equal(stored().find((job: any) => job.id === thirdId).libraryScan.missing, true);
    await request('/api/library/rebuild', { sources: [], confirmed: true }, 400);
    await request('/api/library/rebuild', { sources: ['inbox'] }, 400);
    await request('/api/library/rebuild', { sources: ['external'], confirmed: true }, 400);
    const otherBefore = stored().filter((job: any) => job.libraryScan.type === 'library');
    const inboxTimestamp = stored().find((job: any) => job.name === 'First').metadataUpdatedAt;
    await rebuild(['inbox']);
    assert.notEqual(stored().find((job: any) => job.name === 'First').metadataUpdatedAt, inboxTimestamp, 'rebuild identifies even unchanged files');
    assert.deepEqual(stored().filter((job: any) => job.libraryScan.type === 'library'), otherBefore);
    const inboxBefore = stored().filter((job: any) => job.libraryScan.type === 'inbox');
    await rebuild(['library']);
    assert.deepEqual(stored().filter((job: any) => job.libraryScan.type === 'inbox'), inboxBefore);
    assert.equal((await request('/api/library')).length, 3, 'Library-only rebuild does not duplicate the Inbox project owning its export');
    assert.equal((await rebuild(['inbox', 'library'])).books.length, 3);
    for (const folder of [first, second]) {
      assert.equal(fs.readFileSync(path.join(folder, 'audio.mp3'), 'utf8'), 'fixture audio bytes');
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'metadata.json'), 'utf8')), { title: path.basename(folder), author: 'Writer' });
    }
    const firstJob = stored().find((job: any) => job.name === 'First');
    fs.renameSync(inbox, inbox + '-offline');
    const partial = await rebuild(['inbox', 'library']);
    assert.match(partial.warnings.join(' '), /Inbox scan unavailable/);
    assert.deepEqual(stored().find((job: any) => job.id === firstJob.id), firstJob, 'unavailable source retained');
    fs.renameSync(inbox + '-offline', inbox);
    const broken = add(inbox, 'Corrupt');
    fs.writeFileSync(path.join(broken, 'metadata.json'), '{broken');
    const recovered = await rebuild(['inbox', 'library']);
    assert.equal(recovered.books.length, 4, 'corrupt metadata does not stop other books or hide missing records');
    assert.match(recovered.books.find((book: any) => book.name === 'Corrupt').identificationWarning, /metadata.json/);
    const status = await request('/api/library/scan-status');
    assert.equal(status.scanning, false); assert.equal(status.progress.operation, 'rebuild');
    assert.ok(status.progress.folders >= 5); assert.equal(status.progress.discovered, 4);
    assert.equal(fs.readFileSync(sharedExport, 'utf8'), 'shared export bytes');
    // Force the atomic index replacement to fail, without touching source data.
    const snapshot = stored();
    const allowWrites=rejectProjectWrites(root);
    await request('/api/library/rebuild', { sources: ['library'], confirmed: true }, 500);
    allowWrites();
    for (const job of snapshot) assert.deepEqual((await request(`/api/jobs/${job.id}`)).libraryScan, job.libraryScan, 'failed commit rolls back in-memory index');
    assert.equal(fs.readFileSync(path.join(second, 'audio.mp3'), 'utf8'), 'fixture audio bytes');
  } finally {
    if (server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
