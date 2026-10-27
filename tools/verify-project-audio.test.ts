import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { AudiobookJob } from '../src/types';
import { verifyProjectAudio } from './verify-project-audio';
import { inspectAsync } from './audio-engine';
import { checkSourceAudio } from './audio-integrity';
import express from 'express';
import { registerBookFilesRoutes } from './book-files-routes';
import type { WorkbenchConfig } from '../src/types';

function wav(channels = 1, rate = 8000) {
  const length = rate * channels * 2;
  const bytes = Buffer.alloc(44 + length);
  bytes.write('RIFF'); bytes.writeUInt32LE(36 + length, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(length, 40);
  return bytes;
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const base = path.resolve('.tmp');
async function fixture() {
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'verify-audio-'));
  await fs.writeFile(path.join(root, 'one.wav'), wav());
  await fs.writeFile(path.join(root, 'two.wav'), wav());
  await fs.writeFile(path.join(root, 'unselected.wav'), wav(2));
  const job = { id: 'verification', status: 'draft', metadata: { title: 'Keep my title' }, metadataDraft: { title: 'Keep my draft' },
    chapters: [{ id: 'manual', title: 'Keep my chapter', start: '00:00:00.000' }], sourceMembership: 'confirmed',
    manuallyExcludedSourceFiles: ['unselected.wav'], sourceOrderManual: true,
    parts: ['two.wav', 'one.wav'].map((name, i) => ({ id: `stable-${i}`, name, sourceRelativePath: name, order: i + 1, durationSeconds: 0, sizeBytes: 0, bitrate: 0 })),
    chapterGroups: [{ id: 'group', name: 'My chapter', partIds: ['stable-0', 'stable-1'] }],
    discoveredFiles: [{ relativePath: 'two.wav', fileName: 'two.wav', folderName: 'Root', tags: { title: 'Keep tags' }, chapterGroup: 'My chapter' }],
  } as unknown as AudiobookJob;
  return { root, job };
}
const ffprobe = process.env.TEST_FFPROBE || 'ffprobe';

test('real audio verification restores signatures without changing membership, edits, order or source bytes', async () => {
  const { root, job } = await fixture();
  try {
    const before = structuredClone(job);
    const hashes = await Promise.all(job.parts.map(async part => digest(await fs.readFile(path.join(root, part.name)))));
    const checked: string[] = [];
    const result = await verifyProjectAudio(job, root, async file => { checked.push(path.basename(file)); return inspectAsync(ffprobe, file); }, [], { checkAudio: file => checkSourceAudio(process.env.TEST_FFMPEG || 'ffmpeg', ffprobe, file) });
    assert.deepEqual(checked, ['two.wav', 'one.wav']);
    assert.equal(result.checked, 2); assert.equal(result.compatible, true); assert.equal(result.changed, false);
    assert.ok(job.discoveredFiles!.every(file => file.streamSignature && file.isProbed));
    assert.ok(job.discoveredFiles!.every(file => file.audioVerification?.decoding === 'passed' && file.audioVerification.timestamps === 'passed'));
    for (const key of ['metadata', 'metadataDraft', 'chapters', 'chapterGroups', 'sourceMembership', 'manuallyExcludedSourceFiles', 'sourceOrderManual'] as const)
      assert.deepEqual((job as any)[key], (before as any)[key]);
    assert.deepEqual(job.parts.map(part => [part.id, part.name, part.order]), before.parts.map(part => [part.id, part.name, part.order]));
    assert.equal(job.discoveredFiles![0].tags?.title, 'Keep tags');
    assert.equal(job.discoveredFiles![0].chapterGroup, 'My chapter');
    assert.deepEqual(await Promise.all(job.parts.map(async part => digest(await fs.readFile(path.join(root, part.name))))), hashes);
    await fs.writeFile(path.join(root, 'one.wav'), wav(2));
    const mismatched = await verifyProjectAudio(job, root, file => inspectAsync(ffprobe, file));
    assert.equal(mismatched.compatible, false); assert.equal(mismatched.changed, true);
    assert.match(mismatched.reason, /differs/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('failed or unsafe inspection does not partially update project observations', async () => {
  const { root, job } = await fixture();
  try {
    const before = JSON.stringify(job);
    await assert.rejects(verifyProjectAudio(job, root, async file => {
      if (file.endsWith('one.wav')) throw new Error('Unreadable stream');
      return { streamSignature: 'valid', codec: 'pcm_s16le', durationSeconds: 1 };
    }), /one.wav: Unreadable stream/);
    assert.equal(JSON.stringify(job), before);
    job.parts[0].sourceRelativePath = '../outside.wav';
    await assert.rejects(verifyProjectAudio(job, root, async () => { throw new Error('Must not probe'); }), /outside its book folder/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a failed full check records the issue, checks remaining files, and a later clean check clears it', async () => {
  const { root, job } = await fixture();
  try {
    const checks: string[] = [];
    const result = await verifyProjectAudio(job, root, file => inspectAsync(ffprobe, file), [], { checkAudio: async file => {
      checks.push(path.basename(file));
      return { checkedAt: new Date().toISOString(), decoding: 'passed', timestamps: file.endsWith('two.wav') ? 'failed' : 'passed', issues: file.endsWith('two.wav') ? ['DTS moves backward.'] : [] };
    } });
    assert.deepEqual(checks, ['two.wav', 'one.wav']);
    assert.equal(result.compatible, false); assert.match(result.issues[0], /two.wav: DTS/);
    assert.equal(job.discoveredFiles![0].audioVerification?.timestamps, 'failed');
    const clean = await verifyProjectAudio(job, root, file => inspectAsync(ffprobe, file), [], { checkAudio: file => checkSourceAudio(process.env.TEST_FFMPEG || 'ffmpeg', ffprobe, file) });
    assert.equal(clean.compatible, true); assert.deepEqual(clean.issues, []);
    assert.equal(job.discoveredFiles![0].audioVerification?.timestamps, 'passed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('refresh endpoint uses a fresh probe, persists results, and blocks during other work', async () => {
  const { root, job } = await fixture();
  let busy = false, probes = 0, saves = 0, invalidations = 0;
  const locks: boolean[] = [];
  const app = express(); app.use(express.json());
  const routes = registerBookFilesRoutes(app, { jobs: () => [job], config: () => ({} as WorkbenchConfig), appRoot: root,
    root: () => root, excluded: () => [], busy: () => busy, busyReason: () => 'speech model downloads', lock: (_id, value) => { locks.push(value); },
    persist: () => { saves++; }, invalidate: () => { invalidations++; }, totals: () => {}, remove: () => {},
    read: async () => { throw new Error('Must bypass cached reads'); },
    probe: file => { probes++; return inspectAsync(ffprobe, file); }, ffmpeg: () => 'ffmpeg', ffprobe: () => ffprobe,
    log: () => {}, select: async () => ({}) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/jobs/${job.id}/book-files/verify-audio`;
  try {
    const response = await fetch(url, { method: 'POST' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.compatible, true); assert.equal(result.job.parts.length, 2);
    assert.equal(result.job.discoveredFiles[0].audioVerification.decoding, 'passed');
    assert.equal(result.job.discoveredFiles[0].audioVerification.timestamps, 'passed');
    assert.equal(probes, 2); assert.equal(saves, 1); assert.equal(invalidations, 0);
    assert.deepEqual(locks, [true, false]);
    busy = true;
    const blocked = await fetch(url, { method: 'POST' });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).error, 'Wait for speech model downloads to finish.');
    assert.equal(probes, 2);
    assert.deepEqual(locks, [true, false]);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await routes.close(); await fs.rm(root, { recursive: true, force: true }); }
});
