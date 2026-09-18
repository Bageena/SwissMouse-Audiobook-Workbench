import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const root = resolve(process.argv[2]);
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
  console.log('Release smoke check passed: webpage and jobs API respond.');
} finally {
  child.kill();
}
