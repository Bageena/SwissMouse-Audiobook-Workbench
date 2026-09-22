import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildSync } from 'esbuild';

test('storage cleanup removes only SwissMouse-managed working files', { timeout: 60000 }, async () => {
  fs.mkdirSync(path.resolve('.cache'), { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.cache/cleanup-test-'));
  const entry = path.join(root, 'server.cjs');
  buildSync({ entryPoints: ['server.ts'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: entry });
  const port = 20000 + Math.floor(Math.random() * 10000);
  const server = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(port), APP_ROOT: root, NODE_ENV: 'production' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', data => output += data);
  server.stderr.on('data', data => output += data);
  const base = `http://localhost:${port}`;
  const request = async (route, options = {}) => {
    const response = await fetch(base + route, options);
    const data = await response.json();
    return { response, data };
  };
  const post = (route, body) => request(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const putFile = (relative, contents = 'test') => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    return file;
  };

  try {
    for (let attempt = 0; attempt < 100 && !output.includes('server running'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.match(output, /server running/);

    const created = await post('/api/jobs', { name: 'Cleanup Book', parts: [] });
    assert.equal(created.response.status, 201);
    const project = created.data;
    const activeInput = putFile(`inputs/${project.id}/source.mp3`);
    const activeWorking = putFile(`output/intermediates/${project.id}/master.wav`);
    const orphanInput = putFile('inputs/deleted-book/source.mp3');
    const orphanWorking = putFile('output/intermediates/deleted-book/master.wav');
    const abandonedUpload = putFile('inputs/abandoned-upload.tmp');
    const finishedExport = putFile('output/finished-book.m4b');
    const installedModel = putFile('models/keep/model.bin');

    const orphans = await post('/api/cleanup', { cleanupType: 'orphans' });
    assert.equal(orphans.response.status, 200);
    assert.equal(fs.existsSync(activeInput), true);
    assert.equal(fs.existsSync(activeWorking), true);
    assert.equal(fs.existsSync(orphanInput), false);
    assert.equal(fs.existsSync(orphanWorking), false);
    assert.equal(fs.existsSync(abandonedUpload), false);

    const cacheFile = putFile('.cache/stale.tmp');
    const cache = await post('/api/cleanup', { cleanupType: 'cache' });
    assert.equal(cache.response.status, 200);
    assert.equal(fs.existsSync(cacheFile), false);
    assert.equal(fs.existsSync(path.join(root, '.cache/work')), true);
    assert.equal(fs.existsSync(installedModel), true);
    assert.equal(fs.existsSync(finishedExport), true);

    const disposablePart = putFile(`output/intermediates/${project.id}/part-0.wav`);
    const disposableConcat = putFile(`output/intermediates/${project.id}/concat.txt`);
    const transcript = putFile(`output/intermediates/${project.id}/analysis.transcript.json`);
    const temporary = await post(`/api/jobs/${project.id}/purge`, { purgeType: 'temp' });
    assert.equal(temporary.response.status, 200);
    assert.equal(fs.existsSync(disposablePart), false);
    assert.equal(fs.existsSync(disposableConcat), false);
    assert.equal(fs.existsSync(transcript), true);
    assert.equal(fs.existsSync(activeWorking), true);

    const generated = await post(`/api/jobs/${project.id}/purge`, { purgeType: 'intermediate' });
    assert.equal(generated.response.status, 200);
    assert.equal(fs.existsSync(path.dirname(activeWorking)), false);
    assert.equal(fs.existsSync(activeInput), true);

    putFile(`output/intermediates/${project.id}/master.wav`);
    const deleted = await request(`/api/jobs/${project.id}`, { method: 'DELETE' });
    assert.equal(deleted.response.status, 200);
    assert.equal(fs.existsSync(path.dirname(activeInput)), false);
    assert.equal(fs.existsSync(path.join(root, `output/intermediates/${project.id}`)), false);
    assert.equal(fs.existsSync(finishedExport), true);
    assert.equal(fs.existsSync(installedModel), true);

    const second = (await post('/api/jobs', { name: 'Second Book', parts: [] })).data;
    const secondInput = putFile(`inputs/${second.id}/source.mp3`);
    const secondWorking = putFile(`output/intermediates/${second.id}/master.wav`);
    const badConfirmation = await post('/api/cleanup', { cleanupType: 'all-working', confirmation: 'yes' });
    assert.equal(badConfirmation.response.status, 400);
    assert.equal(fs.existsSync(secondInput), true);
    const allWorking = await post('/api/cleanup', { cleanupType: 'all-working', confirmation: 'CLEAR ALL WORKING FILES' });
    assert.equal(allWorking.response.status, 200);
    assert.equal(fs.existsSync(secondInput), false);
    assert.equal(fs.existsSync(secondWorking), false);
    assert.equal(fs.existsSync(finishedExport), true);
    assert.equal(fs.existsSync(installedModel), true);
    const refreshed = (await request(`/api/jobs/${second.id}`)).data;
    assert.deepEqual(refreshed.parts, []);
    assert.equal(refreshed.status, 'draft');
  } finally {
    server.kill();
    await new Promise(resolve => server.once('exit', resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
