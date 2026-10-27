import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import type { AudiobookJob } from '../src/types';
import type { PlaybackManifest } from '../src/playback/types';
import { createBookmark } from '../src/playback/timeline';

test('quick player API persists listening separately, streams associated media, and follows stable book identity', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-quick-player-'));
  const inbox = path.join(root, 'Inbox'), library = path.join(root, 'Library'), source = path.join(root, 'Referenced Book');
  for (const folder of [inbox, library, source, path.join(root, 'Other Book'), path.join(root, 'Finished Book')]) fs.mkdirSync(folder);
  const tool = (name: string) => process.env['TEST_' + name.toUpperCase()] || path.resolve('runtime/bin', name + (process.platform === 'win32' ? '.exe' : ''));
  const ffmpeg = tool('ffmpeg'), ffprobe = tool('ffprobe');
  const wav = (file: string, duration: number) => execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=duration=${duration}`, '-c:a', 'pcm_s16le', file], { windowsHide: true });
  const first = path.join(source, '03-middle.wav'), second = path.join(source, '01-start.wav');
  wav(first, 2.5); wav(second, 3.75); wav(path.join(source, 'unrelated.wav'), 1);
  const otherPath = path.join(root, 'Other Book', 'other.wav'); wav(otherPath, 1.25);
  const metadata = { title: 'Listening Book', author: 'Writer', narrator: 'Reader', genres: [], language: 'eng', abridged: false, explicit: false };
  const job: AudiobookJob = { id: 'listen', name: metadata.title, metadata, metadataDraft: { ...metadata, description: 'Unfinished book details' },
    createdAt: '2026-10-12T00:00:00.000Z', status: 'draft', source: { kind: 'external', mode: 'folder', path: source }, sourceFolderPath: source,
    sourceMembership: 'confirmed', sourceOrderManual: true, parts: [first, second].map((file, index) => ({
      id: 'part-' + index, name: path.basename(file), sourceRelativePath: path.basename(file), sizeBytes: fs.statSync(file).size,
      durationSeconds: index === 0 ? 2.5 : 3.75, bitrate: 705, order: index + 1,
    })), totalDurationSeconds: 6.25, totalSizeBytes: fs.statSync(first).size + fs.statSync(second).size, chapters: [], candidates: [], logs: [] };
  const other: AudiobookJob = { ...structuredClone(job), id: 'other', name: 'Other Book', metadata: { ...metadata, title: 'Other Book' }, metadataDraft: undefined,
    source: { kind: 'external', mode: 'file', path: otherPath }, sourceFolderPath: path.dirname(otherPath),
    parts: [{ ...job.parts[0], id: 'other-part', name: 'other.wav', sourceRelativePath: 'other.wav', durationSeconds: 1.25, sizeBytes: fs.statSync(otherPath).size }],
    totalDurationSeconds: 1.25, totalSizeBytes: fs.statSync(otherPath).size };
  const finishedM4b = path.join(root, 'Finished Book', 'finished.m4b'), finishedMp3 = path.join(root, 'Finished Book', 'finished.mp3');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', first, '-c:a', 'aac', finishedM4b], { windowsHide: true });
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', first, '-c:a', 'libmp3lame', finishedMp3], { windowsHide: true });
  const finished: AudiobookJob = { ...structuredClone(other), id: 'finished', name: 'Finished Book', metadata: { ...metadata, title: 'Finished Book' }, status: 'built',
    source: { kind: 'external', mode: 'file', path: path.join(root, 'Finished Book', 'archived-source.wav') }, sourceFolderPath: path.join(root, 'Finished Book'),
    parts: [{ ...job.parts[0], id: 'archived-part', name: 'archived-source.wav', sourceRelativePath: 'archived-source.wav', durationSeconds: 2.5 }], totalDurationSeconds: 2.5,
    exports: [{ format: 'mp3', status: 'success', progress: 100, fullPath: finishedMp3 }, { format: 'm4b', status: 'success', progress: 100, fullPath: finishedM4b }] };
  const jobsPath = path.join(root, 'jobs.json');
  fs.writeFileSync(jobsPath, JSON.stringify([job, other, finished]));
  const sidecarPath = path.join(source, 'metadata.json');
  const externalMetadata = JSON.stringify({ ...metadata, rating: 1, personalRating: 2 });
  fs.writeFileSync(sidecarPath, externalMetadata);
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ inbox_folder: inbox, library_folder: library, library_template: '%Book Title%', ffmpeg_path: ffmpeg, ffprobe_path: ffprobe }));
  const port = 56000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  let server: ChildProcess | undefined, logs = '';
  const request = async (route: string, body?: unknown, expected = 200) => {
    const response = await fetch(base + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { throw new Error(`${route}: expected JSON, received ${text.slice(0, 500)}\n${logs}`); }
    assert.equal(response.status, expected, `${route}: ${JSON.stringify(data)}\n${logs}`);
    return data;
  };
  const rejected = async (route: string, body?: unknown) => {
    const response = await fetch(base + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text();
    assert.ok(response.status >= 400 && response.status < 500, `${route}: should reject, got ${response.status}: ${text}`);
    return text;
  };
  const stop = async () => {
    if (server && server.exitCode === null) {
      const exited = new Promise(resolve => server!.once('exit', resolve));
      server.kill(); await exited;
    }
  };
  const start = async () => {
    server = spawn(process.execPath, [path.resolve('dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, NODE_ENV: 'production', PORT: String(port) }, stdio: 'pipe', windowsHide: true });
    server.stdout?.on('data', data => { logs += data; }); server.stderr?.on('data', data => { logs += data; });
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      try { if (!(await request('/api/library/scan-status')).scanning) { ready = true; break; } } catch { /* Server boot. */ }
      if (server.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Isolated quick player server started.\n' + logs);
  };
  const payload = (manifest: PlaybackManifest, position: number, sequence: number, completed = false) => {
    const value = createBookmark(manifest, position, completed);
    return { mediaSignature: value.mediaSignature, positionSeconds: value.positionSeconds, segmentId: value.segmentId,
      segmentOffsetSeconds: value.segmentOffsetSeconds, completed: value.completed, clientSessionId: 'api-test-session', clientSequence: sequence };
  };
  let current: PlaybackManifest;
  try {
    await start();
    await t.test('only explicit ordered members are exposed, with a complete cumulative duration', async () => {
      const result = await request('/api/jobs/listen/playback');
      current = result.manifest;
      assert.equal(current.bookId, job.id); assert.equal(current.kind, 'source');
      assert.deepEqual(current.segments.map(item => item.id), ['part-0', 'part-1']);
      assert.deepEqual(current.segments.map(item => item.startSeconds), [0, 2.5]);
      assert.equal(current.totalDurationSeconds, 6.25);
      assert.equal(JSON.stringify(current).includes(source), false, 'Absolute paths remain on the server');
      assert.equal(JSON.stringify(current).includes('unrelated.wav'), false);
      assert.equal(result.resume.positionSeconds, 0);
    });

    await t.test('range streaming returns exact source bytes and rejects foreign or stale segment requests', async () => {
      const streamed = await fetch(base + current.segments[0].url, { headers: { Range: 'bytes=12-75' } });
      assert.equal(streamed.status, 206);
      assert.match(streamed.headers.get('content-range') || '', /^bytes 12-75\//);
      assert.deepEqual(Buffer.from(await streamed.arrayBuffer()), fs.readFileSync(first).subarray(12, 76));
      await rejected(current.segments[0].url.replace('signature=' + current.signature, 'signature=stale'));
      await rejected(`/api/jobs/listen/playback/segments/other-part?signature=${current.signature}`);
      await rejected(`/api/jobs/other/playback/segments/part-0?signature=${current.signature}`);
    });

    await t.test('finished M4B plays when originals are archived, without concatenating alternate export formats', async () => {
      const result = await request('/api/jobs/finished/playback');
      assert.equal(result.manifest.kind, 'finalized');
      assert.equal(result.manifest.segments.length, 1);
      assert.equal(result.manifest.segments[0].id, 'finalized-m4b');
      assert.ok(Math.abs(result.manifest.totalDurationSeconds - 2.5) < 0.05);
      const streamed = await fetch(base + result.manifest.segments[0].url, { headers: { Range: 'bytes=0-63' } });
      assert.equal(streamed.status, 206);
      assert.match(streamed.headers.get('content-type') || '', /^audio\/mp4/);
      assert.deepEqual(Buffer.from(await streamed.arrayBuffer()), fs.readFileSync(finishedM4b).subarray(0, 64));
    });

    await t.test('ratings are validated, keep unrated distinct from zero, and never overwrite book metadata', async () => {
      for (const rating of [-1, 11, 1.5, '8', {}, true]) await rejected('/api/jobs/listen/personal-rating', { rating });
      assert.equal((await request('/api/jobs/listen/personal-rating', { rating: 0 })).rating, 0);
      assert.equal((await request('/api/jobs/listen')).personalRating, 0);
      assert.equal((await request('/api/jobs/listen/personal-rating', { rating: null })).rating, null);
      assert.equal((await request('/api/jobs/listen')).personalRating, null);
      assert.equal((await request('/api/jobs/listen/personal-rating', { rating: 9 })).rating, 9);
      const saved = await request('/api/jobs/listen');
      assert.deepEqual(saved.metadata, metadata);
      assert.deepEqual(saved.metadataDraft, job.metadataDraft);
      assert.equal(fs.readFileSync(sidecarPath, 'utf8'), externalMetadata);
      await request('/api/library/refresh', {});
      assert.equal((await request('/api/jobs/listen')).personalRating, 9);
    });

    await t.test('checkpoints preserve exact multipart position without rewriting jobs or accepting stale updates', async () => {
      const version = () => { const db = new DatabaseSync(jobsPath+'.sqlite', {readOnly:true}); try { return db.prepare("SELECT value FROM project_meta WHERE key='version'").get()!.value; } finally { db.close(); } };
      const jobsBefore = version();
      const checkpoint = payload(current, 4.125, 3);
      const result = await request('/api/jobs/listen/listening', checkpoint);
      assert.equal(result.bookmark.positionSeconds, 4.125);
      assert.equal(result.bookmark.segmentId, 'part-1');
      assert.equal(result.bookmark.segmentOffsetSeconds, 1.625);
      await request('/api/jobs/listen/listening', payload(current, 1, 2));
      assert.equal((await request('/api/jobs/listen/listening')).bookmark.positionSeconds, 4.125);
      await rejected('/api/jobs/listen/listening', { ...checkpoint, mediaSignature: 'stale', clientSequence: 4 });
      await rejected('/api/jobs/other/listening', checkpoint);
      await rejected('/api/jobs/listen/listening', { ...checkpoint, segmentId: 'other-part', clientSequence: 4 });
      assert.equal(version(), jobsBefore, 'Listening checkpoints do not update any project-state row');
      assert.equal((await request('/api/jobs/other/listening')).bookmark ?? null, null);
    });

    await t.test('restart recovers the checkpoint and rating under the same stable book identity', async () => {
      await stop(); await start();
      const result = await request('/api/jobs/listen/playback');
      assert.equal(result.bookmark.positionSeconds, 4.125);
      assert.equal(result.resume.positionSeconds, 4.125);
      assert.equal(result.resume.segmentIndex, 1);
      assert.equal(result.resume.offsetSeconds, 1.625);
      assert.equal(result.manifest.signature, current.signature);
      assert.equal((await request('/api/jobs/listen')).personalRating, 9);
    });

    await t.test('reordering remaps the exact unchanged segment and saves late Stop checkpoints against their original timeline', async () => {
      await request('/api/jobs/listen/source-files', { action: 'reorder', files: ['01-start.wav', '03-middle.wav'] });
      const result = await request('/api/jobs/listen/playback');
      assert.notEqual(result.manifest.signature, current.signature);
      assert.equal(result.resume.positionSeconds, 1.625);
      assert.equal(result.resume.segmentIndex, 0);
      assert.match(result.resume.notice, /unchanged audio file/);
      const lateStop = await request('/api/jobs/listen/listening', payload(current, 4.125, 4));
      assert.equal(lateStop.bookmark.mediaSignature, current.signature, 'A late checkpoint is never relabeled as the changed timeline');
      assert.equal((await request('/api/jobs/listen/playback')).resume.positionSeconds, 1.625);
      current = result.manifest;
      await request('/api/jobs/listen/listening', payload(current, 1.625, 5));
    });

    await t.test('supported source moves and verified Library copies preserve bookmarks and ratings', async () => {
      await request('/api/jobs/listen/source-files', { action: 'create-folder', parent: '', name: 'Moved' });
      await request('/api/jobs/listen/source-files', { action: 'move', files: ['01-start.wav'], destination: 'Moved' });
      const moved = await request('/api/jobs/listen/playback');
      assert.equal(moved.manifest.signature, current.signature);
      assert.equal(moved.resume.positionSeconds, 1.625);
      const copied = await request('/api/library/listen/send-to-library', { mode: 'copy' });
      assert.equal(copied.job.id, job.id);
      const transferred = await request('/api/jobs/listen/playback');
      assert.equal(transferred.manifest.signature, current.signature);
      assert.equal(transferred.resume.positionSeconds, 1.625);
      assert.equal((await request('/api/jobs/listen')).personalRating, 9);
      assert.ok(fs.existsSync(path.join(source, 'Moved', '01-start.wav')));
      assert.ok(fs.existsSync(first));
      await request('/api/library/refresh', {});
      assert.equal((await request('/api/jobs/listen')).personalRating, 9);
      assert.equal((await request('/api/jobs/listen/playback')).resume.positionSeconds, 1.625);
    });

    await t.test('completion is persisted and a missing selected member prevents partial playback', async () => {
      await request('/api/jobs/listen/listening', payload(current, current.totalDurationSeconds, 6, true));
      const finished = await request('/api/jobs/listen/playback');
      assert.equal(finished.resume.completed, true);
      assert.equal(finished.resume.positionSeconds, current.totalDurationSeconds);
      const saved = await request('/api/jobs/listen');
      const missingPath = path.join(saved.sourceFolderPath, saved.parts[1].sourceRelativePath || saved.parts[1].name);
      assert.ok(path.resolve(missingPath).startsWith(path.resolve(root) + path.sep));
      fs.unlinkSync(missingPath);
      assert.match(await rejected('/api/jobs/listen/playback'), /missing|cannot play|unavailable/i);
    });
  } finally {
    await stop();
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
