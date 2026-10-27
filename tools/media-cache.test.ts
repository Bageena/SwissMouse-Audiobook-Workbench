import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MediaCache } from './media-cache';
test('probe cache deduplicates requests, bounds concurrency and invalidates changed files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'media-cache-'));
  try {
    const files = ['a', 'b', 'c'].map(name => path.join(root, name));
    await Promise.all(files.map(file => fs.writeFile(file, 'audio')));
    let calls = 0, active = 0, maximum = 0;
    const cache = new MediaCache(async (_tool, file) => {
      calls++; maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setTimeout(resolve, 10)); active--;
      return { text: await fs.readFile(file, 'utf8') };
    });
    await Promise.all([...files, ...files].map(file => cache.read('probe', file)));
    assert.equal(calls, 3); assert.equal(maximum, 2);
    const first = await cache.read('probe', files[0]); first.text = 'mutation';
    assert.equal((await cache.read('probe', files[0])).text, 'audio');
    await fs.writeFile(files[0], 'changed');
    assert.equal((await cache.read('probe', files[0])).text, 'changed'); assert.equal(calls, 4);
    await fs.unlink(files[0]); await assert.rejects(cache.read('probe', files[0]), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
