import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fingerprint, inspectAsync } from './audio-engine';
import { validateOriginalsZip } from './originals-archive';

for (const originalName of ['original.mp4', 'Archive Book.m4b']) test(`conversion archives ${originalName}, remains refreshable, finalizes and transfers at the book root`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-finalization-'));
  const inbox = path.join(root, 'Inbox'), library = path.join(root, 'Library'), source = path.join(inbox, 'Book');
  fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(library);
  const findTool = (name: string) => process.env['TEST_' + name.toUpperCase()] || path.resolve('runtime/bin', name + (process.platform === 'win32' ? '.exe' : ''));
  const ffmpeg = findTool('ffmpeg'), ffprobe = findTool('ffprobe');
  const original = path.join(source, originalName);
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:a', 'aac', original], { windowsHide: true });
  const media = await inspectAsync(ffprobe, original);
  const metadata = { title: 'Archive Book', author: 'Writer', narrator: 'Reader', genres: [], language: 'eng', abridged: false, explicit: false };
  fs.writeFileSync(path.join(source, 'metadata.json'), JSON.stringify(metadata));
  const job = { id: 'archive-book', name: metadata.title, metadata, metadataDraft: { ...metadata, description: 'Keep draft' },
    source: { kind: 'inbox', mode: 'folder', path: source }, sourceFolderPath: source, sourceMembership: 'confirmed',
    sourceKey: await fingerprint([original], {}), outputFolderPath: path.join(inbox, '.swissmouse-work'),
    parts: [{ id: 'p1', name: originalName, sizeBytes: media.sizeBytes, durationSeconds: media.durationSeconds, bitrate: 64, order: 1 }],
    status: 'review', createdAt: new Date().toISOString(), totalSizeBytes: media.sizeBytes, totalDurationSeconds: media.durationSeconds,
    mergedMp3: { filename: 'original.mp4', fullPath: original, duration: media.durationSeconds, sizeBytes: media.sizeBytes },
    chapters: [{ id: 'c1', title: 'One', start: '00:00:00.000', end: '00:00:02.000' }], candidates: [], logs: [] };
  fs.writeFileSync(path.join(root, 'jobs.json'), JSON.stringify([job]));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ inbox_folder: inbox, library_folder: library, library_template: '%Book Title%', ffmpeg_path: ffmpeg, ffprobe_path: ffprobe }));
  const port = 54000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.resolve('dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, PORT: String(port), NODE_ENV: 'production' }, stdio: 'pipe', windowsHide: true });
  let logs = ''; server.stdout?.on('data', chunk => logs += chunk); server.stderr?.on('data', chunk => logs += chunk);
  const request = async (route: string, body?: unknown, status = 200) => {
    const response = await fetch(base + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json(); assert.equal(response.status, status, `${route}: ${JSON.stringify(data)}\n${logs}`); return data;
  };
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) { try { if (!(await request('/api/library/scan-status')).scanning) { ready = true; break; } } catch { /* Startup. */ } await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.ok(ready, logs);
    const sourcePlayback = await request('/api/jobs/archive-book/playback');
    await request('/api/jobs/archive-book/listening', { mediaSignature: sourcePlayback.manifest.signature,
      segmentId: 'p1', segmentOffsetSeconds: 0.75, positionSeconds: 0.75, completed: false });
    await request('/api/jobs/archive-book/build-m4b', { outputFormats: ['m4b'], zipOriginals: true, cue: true });
    let saved = await request('/api/jobs/archive-book');
    assert.equal(saved.outputM4b.playbackSourceSignature, sourcePlayback.manifest.signature);
    const finishedPlayback = await request('/api/jobs/archive-book/playback');
    assert.equal(finishedPlayback.manifest.kind, 'finalized');
    assert.equal(finishedPlayback.resume.positionSeconds, 0.75, 'An untrimmed export preserves the listening position after archiving its sources');
    assert.equal(saved.originalsArchiveError, undefined, JSON.stringify(saved.logs));
    assert.ok(saved.originalsArchive);
    assert.equal(path.dirname(saved.originalsArchive.path), path.dirname(saved.outputM4b.fullPath));
    assert.equal(path.basename(saved.originalsArchive.path), 'Originals.zip');
    assert.equal(path.basename(path.dirname(saved.outputM4b.fullPath)), metadata.title);
    await validateOriginalsZip(saved.originalsArchive.path, saved.originalsArchive.files);
    assert.equal(fs.existsSync(original), false);
    assert.equal((await request('/api/jobs/archive-book/export-progress')).running, false);
    assert.equal((await request('/api/library/refresh', {})).books.find((b: any) => b.id === job.id).sourceMissing, false);
    await request('/api/jobs/archive-book/move-to-library', { mode: 'move' }, 409);
    { const checked=await request('/api/jobs/archive-book/validate', {}); assert.equal(checked.validation.status, 'PASS', JSON.stringify(checked.finalCheck?.items.filter((item:any)=>item.status==='failed'))); }
    saved = await request('/api/jobs/archive-book'); assert.equal(saved.canMoveToLibrary, true);
    const destination = path.join(library, metadata.title);
    const exportIdentity = (await fingerprint([saved.outputM4b.fullPath], {}));
    const exportedMetadata = fs.readFileSync(path.join(destination, 'exmetadata.json'));
    const unrelated = path.join(destination, 'other-book.txt'); fs.writeFileSync(unrelated, 'Do not adopt this file');
    assert.equal((await request('/api/jobs/archive-book/move-to-library')).conflict, true);
    await request('/api/jobs/archive-book/move-to-library', { mode: 'move' }, 409);
    assert.equal(fs.readFileSync(unrelated, 'utf8'), 'Do not adopt this file');
    assert.equal(await fingerprint([saved.outputM4b.fullPath], {}), exportIdentity);
    fs.unlinkSync(unrelated);
    assert.equal((await request('/api/jobs/archive-book/move-to-library')).conflict, false);
    const result = await request('/api/jobs/archive-book/move-to-library', { mode: 'move' });
    assert.equal(result.job.outputM4b.fullPath, path.join(destination, metadata.title + '.m4b'));
    assert.equal(result.job.originalsArchive.path, path.join(destination, 'Originals.zip'));
    assert.equal(fs.existsSync(path.join(destination, 'Finalized')), false);
    assert.equal(fs.existsSync(path.join(destination, 'metadata.json')), true);
    assert.deepEqual(fs.readFileSync(path.join(destination, 'exmetadata.json')), exportedMetadata, 'adoption preserves the published metadata');
    assert.equal(await fingerprint([result.job.outputM4b.fullPath], {}), exportIdentity, 'adoption preserves the published audio');
    assert.equal(result.job.source.kind, 'managed');
    assert.equal(result.job.canMoveToLibrary, false);
    assert.deepEqual(result.job.metadataDraft, job.metadataDraft);
    assert.equal((await request('/api/jobs/archive-book/playback')).resume.positionSeconds, 0.75);
    await validateOriginalsZip(result.job.originalsArchive.path, result.job.originalsArchive.files);
    let books = (await request('/api/library/refresh', {})).books;
    assert.equal(books.length, 1); assert.equal(books[0].sourceMissing, false);
    { const checked=await request('/api/jobs/archive-book/validate', {}); assert.equal(checked.validation.status, 'PASS', JSON.stringify(checked.finalCheck?.items.filter((item:any)=>item.status==='failed'))); }
    const renamed = path.join(library, 'Renamed Book'); fs.renameSync(destination, renamed);
    books = (await request('/api/library/refresh', {})).books;
    assert.equal(books.length, 1); assert.equal(books[0].id, job.id); assert.equal(books[0].sourceMissing, false);
    saved = await request('/api/jobs/archive-book'); assert.equal(saved.originalsArchive.path, path.join(renamed, 'Originals.zip'));
    // Library Manager can transfer an unfinished source and defaults are handled in the shared dialog.
    for (const mode of ['copy', 'move']) {
      const title = 'Unchecked ' + mode, folder = path.join(inbox, title); fs.mkdirSync(folder);
      fs.copyFileSync(saved.outputM4b.fullPath, path.join(folder, 'source.m4b'));
      fs.writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify({ ...metadata, title }));
      books = (await request('/api/library/refresh', {})).books;
      const next = books.find((b: any) => b.name === title); assert.ok(next);
      await request(`/api/jobs/${next.id}/move-to-library`, { mode }, 409);
      const moved = await request(`/api/library/${next.id}/send-to-library`, { mode });
      assert.equal(fs.existsSync(path.join(folder, 'source.m4b')), mode === 'copy');
      assert.equal(fs.existsSync(path.join(moved.path, 'source.m4b')), true);
      assert.notEqual(moved.job.processingStatus, 'complete');
    }
  } finally {
    if (server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
