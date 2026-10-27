import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { pathStamp } from './book-file-operations';

test('packaged replacement preserves IDs, supported moves and same-recording relinks', async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), 'identity-upgrade-'));
  const restoredRoot = root + '-restored';
  const inbox = path.join(root, 'Inbox'), library = path.join(root, 'Library'), folder = path.join(inbox, 'Book');
  fs.mkdirSync(folder, { recursive: true }); fs.mkdirSync(library);
  const ffmpeg = process.env.TEST_FFMPEG || path.resolve('runtime/bin/ffmpeg.exe');
  const ffprobe = process.env.TEST_FFPROBE || path.resolve('runtime/bin/ffprobe.exe');
  const source = path.join(folder, 'book.m4b'), other = path.join(root, 'other.m4b');
  for (const [file, narrator] of [[source, 'Reader'], [other, 'Different Reader']])
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-metadata', 'album=Book', '-metadata', `composer=${narrator}`, '-c:a', 'aac', file], { windowsHide: true });
  const job = { id: 'stable-project', name: 'Book', createdAt: new Date().toISOString(), status: 'draft',
    metadata: { title: 'Book', author: 'Writer', narrator: 'Reader', genres: [], language: 'eng', abridged: false, explicit: false },
    source: { kind: 'external', mode: 'file', path: source }, sourceFolderPath: folder, sourceMembership: 'confirmed',
    parts: [{ id: 'stable-part', name: 'book.m4b', sourceRelativePath: 'book.m4b', sizeBytes: fs.statSync(source).size, order: 1 }], chapters: [], logs: [], candidates: [] };
  const legacy = JSON.stringify([job]);
  fs.writeFileSync(path.join(root, 'jobs.json'), legacy);
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ inbox_folder: inbox, library_folder: library, ffmpeg_path: ffmpeg, ffprobe_path: ffprobe }));
  const packageRoot = path.resolve(process.env.TEST_PACKAGE_ROOT || 'release/SwissMouse-0.1.0-alpha.5');
  assert.ok(fs.existsSync(path.join(packageRoot, 'dist/server.cjs')), 'Build the release package before this test');
  let child: ReturnType<typeof spawn> | undefined, output = '';
  const port = 45000 + Math.floor(Math.random() * 900), base = `http://127.0.0.1:${port}`;
  const request = async (route: string, body?: object, status = 200) => {
    const response = await fetch(base + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
  };
  const stop = async () => {
    if (child && child.exitCode === null) { const exited = new Promise(resolve => child!.once('exit', resolve)); child.kill(); await exited; }
  };
  const start = async (codeRoot: string, dataRoot = root) => {
    child = spawn(process.execPath, [path.join(codeRoot, 'dist/server.cjs')], { env: { ...process.env, APP_ROOT: dataRoot, PORT: String(port), NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout!.on('data', data => output += data); child.stderr!.on('data', data => output += data);
    for (let i = 0; i < 150; i++) {
      try { if (!(await request('/api/library/scan-status')).scanning) return; } catch { /* Startup. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(output);
  };
  const snapshot = async (id = job.id) => {
    const page = await request('/api/catalog/library/query', { limit: 100 });
    const book = page.items.find((item: any) => item.id === id); assert.ok(book, id);
    const relations = await request(`/api/resources/${book.recordingId}/relations`);
    return { work: book.resourceId, recording: book.recordingId, files: relations.items.filter((item: any) => item.kind === 'core.contains').map((item: any) => item.toId).sort() };
  };
  try {
    await start(process.cwd());
    const original = await snapshot(); assert.equal(original.files.length, 1);
    await request(`/api/jobs/${job.id}/book-files/edit`, { directory: folder, file: source, stamp: await pathStamp(source), field: 'name', value: 'renamed.m4b' });
    assert.deepEqual(await snapshot(), original);
    await request(`/api/jobs/${job.id}/source-files`, { action: 'create-folder', parent: '', name: 'Moved' });
    await request(`/api/jobs/${job.id}/source-files`, { action: 'move', files: ['renamed.m4b'], destination: 'Moved' });
    assert.deepEqual(await snapshot(), original);
    const relocated = path.join(root, 'relocated.m4b'); fs.renameSync(path.join(folder, 'Moved/renamed.m4b'), relocated);
    const rejected = await request(`/api/jobs/${job.id}/source-file`, { path: other, relink: true, confirmSameRecording: true }, 409);
    assert.equal(rejected.code, 'RELINK_DIFFERENT_RECORDING');
    assert.deepEqual(await snapshot(), original);
    const relinked = await request(`/api/jobs/${job.id}/source-file`, { path: relocated, relink: true });
    assert.equal(relinked.job.id, job.id); assert.equal(relinked.job.parts[0].id, 'stable-part');
    assert.deepEqual(await snapshot(), original);
    const created = await request('/api/jobs', { name: 'Other edition', narrator: 'Different Reader', importPending: true, parts: [] }, 201);
    await request(`/api/jobs/${created.id}/source-file`, { path: other });
    const inspected = await request(`/api/jobs/${created.id}/inspect-import`, {});
    await request(`/api/jobs/${created.id}/finish-import`, { metadata: inspected.metadata, writeSource: false, process: false });
    const different = await snapshot(created.id);
    assert.notEqual(different.recording, original.recording); assert.notEqual(different.files[0], original.files[0]);
    await stop();
    // Replace/relocate application code while retaining the authoritative APP_ROOT.
    await start(packageRoot);
    assert.deepEqual(await snapshot(), original);
    assert.deepEqual(await snapshot(created.id), different);
    assert.equal((await request(`/api/jobs/${job.id}`)).source.path, relocated);
    assert.equal(fs.readFileSync(path.join(root, 'jobs.json'), 'utf8'), legacy, 'legacy migration input remains byte-for-byte intact');
    await stop();
    // Rebuild only disposable indexes. Durable aliases must survive.
    for (const suffix of ['', '-wal', '-shm']) {
      const file = path.join(root, `catalog.sqlite${suffix}`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    await start(packageRoot);
    assert.deepEqual(await snapshot(), original);
    assert.deepEqual(await snapshot(created.id), different);
    await stop();
    fs.cpSync(root, restoredRoot, { recursive: true, errorOnExist: true, force: false });
    await start(packageRoot, restoredRoot);
    assert.deepEqual(await snapshot(), original, 'manual folder restore retains work, recording and file identities');
    assert.deepEqual(await snapshot(created.id), different);
    assert.equal((await request(`/api/jobs/${job.id}`)).source.path, relocated, 'external media paths are retained by restore');
  } finally {
    await stop(); assert.ok(root.startsWith(process.cwd() + path.sep)); fs.rmSync(root, { recursive: true, force: true });
    assert.ok(restoredRoot.startsWith(process.cwd() + path.sep)); fs.rmSync(restoredRoot, { recursive: true, force: true });
  }
});
