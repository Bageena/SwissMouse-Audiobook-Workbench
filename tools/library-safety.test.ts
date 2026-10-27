import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

test('shared sidecars, stale metadata, missing multipart sources and every exported format are protected through the API', async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), 'library-safety-'));
  const library = path.join(root, 'Library'), inbox = path.join(root, 'Inbox');
  fs.mkdirSync(library); fs.mkdirSync(inbox);
  const ffmpeg = process.env.TEST_FFMPEG || path.resolve('runtime/bin/ffmpeg.exe');
  const ffprobe = process.env.TEST_FFPROBE || path.resolve('runtime/bin/ffprobe.exe');
  const seed = path.join(root, 'seed.m4b'), chapterFile = path.join(root, 'chapters.txt');
  fs.writeFileSync(chapterFile, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=One\n');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-i', chapterFile, '-map_metadata', '1', '-map_chapters', '1', '-c:a', 'aac', seed], { windowsHide: true });
  const make = (id: string, folder: string, names: string[]) => {
    fs.mkdirSync(folder, { recursive: true });
    names.forEach(name => fs.copyFileSync(seed, path.join(folder, name)));
    const metadata = { title: id, author: 'Writer', narrator: '', genres: [], language: 'eng', abridged: false, explicit: false };
    return { id, name: id, createdAt: new Date().toISOString(), status: 'draft', sourceMembership: 'confirmed', metadata,
      metadataDraft: { ...metadata, description: 'Unfinished' }, source: { kind: 'managed', mode: names.length === 1 ? 'file' : 'folder', path: names.length === 1 ? path.join(folder, names[0]) : folder },
      sourceFolderPath: folder, parts: names.map((name, index) => ({ id: 'p' + index, name, sizeBytes: fs.statSync(seed).size, order: index + 1, durationSeconds: 1, bitrate: 64 })), totalSizeBytes: fs.statSync(seed).size * names.length,
      totalDurationSeconds: 1, chapters: [{ id: 'c', title: 'One', start: '00:00:00.000', end: '00:00:01.000' }], candidates: [], logs: [] };
  };
  const shared = path.join(library, 'Shared');
  const a = make('A', shared, ['A.m4b']), b = make('B', shared, ['B.m4b']);
  const sidecar = path.join(shared, 'metadata.json'); fs.writeFileSync(sidecar, '{"title":"shared sentinel"}');
  const missing = make('Missing', path.join(inbox, 'Missing'), ['01.m4b', '02.m4b']);
  const replacement = path.join(root, 'Replacement'); fs.renameSync(missing.sourceFolderPath, replacement);
  const checked = make('Checked', path.join(inbox, 'Checked'), ['book.m4b']);
  const output = path.join(root, 'checked.m4b'); fs.copyFileSync(seed, output);
  const broken = path.join(root, 'broken.mp3'); fs.writeFileSync(broken, 'invalid media');
  const outputM4b = { fullPath: output, filename: 'checked.m4b', format: 'm4b', duration: 1, sizeBytes: fs.statSync(output).size };
  fs.writeFileSync(path.join(root, 'jobs.json'), JSON.stringify([a, b, missing, { ...checked, outputM4b, exportedFiles: { m4b: output, mp3: broken } }]));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ inbox_folder: inbox, library_folder: library, ffmpeg_path: ffmpeg, ffprobe_path: ffprobe }));
  const port = 48000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.resolve(process.env.TEST_PACKAGE_ROOT || '.', 'dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, NODE_ENV: 'production', PORT: String(port) }, stdio: 'ignore', windowsHide: true });
  const request = async (route: string, body?: object, expected = 200) => {
    const response = await fetch(base + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
  };
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try { if (!(await request('/api/library/scan-status')).scanning) { ready = true; break; } } catch { /* Startup. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'isolated server started');
    const resourceSnapshot = async () => {
      const page = await request('/api/catalog/library/query', { limit: 100 });
      const book = page.items.find((item: any) => item.id === 'Missing');
      const relations = await request(`/api/resources/${book.recordingId}/relations`);
      return { work: book.resourceId, recording: book.recordingId, files: relations.items.filter((item: any) => item.kind === 'core.contains').map((item: any) => item.toId).sort() };
    };
    const originalIdentities = await resourceSnapshot();
    const before = await request('/api/jobs/A');
    const bulk = await request('/api/library/metadata', { changes: [{ id: 'A', fields: { title: 'Edited A' } }] });
    assert.equal(bulk.jsonFailures.length, 1, 'ambiguous folder sidecar is skipped');
    assert.equal(fs.readFileSync(sidecar, 'utf8'), '{"title":"shared sentinel"}');
    await request('/api/jobs/A/metadata', { metadata: before.metadata, expectedRevision: before.metadataRevision || 0 }, 409);
    await request('/api/jobs/A/metadata-draft', { metadata: before.metadata, expectedRevision: before.metadataRevision || 0 }, 409);
    const saved = await request('/api/jobs/A'); assert.equal(saved.metadata.title, 'Edited A'); assert.equal(saved.metadataDraft.description, 'Unfinished');
    const books = await request('/api/library'); assert.ok(books.find((book: any) => book.id === 'Missing')?.sourceMissing, 'missing records remain visible');
    const unconfirmed = await request('/api/jobs/Missing/source-file', { path: replacement, relink: true }, 409);
    assert.equal(unconfirmed.code, 'RELINK_CONFIRM_IDENTITY');
    assert.equal((await request('/api/jobs/Missing')).sourceFolderPath, missing.sourceFolderPath);
    const relinked = await request('/api/jobs/Missing/source-file', { path: replacement, relink: true, confirmSameRecording: true });
    assert.deepEqual(relinked.job.parts.map((part: any) => part.id), missing.parts.map(part => part.id));
    assert.equal(relinked.job.metadataDraft.description, 'Unfinished'); assert.equal(relinked.job.sourceMissing, false);
    assert.equal(relinked.job.processingStatus, 'incomplete');
    assert.deepEqual(await resourceSnapshot(), originalIdentities);
    const validation = await request('/api/jobs/Checked/validate', {});
    assert.equal(validation.validations.length, 2);
    assert.equal(validation.validation.status, 'FAIL', 'a readable last output cannot hide an invalid alternate format');
    assert.equal((await request('/api/jobs/Checked')).canMoveToLibrary, false);
  } finally {
    if (server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill(); await stopped; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
