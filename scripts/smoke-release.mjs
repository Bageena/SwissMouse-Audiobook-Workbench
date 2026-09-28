import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const root = resolve(process.argv[2]);
// Check the assembled artifact, not just the checkout or build configuration.
for (const file of ['LICENSE', 'THIRD_PARTY.md', 'server.ts', 'src/main.tsx', 'vite.config.ts', 'scripts/third-party-notices.ts']) {
  assert.ok((await readFile(resolve(root, file))).length, `Missing release license/source: ${file}`);
}
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
assert.equal(manifest.license, 'AGPL-3.0-or-later');
const notices = await readFile(resolve(root, 'dist/THIRD_PARTY_NOTICES.txt'), 'utf8');
assert.match(notices, /Permission is hereby granted|Permission to use/);
// CI installs node_modules for this smoke check; processing runtimes still
// must not have arrived in the assembled release.
for (const name of await readdir(root)) {
  assert.ok(!['runtime', 'models', '.cache'].includes(name), `Unexpected release directory: ${name}`);
}
const port = 39000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ['dist/server.cjs'], {
  cwd: root,
  env: { ...process.env, APP_ROOT: root, NODE_ENV: 'production', PORT: String(port) },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
let startupError;
child.stdout.on('data', data => logs += data);
child.stderr.on('data', data => logs += data);
child.on('error', error => startupError = error);
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (startupError) throw startupError;
    assert.equal(child.exitCode, null, logs);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/jobs`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && Array.isArray(await response.json())) { ready = true; break; }
    } catch {}
    await setTimeout(250);
  }
  assert.ok(ready, 'Release API failed to start\n' + logs);
  const page = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<html/i);
  const servedNotices = await fetch(`http://127.0.0.1:${port}/THIRD_PARTY_NOTICES.txt`, { signal: AbortSignal.timeout(3000) });
  assert.equal(servedNotices.status, 200);
  assert.equal(await servedNotices.text(), notices);
  console.log('Release smoke check passed: license/source files, served third-party notices, webpage and jobs API.');
} finally {
  child.kill();
}
