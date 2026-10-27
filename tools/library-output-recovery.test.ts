import { readProjectState } from './project-store-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { inspectAsync } from './audio-engine';
import { recoverRelocatedOutput } from './library-output-recovery';
import { scanRoot, stamp, type DiskBook } from './library-filesystem';
import type { AudiobookJob } from '../src/types';

test('refresh reconnects an export moved out of Finalized even after its new scan signature was saved', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-output-refresh-'));
  const library = path.join(root, 'Library'), inbox = path.join(root, 'Inbox');
  const folder = path.join(library, "Stephen King", "'Salem's Lot [Richard Nazarewich]");
  fs.mkdirSync(folder, { recursive: true }); fs.mkdirSync(inbox);
  const ffmpeg = process.env.TEST_FFMPEG || path.resolve('runtime/bin/ffmpeg.exe');
  const ffprobe = process.env.TEST_FFPROBE || path.resolve('runtime/bin/ffprobe.exe');
  const filename = "'Salem's Lot [Richard Nazarewich].m4b", current = path.join(folder, filename), old = path.join(folder, 'Finalized', filename);
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:a', 'aac', current], { windowsHide: true });
  const media = await inspectAsync(ffprobe, current), bytes = fs.readFileSync(current);
  const metadata = { title: "'Salem's Lot", author: 'Stephen King', narrator: 'Richard Nazarewich', genres: [], language: 'eng', abridged: false, explicit: false };
  fs.writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify(metadata));
  fs.writeFileSync(current + '.cue', 'chapter sidecar');
  const [disk] = await scanRoot(library, new Set(['m4b']));
  const job = { id: 'salem', name: metadata.title, metadata, metadataDraft: { ...metadata, description: 'Keep my draft' },
    createdAt: new Date().toISOString(), status: 'validated', processingStatus: 'complete', sourceMembership: 'confirmed',
    source: { kind: 'managed', mode: 'folder', path: folder }, sourceFolderPath: folder,
    parts: [{ id: 'original', name: 'original.mp3', sizeBytes: 123, durationSeconds: 1, bitrate: 64, order: 1 }],
    totalDurationSeconds: 1, totalSizeBytes: 123, chapters: [{ id: 'c1', title: 'Manual chapter', start: '00:00:00.000' }], candidates: [], logs: [],
    outputM4b: { filename, fullPath: old, sizeBytes: bytes.length, duration: media.durationSeconds, codec: media.codec, chaptersCount: 0, format: 'm4b' },
    exports: [{ filename, fullPath: old, format: 'm4b', status: 'success', progress: 100 }], exportedFiles: { m4b: old },
    associatedFiles: [{ path: old + '.cue', kind: 'chapters' }],
    libraryScan: { root: library, type: 'library', path: disk.path, signature: disk.signature, identity: disk.identity } };
  fs.writeFileSync(path.join(root, 'jobs.json'), JSON.stringify([job]));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ inbox_folder: inbox, library_folder: library, ffmpeg_path: ffmpeg, ffprobe_path: ffprobe }));
  const port = 53000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  let server: ReturnType<typeof spawn> | undefined;
  const request = async (route: string, body?: object) => {
    const response = await fetch(base + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  const start = async () => {
    server = spawn(process.execPath, [path.resolve('dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, PORT: String(port), NODE_ENV: 'production' }, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 150; i++) {
      try { if (!(await request('/api/library/scan-status')).scanning) return; } catch { /* Startup. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Fixture server did not start');
  };
  const stop = async () => { if (server?.exitCode === null) { const exit = new Promise(resolve => server!.once('exit', resolve)); server.kill(); await exit; } };
  try {
    await start();
    const books = await request('/api/library');
    assert.equal(books.length, 1); assert.equal(books[0].id, job.id);
    assert.equal(books[0].sourceMissing, false); assert.equal(books[0].originalSourceMissing, true);
    assert.equal(books[0].rootType, 'library'); assert.deepEqual(books[0].formats, ['M4B']);
    const saved = await request('/api/jobs/salem');
    assert.equal(saved.outputM4b.fullPath, current); assert.equal(saved.exports[0].fullPath, current);
    assert.equal(saved.exportedFiles.m4b, current); assert.equal(saved.associatedFiles[0].path, current + '.cue');
    assert.deepEqual(saved.parts, job.parts); assert.deepEqual(saved.chapters, job.chapters); assert.deepEqual(saved.metadataDraft, job.metadataDraft);
    assert.equal(saved.processingStatus, 'incomplete');
    const snapshot = JSON.stringify(readProjectState(root));
    await request('/api/library/refresh', {});
    assert.equal(JSON.stringify(readProjectState(root)), snapshot);
    await stop(); await start();
    assert.equal((await request('/api/library'))[0].sourceMissing, false);
    assert.deepEqual(fs.readFileSync(current), bytes);
    const renamed = path.join(folder, 'Renamed audiobook.m4b');
    fs.renameSync(current, renamed); fs.renameSync(current + '.cue', renamed + '.cue');
    const refreshed = (await request('/api/library/refresh', {})).books;
    assert.equal(refreshed.length, 1); assert.equal(refreshed[0].id, job.id);
    const renamedJob = await request('/api/jobs/salem');
    assert.equal(renamedJob.outputM4b.fullPath, renamed);
    assert.equal(renamedJob.exports[0].filename, path.basename(renamed));
    assert.equal(renamedJob.associatedFiles[0].path, renamed + '.cue');
    assert.deepEqual(renamedJob.parts, job.parts);
  } finally { await stop(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('relocation rejects ambiguous, claimed or mismatched audio and leaves project state untouched', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-output-guards-'));
  try {
    fs.writeFileSync(path.join(root, 'book.m4b'), 'audio');
    const job = { id: 'book', parts: [], logs: [], outputM4b: { fullPath: path.join(root, 'Finalized', 'book.m4b'), filename: 'book.m4b', sizeBytes: 5, duration: 10, chaptersCount: 0, codec: 'aac' } } as AudiobookJob;
    const original = structuredClone(job);
    const disk = { folder: root, files: [await stamp(path.join(root, 'book.m4b'))] } as DiskBook;
    assert.equal(await recoverRelocatedOutput(job, disk, async () => ({ durationSeconds: 15, codec: 'aac', chapters: [] })), undefined);
    assert.equal(await recoverRelocatedOutput(job, disk, async () => { throw new Error('must not probe claimed file'); }, () => true), undefined);
    const ambiguous = { ...disk, files: [...disk.files, { ...disk.files[0], name: 'Other/book.m4b' }] };
    assert.equal(await recoverRelocatedOutput(job, ambiguous, async () => { throw new Error('must not probe ambiguous file'); }), undefined);
    assert.deepEqual(job, original);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
