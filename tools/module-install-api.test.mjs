import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createTestFixture, stopTestServer } from './test-fixtures.mjs';
import { buildAudiobookModule } from '../scripts/build-audiobook-module.mjs';

// Private test copy only. Copy complete installed runtime packages with their notices,
// so the assembled host cannot accidentally resolve dependencies from the checkout.
function runtimeDependencies(destination) {
  const checkoutModules = path.resolve('node_modules');
  const copied = new Set();
  function copy(name, require) {
    const manifestFile = (require.resolve.paths(name) || []).map(base => path.join(base, name, 'package.json')).find(file => fs.existsSync(file));
    if (!manifestFile) throw Error(`Cannot locate runtime package ${name}`);
    const location = path.dirname(manifestFile);
    if (copied.has(location)) return; copied.add(location);
    const relative = path.relative(checkoutModules, location);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
    fs.cpSync(location, path.join(destination, 'node_modules', relative), { recursive: true, filter: file => path.basename(file) !== 'node_modules' || file === location });
    const manifest = JSON.parse(fs.readFileSync(path.join(location, 'package.json')));
    const ownRequire = createRequire(path.join(location, 'package.json'));
    for (const dependency of Object.keys(manifest.dependencies || {})) copy(dependency, ownRequire);
  }
  const require = createRequire(path.resolve('package.json'));
  for (const name of Object.keys(JSON.parse(fs.readFileSync('package.json')).dependencies)) copy(name, require);
}

test('assembled host installs a prebuilt package over HTTP and preserves existing data through restarts/removal/reinstall', { timeout: 90000 }, async t => {
  const fixture = createTestFixture('.cache/module-assembled-');
  let child;
  t.after(async () => { if (child) await stopTestServer(child); fixture.cleanup(); });
  fs.cpSync('dist', path.join(fixture.root, 'dist'), { recursive: true });
  runtimeDependencies(fixture.root);
  const built = await buildAudiobookModule({ output: path.join(fixture.root, 'artifacts') });
  fs.writeFileSync(path.join(fixture.root, 'module-trust.json'), JSON.stringify({ schemaVersion: 1, packages: [built.catalogEntry] }));
  fs.writeFileSync(path.join(fixture.root, 'package.json'), JSON.stringify({ type: 'module' }));
  const saved = { id: 'batch1-existing-book', name: 'Existing saved book', author: 'Original author', status: 'draft', parts: [], chapters: [], candidates: [], logs: [], createdAt: '2026-01-01T00:00:00Z',
    metadata: { title: 'Existing saved book', author: 'Original author', narrators: ['Original narrator'], genres: [], language: 'eng', abridged: false, explicit: false } };
  saved.personalRating = 7;
  saved.chapters = [{ id: 'saved-chapter', title: 'Reviewed chapter', start: '00:00:00.000', end: '00:00:01.000', titleManuallyEdited: true }];
  saved.transcriptSegments = [{ start: 0, end: 1, text: 'A saved transcript.' }];
  const sourceSentinel = path.join(fixture.root, 'source-sentinel.txt'); fs.writeFileSync(sourceSentinel, 'Original source content');
  fs.writeFileSync(path.join(fixture.root, 'jobs.json'), JSON.stringify([saved]));
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let output = '';
  const boot = async () => {
    output = '';
    child = spawn(process.execPath, [path.join(fixture.root, 'dist/server.cjs')], { cwd: fixture.root, env: { ...process.env, NODE_PATH: '', APP_ROOT: fixture.root, PORT: String(port), NODE_ENV: 'production', SWISSMOUSE_RUNTIME_MODE: 'managed', SWISSMOUSE_OPEN_BROWSER: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => output += bytes);
    const deadline = Date.now() + 25000;
    while (!output.includes('SwissMouse server running')) {
      if (child.exitCode !== null || Date.now() > deadline) throw Error(`Host startup failed: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  const json = async (url, options) => {
    const response = await fetch(base + url, options); const data = await response.json();
    assert.ok(response.ok, `${url}: ${JSON.stringify(data)}\n${output}`); return data;
  };
  const restart = async () => { await stopTestServer(child); child = undefined; await boot(); };
  const install = async () => {
    const data = new FormData(); data.append('package', new Blob([fs.readFileSync(built.artifact)]), 'audiobooks.smmodule'); data.append('confirmed', 'true');
    return json('/api/modules/install', { method: 'POST', body: data });
  };
  await boot();
  const entryHash = createHash('sha256').update(fs.readFileSync(path.join(fixture.root, 'dist/server.cjs'))).digest('hex');
  assert.deepEqual((await json('/api/modules')).modules, []);
  assert.equal((await fetch(base + '/api/modules/audiobooks/disable', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: JSON.stringify({ confirmed: true }) })).status, 403);
  assert.equal((await install()).modules[0].restartRequired, true);
  await restart();
  const module = (await json('/api/modules')).modules[0]; assert.equal(module.active, true);
  const summaryUrl = '/api/modules/audiobooks/read/audiobooks.summary?resourceId=batch1-existing-book';
  const summary = await json(summaryUrl); assert.equal(summary.title, saved.name); assert.equal(summary.metadata.narrators[0], 'Original narrator');
  const browserResponse = await fetch(base + module.browser); assert.equal(browserResponse.status, 200); assert.match(await browserResponse.text(), /function activate/);
  assert.equal((await fetch(base + module.styles[0])).status, 200);
  assert.match(await (await fetch(base + module.assets['book.svg'])).text(), /<svg/);
  assert.equal((await fetch(base + `/api/modules/audiobooks/assets/${built.sha256}/backend.mjs`)).status, 404);
  assert.equal((await fetch(base + '/api/modules/audiobooks/read/audiobooks.delete')).status, 404);
  const beforeRemoval = await json('/api/jobs/batch1-existing-book');
  const mutation = action => json(`/api/modules/audiobooks/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
  await mutation('disable'); assert.equal((await fetch(base + summaryUrl)).status, 404);
  await restart(); assert.equal((await json('/api/modules')).modules[0].enabled, false);
  await mutation('remove'); await restart(); assert.deepEqual((await json('/api/modules')).modules, []);
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await json('/api/jobs/batch1-existing-book')).id, beforeRemoval.id);
  await install(); await restart(); assert.equal((await json(summaryUrl)).id, beforeRemoval.id);
  const restored = await json('/api/jobs/batch1-existing-book');
  assert.deepEqual(restored.chapters, beforeRemoval.chapters); assert.deepEqual(restored.transcriptSegments, beforeRemoval.transcriptSegments); assert.equal(restored.personalRating, 7);
  assert.equal(fs.readFileSync(sourceSentinel, 'utf8'), 'Original source content');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(fixture.root, 'dist/server.cjs'))).digest('hex'), entryHash, 'Core was not rebuilt');
  assert.ok(!fs.existsSync(path.join(fixture.root, 'src')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.root, 'jobs.json'))), [saved], 'Original legacy input preserved');
});
