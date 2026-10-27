import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { AudiobookJob } from '../src/types';
import type { PlaybackManifest } from '../src/playback/types';
import { createBookmark, locatePosition, resolveBookmark } from '../src/playback/timeline';
import { buildBookPlaybackManifest, playbackFileSignature } from './book-playback';
import { MediaCache } from './media-cache';

const makeJob = (names = ['third.wav', 'first.wav']): AudiobookJob => ({
  id: 'listening-book', name: 'Listening Book', createdAt: '2026-10-12', status: 'draft',
  parts: names.map((name, index) => ({ id: 'part-' + index, name, order: index + 1, sizeBytes: 1, durationSeconds: 9999, bitrate: 64 })),
  totalDurationSeconds: 9999, totalSizeBytes: 2, chapters: [], candidates: [], logs: [],
});
const manifest = (): PlaybackManifest => ({ bookId: 'book', signature: 'original', kind: 'source', totalDurationSeconds: 18000,
  segments: Array.from({ length: 5 }, (_, index) => ({ id: 'part-' + index, signature: 'stamp-' + index, title: String(index), url: '/audio/' + index, durationSeconds: 3600, startSeconds: index * 3600 })) });
const fixture = async (names = ['third.wav', 'first.wav']) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'swissmouse-playback-'));
  const sourcePaths = names.map(name => path.join(folder, name));
  await Promise.all(sourcePaths.map(file => fs.writeFile(file, 'fixture')));
  return { folder, sourcePaths, job: makeJob(names), dispose: () => fs.rm(folder, { recursive: true, force: true }) };
};

test('cumulative timeline locates a half hour into the third file and exact boundaries', () => {
  assert.deepEqual(locatePosition(manifest(), 9000), { positionSeconds: 9000, segmentIndex: 2, offsetSeconds: 1800 });
  assert.deepEqual(locatePosition(manifest(), 7200), { positionSeconds: 7200, segmentIndex: 2, offsetSeconds: 0 });
  assert.deepEqual(locatePosition(manifest(), Infinity), { positionSeconds: 0, segmentIndex: 0, offsetSeconds: 0 });
  assert.deepEqual(locatePosition(manifest(), 19000), { positionSeconds: 18000, segmentIndex: 4, offsetSeconds: 3600 });
});

test('bookmark serialization preserves precision, book identity, and completion', () => {
  const media = manifest(), bookmark = createBookmark(media, 9000.123456, false, '2026-10-12T00:00:00.000Z');
  assert.equal(bookmark.segmentId, 'part-2');
  assert.equal(bookmark.segmentOffsetSeconds, bookmark.positionSeconds - 7200);
  assert.equal(resolveBookmark(media, JSON.parse(JSON.stringify(bookmark))).positionSeconds, 9000.123456);
  assert.equal(resolveBookmark({ ...media, bookId: 'other' }, bookmark).positionSeconds, 0);
  const complete = resolveBookmark(media, createBookmark(media, 1, true));
  assert.equal(complete.completed, true);
  assert.equal(complete.positionSeconds, 18000);
});

test('corrupted bookmark data falls back with a readable notice', () => {
  const media = manifest(), bookmark = createBookmark(media, 9000);
  const corrupted = { ...bookmark, segments: [null] };
  const resolved = resolveBookmark(media, corrupted as unknown as typeof bookmark);
  assert.equal(resolved.positionSeconds, 0);
  assert.match(resolved.notice!, /could not be read/);
});

test('reordering retains an unchanged file anchor, while changed audio safely resets', () => {
  const original = manifest(), bookmark = createBookmark(original, 9000);
  const reordered = { ...original, signature: 'reordered', segments: [original.segments[2], original.segments[0], original.segments[1], ...original.segments.slice(3)].map((segment, i) => ({ ...segment, startSeconds: i * 3600 })) };
  assert.equal(resolveBookmark(reordered, bookmark).positionSeconds, 1800);
  assert.match(resolveBookmark(reordered, bookmark).notice!, /unchanged audio file/);
  reordered.segments[0] = { ...reordered.segments[0], signature: 'replaced' };
  assert.equal(resolveBookmark(reordered, bookmark).positionSeconds, 0);
  assert.match(resolveBookmark(reordered, bookmark).notice!, /could not be matched safely/);
  assert.equal(resolveBookmark(reordered, createBookmark(original, 18000, true)).completed, false);
});

test('source-to-finalized restore requires proven provenance and the retained timeline', () => {
  const source = manifest(), bookmark = createBookmark(source, 9000);
  const finalized: PlaybackManifest = { ...source, kind: 'finalized', signature: 'encoded',
    segments: [{ ...source.segments[0], id: 'finalized-m4b', signature: 'new', durationSeconds: 18000 }] };
  assert.equal(resolveBookmark(finalized, bookmark).positionSeconds, 0, 'Equal duration alone is not proof');
  finalized.sourceTimelineSignature = source.signature;
  assert.equal(resolveBookmark(finalized, bookmark).positionSeconds, 9000);
  finalized.totalDurationSeconds = 17990;
  finalized.segments[0].durationSeconds = 17990;
  assert.equal(resolveBookmark(finalized, bookmark).positionSeconds, 0, 'Never guess across trimmed audio');
});

test('manifest uses only ordered membership, measured durations, embedded chapters, and cached probes', async () => {
  const data = await fixture();
  try {
    await fs.writeFile(path.join(data.folder, 'unrelated.wav'), 'not selected');
    let reads = 0;
    const cached = new MediaCache(async (_probe, file) => {
      reads++;
      assert.ok(data.sourcePaths.includes(file));
      return { durationSeconds: file === data.sourcePaths[0] ? 20 : 10, chapters: [{ start: '00:00:00.000', title: path.basename(file) }] };
    });
    const options = { sourcePaths: data.sourcePaths, ffprobe: 'unused', inspect: (tool: string, file: string) => cached.read(tool, file) };
    const result = await buildBookPlaybackManifest(data.job, options);
    assert.equal(result.manifest.totalDurationSeconds, 30);
    assert.deepEqual(result.manifest.segments.map(item => item.id), ['part-0', 'part-1']);
    assert.deepEqual(result.manifest.segments.map(item => item.startSeconds), [0, 20]);
    assert.deepEqual(result.manifest.chapters, [{ startSeconds: 0, title: 'third.wav' }, { startSeconds: 20, title: 'first.wav' }]);
    assert.deepEqual(result.files, data.sourcePaths);
    assert.equal(JSON.stringify(result.manifest).includes(data.folder), false);
    assert.match(result.manifest.segments[0].url, /\/api\/jobs\/listening-book\/playback\/segments\/part-0\?signature=/);
    await buildBookPlaybackManifest(data.job, options);
    assert.equal(reads, 2, 'Unchanged files reuse metadata without probing again');
  } finally { await data.dispose(); }
});

test('reviewed source chapters populate the unified timeline and invalid placeholders are excluded', async () => {
  const data = await fixture();
  try {
    data.job.chapters = [
      { id: 'second', title: 'Second chapter', start: '00:00:15.000' },
      { id: 'first', title: 'First chapter', start: '00:00:00.000' },
      { id: 'missing', title: 'Missing', start: '', isMissing: true },
      { id: 'outside', title: 'Outside', start: '00:02:00.000' },
    ];
    const options = { sourcePaths: data.sourcePaths, ffprobe: 'unused', inspect: async () => ({ durationSeconds: 20 }) };
    const result = await buildBookPlaybackManifest(data.job, options);
    assert.equal(result.manifest.totalDurationSeconds, 40);
    assert.deepEqual(result.manifest.chapters, [{ title: 'First chapter', startSeconds: 0 }, { title: 'Second chapter', startSeconds: 15 }]);
    data.job.sourceFilesChanged = true;
    assert.equal((await buildBookPlaybackManifest(data.job, options)).manifest.chapters, undefined);
  } finally { await data.dispose(); }
});

test('legacy array layouts still follow the saved processing order without mixing file identities', async () => {
  const data = await fixture();
  try {
    data.job.parts[0].order = 2; data.job.parts[1].order = 1;
    const result = await buildBookPlaybackManifest(data.job, { sourcePaths: data.sourcePaths, ffprobe: 'unused', inspect: async () => ({ durationSeconds: 10 }) });
    assert.deepEqual(result.manifest.segments.map(s => s.id), ['part-1', 'part-0']);
    assert.deepEqual(result.files, [data.sourcePaths[1], data.sourcePaths[0]]);
    assert.deepEqual(data.job.parts.map(p => p.id), ['part-0', 'part-1'], 'Playing never mutates the project');
  } finally { await data.dispose(); }
});

test('renames and verified copies preserve signatures, changed timestamps invalidate them', async () => {
  const data = await fixture(['original.wav']);
  try {
    const options = { sourcePaths: data.sourcePaths, ffprobe: 'unused', inspect: async () => ({ durationSeconds: 10 }) };
    const before = await buildBookPlaybackManifest(data.job, options);
    const renamed = path.join(data.folder, 'renamed.wav');
    await fs.rename(data.sourcePaths[0], renamed);
    const afterRename = await buildBookPlaybackManifest(data.job, { ...options, sourcePaths: [renamed] });
    assert.equal(afterRename.manifest.signature, before.manifest.signature);
    const copied = path.join(data.folder, 'copied.wav'), info = await fs.stat(renamed);
    await fs.copyFile(renamed, copied);
    await fs.utimes(copied, new Date(info.mtimeMs), new Date(info.mtimeMs));
    const afterCopy = await buildBookPlaybackManifest(data.job, { ...options, sourcePaths: [copied] });
    assert.equal(afterCopy.manifest.signature, before.manifest.signature);
    assert.equal(resolveBookmark(afterCopy.manifest, createBookmark(before.manifest, 4.5)).positionSeconds, 4.5);
    await fs.utimes(copied, new Date(), new Date(info.mtimeMs + 5000));
    const changed = await buildBookPlaybackManifest(data.job, { ...options, sourcePaths: [copied] });
    assert.notEqual(changed.manifest.signature, before.manifest.signature);
    assert.notEqual(playbackFileSignature('part-0', 10, 1000, 10), playbackFileSignature('part-0', 10, 1000, 11));
  } finally { await data.dispose(); }
});

test('missing members and unreadable durations fail the complete source manifest', async () => {
  const data = await fixture();
  try {
    await fs.unlink(data.sourcePaths[1]);
    const options = { sourcePaths: data.sourcePaths, ffprobe: 'unused', inspect: async () => ({ durationSeconds: 10 }) };
    await assert.rejects(buildBookPlaybackManifest(data.job, options), /Cannot play first.wav/);
    await assert.rejects(buildBookPlaybackManifest(data.job, { ...options, sourcePaths: options.sourcePaths.slice(0, 1) }), /source selection changed/);
    await fs.writeFile(data.sourcePaths[1], 'restored');
    await assert.rejects(buildBookPlaybackManifest(data.job, { ...options, inspect: async () => ({ durationSeconds: NaN }) }), /No readable audio duration/);
  } finally { await data.dispose(); }
});

test('successful finalized formats are alternatives; stale or failed exports use sources', async () => {
  const data = await fixture();
  try {
    const m4b = path.join(data.folder, 'finished.m4b'), mp3 = path.join(data.folder, 'finished.mp3');
    await fs.writeFile(m4b, 'finished'); await fs.writeFile(mp3, 'finished');
    data.job.exports = [{ format: 'mp3', status: 'success', progress: 100, fullPath: mp3 }, { format: 'm4b', status: 'success', progress: 100, fullPath: m4b, playbackSourceSignature: 'recorded-source-timeline' }];
    const options = { sourcePaths: data.sourcePaths, ffprobe: 'unused', inspect: async () => ({ durationSeconds: 10 }) };
    const finished = await buildBookPlaybackManifest(data.job, options);
    assert.equal(finished.manifest.kind, 'finalized');
    assert.equal(finished.manifest.sourceTimelineSignature, 'recorded-source-timeline');
    assert.deepEqual(finished.files, [m4b]);
    assert.equal(finished.manifest.totalDurationSeconds, 10, 'Two formats do not double book duration');
    data.job.staleSteps = ['export'];
    assert.equal((await buildBookPlaybackManifest(data.job, options)).manifest.kind, 'source');
    data.job.staleSteps = [];
    data.job.sourceFilesChanged = true;
    assert.equal((await buildBookPlaybackManifest(data.job, options)).manifest.kind, 'source');
    data.job.sourceFilesChanged = false;
    data.job.exports.forEach(item => { item.status = 'failed'; });
    assert.equal((await buildBookPlaybackManifest(data.job, options)).manifest.kind, 'source');
    data.job.exports[0].status = 'success';
    assert.deepEqual((await buildBookPlaybackManifest(data.job, options)).files, [mp3]);
    await fs.unlink(mp3);
    assert.equal((await buildBookPlaybackManifest(data.job, options)).manifest.kind, 'source');
  } finally { await data.dispose(); }
});

test('explicit multi-file finalized output uses one ordered timeline and survives archived sources', async () => {
  const data = await fixture();
  try {
    const options = { sourcePaths: [], ffprobe: 'unused', inspect: async () => ({ durationSeconds: 10 }),
      finalizedAlternatives: [{ id: 'multi-volume', sourceTimelineSignature: 'proven-source', files: data.sourcePaths.map((file, i) => ({ id: 'final-' + i, path: file })) }] };
    const finished = await buildBookPlaybackManifest(data.job, options);
    assert.deepEqual(finished.files, data.sourcePaths);
    assert.equal(finished.manifest.totalDurationSeconds, 20);
    assert.equal(finished.manifest.sourceTimelineSignature, 'proven-source');
    assert.deepEqual(finished.manifest.segments.map(item => item.startSeconds), [0, 10]);
  } finally { await data.dispose(); }
});

test('real WAV and M4B headers provide source and finalized duration without audio decoding', async () => {
  const data = await fixture(['source.wav']);
  try {
    const findTool = (name: string) => process.env['TEST_' + name.toUpperCase()] || path.resolve('runtime/bin', name + (process.platform === 'win32' ? '.exe' : ''));
    const ffmpeg = findTool('ffmpeg'), ffprobe = findTool('ffprobe');
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=duration=1.25', '-c:a', 'pcm_s16le', data.sourcePaths[0]], { windowsHide: true });
    const source = await buildBookPlaybackManifest(data.job, { sourcePaths: data.sourcePaths, ffprobe });
    assert.ok(Math.abs(source.manifest.totalDurationSeconds - 1.25) < 0.01);
    const output = path.join(data.folder, 'final.m4b');
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', data.sourcePaths[0], '-c:a', 'aac', output], { windowsHide: true });
    data.job.exports = [{ format: 'm4b', status: 'success', progress: 100, fullPath: output }];
    const finalized = await buildBookPlaybackManifest(data.job, { sourcePaths: data.sourcePaths, ffprobe });
    assert.equal(finalized.manifest.kind, 'finalized');
    assert.ok(Math.abs(finalized.manifest.totalDurationSeconds - 1.25) < 0.05);
    assert.equal(finalized.manifest.segments.length, 1);
  } finally { await data.dispose(); }
});
