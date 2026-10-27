import { readProjectState } from './project-store-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import type { AudiobookJob } from '../src/types';

type Protection = 'draft' | 'confirmed';

async function fixture(protection?: Protection) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-regrouping-'));
  const inbox = path.join(root, 'Inbox'), library = path.join(root, 'Library'), folder = path.join(inbox, 'Voyage');
  fs.mkdirSync(library, { recursive: true });
  const sourceBytes = new Map<string, string>();
  const original: AudiobookJob[] = [1, 2, 3].map(disc => {
    const title = `Voyage (Disc ${String(disc).padStart(2, '0')})`;
    const sourceFolderPath = path.join(folder, title);
    fs.mkdirSync(sourceFolderPath, { recursive: true });
    const parts = [1, 2].map(track => {
      const name = `${String(track).padStart(2, '0')}.mp3`, bytes = `disc ${disc}, track ${track}: unchanged source`;
      fs.writeFileSync(path.join(sourceFolderPath, name), bytes);
      sourceBytes.set(path.join(sourceFolderPath, name), bytes);
      return { id: `disc-${disc}-track-${track}`, name, sizeBytes: Buffer.byteLength(bytes), durationSeconds: 0, bitrate: 0, order: track };
    });
    const metadata = { title, author: 'Fixture Writer', narrator: '', genres: [], language: 'eng', abridged: false, explicit: false };
    return {
      id: `legacy-disc-${disc}`, name: title, createdAt: '2026-10-01T00:00:00.000Z', status: 'draft',
      sourceMembership: 'automatic', source: { kind: 'inbox', mode: 'folder', path: sourceFolderPath }, sourceFolderPath,
      parts, totalSizeBytes: parts.reduce((sum, part) => sum + part.sizeBytes, 0), totalDurationSeconds: 0,
      metadata, chapters: [], candidates: [], logs: [],
      libraryScan: { type: 'inbox', root: inbox, path: sourceFolderPath, signature: `legacy-${disc}`, identity: `legacy-${disc}`, detectedMetadata: { ...metadata }, coverScanVersion: 1 },
    };
  });
  if (protection === 'draft') original[0].metadataDraft = { ...original[0].metadata!, title: 'Unfinished personal title', description: 'Keep this draft verbatim' };
  if (protection === 'confirmed') original[0].sourceMembership = 'confirmed';
  fs.writeFileSync(path.join(root, 'jobs.json'), JSON.stringify(original));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ inbox_folder: inbox, library_folder: library }));

  const port = 53000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  let server: ReturnType<typeof spawn> | undefined;
  let diagnostics = '';
  const request = async (route: string, body?: object) => {
    const response = await fetch(base + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, 200, `${route}: ${JSON.stringify(result)}`);
    return result;
  };
  const start = async () => {
    server = spawn(process.execPath, [path.resolve('dist/server.cjs')], {
      env: { ...process.env, APP_ROOT: root, NODE_ENV: 'production', PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
    });
    server.stderr?.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4000); });
    for (let attempt = 0; attempt < 200; attempt++) {
      try { const state = await request('/api/library/scan-status'); if (!state.scanning && state.progress?.phase === 'Finished') return; }
      catch { /* Wait for the isolated server and initial scan. */ }
      if (server.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Isolated regrouping server did not finish starting. ${diagnostics}`);
  };
  const stop = async () => {
    if (server && server.exitCode === null) {
      const exited = new Promise(resolve => server!.once('exit', resolve)); server.kill(); await exited;
    }
  };
  const stored = (): AudiobookJob[] => readProjectState(root);
  const assertSources = () => {
    for (const [file, bytes] of sourceBytes) assert.equal(fs.readFileSync(file, 'utf8'), bytes, `source stayed unchanged: ${file}`);
  };
  const dispose = async () => {
    await stop();
    const resolved = path.resolve(root), expectedParent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved), expectedParent);
    assert.ok(path.basename(resolved).startsWith('swissmouse-regrouping-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  };
  return { folder, original, sourceBytes, request, start, stop, stored, assertSources, dispose };
}

test('refresh joins untouched automatic named-disc projects with complete membership and stays stable across restart', async () => {
  const context = await fixture();
  try {
    await context.start();
    const books = await context.request('/api/library');
    assert.equal(books.length, 1, 'the complete book replaces all three fragment cards');
    assert.equal(books[0].sourceMissing, false);
    const snapshot = context.stored();
    const parent = snapshot.find(job => job.id === books[0].id)!;
    assert.equal(parent.source?.path, context.folder);
    assert.equal(parent.parts.length, 6, 'all discs and tracks belong to the discovered parent');
    assert.deepEqual(parent.parts.map(part => path.resolve(parent.sourceFolderPath!, part.name)).sort(), [...context.sourceBytes.keys()].sort());
    for (const old of context.original) {
      const retained = snapshot.find(job => job.id === old.id)!;
      assert.equal(retained.libraryScan?.superseded, true, 'old fragment stays recoverable');
      assert.deepEqual(retained.parts, old.parts);
    }
    await context.request('/api/library/refresh', {});
    assert.deepEqual(context.stored(), snapshot, 'refresh is idempotent');
    await context.stop(); await context.start();
    assert.deepEqual((await context.request('/api/library')).map((book: { id: string }) => book.id), [parent.id]);
    assert.deepEqual(context.stored(), snapshot, 'restart does not recreate the fragments or parent');
    context.assertSources();
  } finally { await context.dispose(); }
});

for (const protection of ['draft', 'confirmed'] as const) test(`regrouping preserves a ${protection} child and keeps every other disc visible`, async () => {
  const context = await fixture(protection);
  try {
    await context.start();
    const books = await context.request('/api/library');
    assert.ok(books.length >= 2, 'saved work remains separate from the other discs');
    assert.ok(books.every((book: { sourceMissing?: boolean }) => !book.sourceMissing), 'existing discs are not marked missing');
    const snapshot = context.stored();
    const protectedJob = snapshot.find(job => job.id === context.original[0].id)!;
    assert.ok(books.some((book: { id: string }) => book.id === protectedJob.id), 'the saved project ID remains visible');
    assert.deepEqual(protectedJob.parts, context.original[0].parts, 'saved membership is unchanged');
    assert.equal(protectedJob.sourceMembership, context.original[0].sourceMembership);
    assert.deepEqual(protectedJob.metadataDraft, context.original[0].metadataDraft, 'draft is unchanged');
    assert.notEqual(protectedJob.libraryScan?.superseded, true);
    const represented = books.flatMap((book: { id: string }) => {
      const job = snapshot.find(item => item.id === book.id)!;
      return job.parts.map(part => path.resolve(job.sourceFolderPath!, part.name));
    });
    assert.deepEqual(represented.sort(), [...context.sourceBytes.keys()].sort(), 'each source is represented exactly once, including every unedited disc');
    await context.request('/api/library/refresh', {});
    assert.deepEqual(context.stored(), snapshot, 'refresh is idempotent');
    await context.stop(); await context.start();
    assert.deepEqual(context.stored(), snapshot, 'restart preserves saved work and remaining discovery');
    context.assertSources();
  } finally { await context.dispose(); }
});
