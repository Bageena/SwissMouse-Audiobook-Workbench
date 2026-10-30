import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createTestFixture, stopTestServer } from './test-fixtures.mjs';

test('opt-in read bridge preserves catalog IDs, revisions, legacy data and database layouts', { timeout: 60000 }, async t => {
  const fixture = createTestFixture('.cache/information-preview-'); const root = fixture.root;
  let child: ChildProcess | undefined;
  t.after(async () => { if (child) await stopTestServer(child); fixture.cleanup(); });
  const jobs = Array.from({ length: 120 }, (_, i) => ({ id: `existing-${i}`, name: `Book ${i}`, status: 'draft', createdAt: '2026-10-01T00:00:00Z', parts: [], chapters: [], candidates: [], logs: [], personalRating: 0,
    metadata: { title: `Book ${i}`, author: 'Doe, Jane', authors: ['Doe, Jane'], narrator: 'Reader', genres: ['Fantasy'], language: 'en', abridged: false, explicit: false,
      collections: [{ id: 'existing-shelf', name: 'Shelf' }], additionalSeries: [{ id: 'existing-custom-series', name: 'Series', sequence: 'Omnibus' }] },
    metadataDraft: { title: 'Private draft sentinel' }, transcriptSegments: [{ id: 0, start: 0, end: 1, text: 'Private transcript sentinel' }],
  }));
  const original = JSON.stringify(jobs); fs.writeFileSync(path.join(root, 'jobs.json'), original);
  fs.mkdirSync(path.join(root, 'dist')); fs.writeFileSync(path.join(root, 'dist/index.html'), '<html>Fixture shell</html>');
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = (listener.address() as net.AddressInfo).port; await new Promise<void>(done => listener.close(() => done()));
  const base = `http://127.0.0.1:${port}`; let output = '';
  async function start(enabled: boolean) {
    output = ''; child = spawn(process.execPath, [path.resolve('dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, PORT: String(port), NODE_ENV: 'production', SWISSMOUSE_RUNTIME_MODE: 'managed', SWISSMOUSE_OPEN_BROWSER: '0', SWISSMOUSE_INFORMATION_PREVIEW: enabled ? '1' : '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', data => { output += data; }); child.stderr!.on('data', data => { output += data; });
    for (let i = 0; i < 250; i++) {
      if (child.exitCode !== null) assert.fail(output);
      try { const response = await fetch(base + '/api/catalog/status'); if (response.ok && !(await response.json()).indexing) return; } catch { /* startup */ }
      await new Promise(done => setTimeout(done, 40));
    }
    assert.fail('Fixture startup did not finish: ' + output);
  }
  const json = async (route: string, body?: unknown) => {
    const response = await fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.ok, true, `${route}: ${await response.clone().text()}\n${output}`); return response.json();
  };
  function schemas() {
    return ['jobs.json.sqlite', 'catalog.sqlite', 'catalog.sqlite.user.sqlite'].map(file => {
      const db = new DatabaseSync(path.join(root, file), { readOnly: true });
      try { return { file, version: db.prepare('PRAGMA user_version').get(), tables: db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all() }; } finally { db.close(); }
    });
  }
  await start(false);
  assert.match((await fetch(base + '/api/information-preview/definitions')).headers.get('content-type') || '', /text\/html/);
  const before = await json('/api/catalog/library/query', { limit: 5 }); const layout = schemas();
  await stopTestServer(child!); child = undefined; await start(true);
  const defs = await json('/api/information-preview/definitions');
  assert.equal(defs.readOnly, true); assert.equal(defs.persistence, 'session-only'); assert.ok(defs.definitions.some((d: any) => d.id === 'audiobooks.genre'));
  const result = await json('/api/information-preview/library?limit=5');
  assert.equal(result.total, 120); assert.deepEqual(result.items.map((item: any) => item.descriptor.id), before.items.map((item: any) => item.resourceId));
  assert.deepEqual(result.capabilities, { taxonomyQueries: false, autocompleteQueries: false, writes: false });
  assert.deepEqual(result.items[0].fields['audiobooks.authors'], ['Doe, Jane']); assert.equal(result.items[0].fields['audiobooks.personal-rating'], 0);
  assert.equal(result.items[0].memberships[1].legacyId, 'existing-custom-series');
  assert.equal(result.items[0].descriptor.revisionScope, 'catalog-snapshot'); assert.equal(result.items[0].presentation.readOnly, true);
  assert.doesNotMatch(JSON.stringify(result), /Private draft sentinel|Private transcript sentinel|sourceFolderPath/);
  const oldNext = await json('/api/catalog/library/query', { limit: 5, cursor: result.nextCursor });
  const newNext = await json('/api/information-preview/library?limit=5&cursor=' + encodeURIComponent(result.nextCursor));
  assert.deepEqual(newNext.items.map((item: any) => item.descriptor.id), oldNext.items.map((item: any) => item.resourceId));
  const late = await json('/api/information-preview/library?query=Book%20119'); assert.equal(late.items[0].descriptor.title, 'Book 119');
  for (const query of ['limit=501', 'limit=0', 'query=' + 'a'.repeat(257), 'field=unknown', 'sort=unknown', 'query=a&query=b']) {
    assert.equal((await fetch(base + '/api/information-preview/library?' + query)).status, 400, query);
  }
  assert.equal((await fetch(base + '/api/information-preview/library', { method: 'POST' })).status, 404);
  assert.equal((await json('/api/catalog/contract')).version, 1);
  assert.deepEqual(schemas(), layout, 'enabling the bridge introduces no schema change');
  assert.equal(fs.readFileSync(path.join(root, 'jobs.json'), 'utf8'), original);
});
