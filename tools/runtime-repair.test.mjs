import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

for (const cancel of [false, true]) test(`packaged requirements ${cancel ? 'cancel waits for active step' : 'repair verifies missing component'}`, { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), 'repair-test-'));
  const placeholder = relative => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'test placeholder'); };
  const suffix = process.platform === 'win32' ? '.exe' : '';
  for (const tool of ['python', 'ffmpeg', 'ffprobe', 'yt-dlp']) placeholder(`system/${tool}${suffix}`);
  placeholder(process.platform === 'win32' ? 'runtime/venv/Scripts/python.exe' : 'runtime/venv/bin/python');
  placeholder('runtime/venv/pyvenv.cfg'); placeholder('inputs/preserve.txt');
  const entry = path.resolve(process.env.TEST_PACKAGE_ROOT || '.', 'dist/server.cjs');
  const port = 41000 + Math.floor(Math.random() * 900), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--require', path.resolve('tools/fixtures/runtime-requirements.cjs'), entry], { env: { ...process.env, APP_ROOT: root, PORT: String(port), NODE_ENV: 'production', PATH: path.join(root, 'system'), SWISSMOUSE_RUNTIME_MODE: 'hybrid', SWISSMOUSE_TEST_REPAIR: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = ''; server.stdout.on('data', data => logs += data); server.stderr.on('data', data => logs += data);
  const request = async (route, body, expected = 200) => {
    const response = await fetch(base + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data)); return data;
  };
  try {
    for (let i = 0; i < 100 && !logs.includes('server running'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(logs, /server running/);
    assert.notEqual((await request('/api/requirements/status')).components.find(item => item.id === 'ctranslate2').status, 'ready');
    await request('/api/requirements/install-repair', { selectedIds: ['ctranslate2'] });
    for (let i = 0; i < 100 && !logs.includes('"pip","install","ctranslate2"'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(logs.includes('"pip","install","ctranslate2"'), logs);
    if (cancel) {
      await request('/api/requirements/cancel', {});
      assert.equal((await request('/api/requirements/install-progress')).isActive, true);
      await request('/api/jobs', { name: 'Cannot run during cancellation' }, 409);
    }
    let progress;
    for (let i = 0; i < 150; i++) { progress = await request('/api/requirements/install-progress'); if (!progress.isActive) break; await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.equal(progress.isActive, false, logs); assert.equal(progress.phase, cancel ? 'cancelled' : 'completed', JSON.stringify(progress));
    assert.equal((await request('/api/requirements/status?refresh=true')).components.find(item => item.id === 'ctranslate2').status, 'ready');
    await request('/api/jobs', { name: 'After repair' }, 201);
    assert.equal(fs.readFileSync(path.join(root, 'inputs/preserve.txt'), 'utf8'), 'test placeholder');
  } finally {
    if (server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
    assert.ok(root.startsWith(process.cwd() + path.sep)); fs.rmSync(root, { recursive: true, force: true });
  }
});
