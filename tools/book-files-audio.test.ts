import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { registerBookFilesRoutes } from './book-files-routes';
import { inspectAsync } from './audio-engine';
import { metadataFromTags } from './audiobook-metadata';
import type { AudiobookJob, WorkbenchConfig } from '../src/types';

test('inline metadata writes read back across audio formats, preserve encoded packets, and roll back persistence failures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'book-files-audio-'));
  const tool = (name: string) => process.env['TEST_' + name.toUpperCase()] || path.resolve('runtime/bin', name + (process.platform === 'win32' ? '.exe' : ''));
  const ffmpeg = tool('ffmpeg'), ffprobe = tool('ffprobe');
  const formats = ['mp3', 'm4a', 'm4b', 'flac', 'ogg', 'opus'];
  for (const format of formats) execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', '-metadata', 'title=Original', '-metadata', 'artist=Author', '-metadata', 'composer=Narrator', '-metadata', 'date=1999', path.join(root, `part.${format}`)], { windowsHide: true });
  const job = { id: 'audio', name: 'Book', sourceFolderPath: root, metadata: metadataFromTags({}, 'Book'), metadataDraft: metadataFromTags({}, 'Manual Draft'), parts: [], logs: [], chapters: [], candidates: [], status: 'draft' } as AudiobookJob;
  let failPersist = false; const app = express(); app.use(express.json());
  const routes = registerBookFilesRoutes(app, { jobs: () => [job], config: () => ({} as WorkbenchConfig), appRoot: root, root: () => root, excluded: () => [], busy: () => false, lock: () => {},
    persist: () => { if (failPersist) throw new Error('Injected persistence failure'); }, invalidate: () => {}, totals: () => {}, remove: () => {},
    read: file => inspectAsync(ffprobe, file), ffmpeg: () => ffmpeg, ffprobe: () => ffprobe, log: () => {}, select: async () => ({}) });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/jobs/audio/book-files`;
  const request = async (suffix: string, body: unknown, status = 200) => { const response = await fetch(base + suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data; };
  const hash = (file: string) => execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-c:a', 'copy', '-f', 'streamhash', '-hash', 'SHA256', '-'], { encoding: 'utf8', windowsHide: true });
  try {
    for (const format of formats) {
      const file = path.join(root, `part.${format}`), before = hash(file);
      for (const [field, value] of [['title', 'Changed Title'], ['author', 'Changed Author'], ['narrator', 'Changed Narrator'], ['year', '2003']]) await request('/edit', { directory: root, file, field, value });
      const details = (await request('/details', { directory: root, files: [file] }))[file];
      assert.deepEqual([details.title, details.author, details.narrator, details.year], ['Changed Title', 'Changed Author', 'Changed Narrator', '2003'], format);
      assert.equal(hash(file), before, `${format}: encoded packets unchanged`);
      await request('/undo', {}); assert.equal((await request('/details', { directory: root, files: [file] }))[file].year, '1999');
      await request('/edit', { directory: root, file, field: 'title', value: '' });
      assert.equal((await request('/details', { directory: root, files: [file] }))[file].title || '', '', `${format}: empty edit clears the actual tag`);
      await request('/undo', {});
      const snapshot = await fs.readFile(file); failPersist = true;
      await request('/edit', { directory: root, file, field: 'title', value: 'Must Roll Back' }, 400); failPersist = false;
      assert.deepEqual(await fs.readFile(file), snapshot, `${format}: failed project commit restores exact original bytes`);
    }
    assert.equal(job.metadataDraft!.title, 'Manual Draft');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await routes.close(); await fs.rm(root, { recursive: true, force: true }); }
});
