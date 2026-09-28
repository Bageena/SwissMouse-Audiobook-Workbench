import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

test('library summaries stay compact and bulk edits touch only selected fields', async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), 'library-test-'));
  const port = 41000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.resolve('dist/server.cjs')], { cwd: process.cwd(), env: { ...process.env, APP_ROOT: root, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
  const request = async (route: string, body?: unknown) => {
    const response = await fetch(base + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    assert.ok(response.ok, `${route}: ${JSON.stringify(data)}`);
    return data;
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { const response = await fetch(base + '/api/library'); if (response.ok) { ready = true; break; } } catch { /* Starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'isolated server started');
    const first = await request('/api/jobs', { name: 'First book', author: 'Douglas Adams', narrator: 'Reader A' });
    const second = await request('/api/jobs', { name: 'Second book', author: 'Other Author', narrator: 'Reader B' });
    const coverBytes = fs.readFileSync(path.resolve('src/assets/swissmouse-logo-concept.png'));
    const firstMetadata = { ...first.metadata, title: 'First book', author: 'Douglas Adams', narrator: 'Reader A', series: 'Guide', seriesSequence: '2', subtitle: 'Keep this', description: 'Original', cover: { source: 'local', url: `data:image/png;base64,${coverBytes.toString('base64')}` } };
    await request(`/api/jobs/${first.id}/metadata`, { metadata: firstMetadata });
    await request(`/api/jobs/${first.id}/metadata-draft`, { metadata: { ...firstMetadata, description: 'Unfinished draft text' } });
    const summary = await request('/api/library');
    assert.equal(summary.length, 2);
    assert.ok(JSON.stringify(summary).length < 10000, 'cover data is excluded from listing');
    assert.equal(summary.find((book: any) => book.id === first.id).metadata.cover, undefined);
    assert.match(summary.find((book: any) => book.id === first.id).coverUrl, /^\/api\/library\//);
    const thumbnail = await fetch(base + summary.find((book: any) => book.id === first.id).coverUrl);
    assert.equal(thumbnail.status, 200);
    assert.match(thumbnail.headers.get('content-type') || '', /^image\//);
    assert.ok((await thumbnail.arrayBuffer()).byteLength < coverBytes.length, 'cover sent at thumbnail size');
    const changed = await request('/api/library/metadata', { changes: [
      { id: first.id, fields: { author: 'Douglas A. Adams', genres: ['Science Fiction'] } },
      { id: second.id, fields: { author: 'Douglas A. Adams' } },
    ] });
    assert.equal(changed.books.length, 2);
    const saved = await request(`/api/jobs/${first.id}`);
    assert.equal(saved.metadata.author, 'Douglas A. Adams');
    assert.equal(saved.metadata.subtitle, 'Keep this');
    assert.equal(saved.metadata.description, 'Original');
    assert.equal(saved.metadata.seriesSequence, '2');
    assert.deepEqual(saved.metadata.genres, ['Science Fiction']);
    assert.equal(saved.metadataDraft.description, 'Unfinished draft text');
    assert.equal(saved.metadataDraft.author, 'Douglas A. Adams');
    const invalid = await fetch(base + '/api/library/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: [{ id: first.id, fields: { title: '' } }] }) });
    assert.equal(invalid.status, 400);
    assert.equal((await request(`/api/jobs/${first.id}`)).metadata.title, 'First book');
  } finally {
    server.kill();
    await new Promise(resolve => server.once('exit', resolve));
    assert.ok(root.startsWith(process.cwd() + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
