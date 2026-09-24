import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildSync } from 'esbuild';

test('backend APIs isolate model files, cancellation, removal, defaults and requirements', { timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.resolve('.cache/backend-test-'));
  const entry = path.join(root, 'server.cjs');
  buildSync({ entryPoints: ['server.ts'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: entry });
  // Test-only tracing: count actual subprocess/scan calls without production logging.
  const tracer = path.join(root, 'trace.cjs');
  fs.writeFileSync(tracer, `
    const cp = require('node:child_process');
    for (const name of ['exec', 'execFile', 'execSync', 'execFileSync', 'spawn']) {
      const original = cp[name];
      cp[name] = function(...args) { process.stderr.write('PROBE:' + name + '\\n'); return original.apply(this, args); };
    }
    const disk = require('node:fs');
    const original = disk.promises.readdir;
    disk.promises.readdir = function(...args) { process.stderr.write('MODEL_SCAN\\n'); return original.apply(this, args); };
    const spawn = cp.spawn;
    cp.spawn = function(command, args, options) {
      if (!args?.[1]?.includes('snapshot_download')) return spawn(command, args, options);
      const child = new (require('node:events').EventEmitter)();
      child.stdout = new (require('node:stream').PassThrough)();
      child.stderr = new (require('node:stream').PassThrough)();
      const timer = setTimeout(() => {
        if (args[1].includes('faster-whisper-small')) return child.emit('close', 1);
        const dir = require('node:path').join(${JSON.stringify(root)}, 'models/whisperx/models--Systran--faster-whisper-tiny/snapshots/complete');
        disk.mkdirSync(dir, {recursive:true});
        const fd = disk.openSync(dir + '/model.bin', 'w'); disk.ftruncateSync(fd, 11 * 1024 * 1024); disk.closeSync(fd);
        disk.writeFileSync(dir + '/config.json', '{}'); disk.writeFileSync(dir + '/tokenizer.json', '{}');
        child.emit('close', 0);
      }, args[1].includes('faster-whisper-base') ? 1000 : 30);
      child.kill = () => { clearTimeout(timer); child.emit('close', null); };
      return child;
    };
  `);
  const port = 19000 + Math.floor(Math.random() * 10000);
  const server = spawn(process.execPath, ['--require', tracer, entry], { env: { ...process.env, SWISSMOUSE_RUNTIME_MODE: 'managed', PORT: String(port), APP_ROOT: root, NODE_ENV: 'production' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', data => output += data);
  server.stderr.on('data', data => output += data);
  const base = `http://localhost:${port}`;
  const json = async (route, body) => {
    const response = await fetch(base + route, body === undefined ? undefined : { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    assert.equal(response.ok, true, `${route}: ${response.status}`);
    return response.json();
  };
  const weight = (relative) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), {recursive:true});
    const fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, 11 * 1024 * 1024); fs.closeSync(fd);
    return file;
  };
  try {
    for (let i=0; i<100 && !output.includes('server running'); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.match(output, /server running/);
    assert.equal((await json('/api/config')).faster_transcription, true);
    const project = await json('/api/jobs', {name:'Project title',author:'Project author',narrator:'Project narrator',parts:[]});
    assert.deepEqual([project.metadata.title, project.metadata.author, project.metadata.narrator], ['Project title','Project author','Project narrator']);
    const draft = {...project.metadata,title:'Editable draft',description:'Survives restart'};
    await json('/api/jobs/' + project.id + '/metadata-draft', {metadata:draft});
    assert.deepEqual((await json('/api/jobs/' + project.id)).metadataDraft, draft);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'jobs.json'),'utf8'))[0].metadataDraft, draft);
    await json('/api/jobs/' + project.id + '/metadata', {metadata:{...draft,title:'Saved title',author:'Edited author',narrator:'Edited narrator'}});
    const savedProject = await json('/api/jobs/' + project.id);
    assert.deepEqual([savedProject.name,savedProject.author,savedProject.narrator], ['Saved title','Edited author','Edited narrator']);
    assert.equal(savedProject.metadataDraft, undefined);
    const fw = weight('models/whisperx/models--Systran--faster-whisper-tiny/snapshots/test/model.bin');
    // Partial Faster Whisper snapshots must never be marked installed.
    assert.equal((await json('/api/models?engine=faster-whisper')).find(m=>m.id==='tiny').isInstalled, false);
    fs.writeFileSync(path.join(path.dirname(fw), 'config.json'), '{}');
    fs.writeFileSync(path.join(path.dirname(fw), 'tokenizer.json'), '{}');
    const pt = weight('models/openai-whisper/base/base.pt');
    for (const [engine, installed] of [['faster-whisper', 'tiny'], ['openai-whisper', 'base'], ['faster-whisper', 'tiny']]) {
      const models = (await json(`/api/models/refresh?engine=${engine}`, {})).models;
      assert.ok(models.every(m => m.backend === engine));
      assert.deepEqual(models.filter(m=>m.isInstalled).map(m=>m.id), [installed]);
    }
    const before = await json('/api/requirements/status');
    await new Promise(resolve => setTimeout(resolve, 50));
    const count = () => (output.match(/PROBE:|MODEL_SCAN/g) || []).length;
    const warmCount = count();
    await Promise.all(Array.from({length: 12}, () => Promise.all([
      json('/api/requirements/status'), json('/api/system/hardware'),
      json('/api/models?engine=faster-whisper&progress=true'), json('/api/models?engine=openai-whisper'),
    ])));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(count(), warmCount, 'warm UI status reads must not spawn processes or rescan models');
    assert.ok(before.components.every(c => !['tiny','base','small','medium','large-v3','large-v3-turbo'].includes(c.id)));
    await json('/api/requirements/status?refresh=true');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(count() > warmCount, 'manual refresh must rerun detection');
    await json('/api/config', {faster_transcription:false});
    assert.ok((await json('/api/models')).every(m=>m.backend==='openai-whisper'));
    const after = await json('/api/requirements/status');
    assert.deepEqual(after.components.map(c=>[c.id,c.classification,c.status]), before.components.map(c=>[c.id,c.classification,c.status]));
    assert.equal(after.statusColor, 'red');
    assert.ok(after.components.filter(c=>['faster_whisper','ctranslate2','openai_whisper','pytorch'].includes(c.id)).every(c=>c.classification==='optional'));
    await json('/api/models/tiny/cancel?engine=openai-whisper', {});
    assert.ok(fs.existsSync(fw));
    await json('/api/models/tiny/uninstall?engine=openai-whisper', {});
    assert.ok(fs.existsSync(fw));
    await json('/api/models/base/uninstall?engine=openai-whisper', {});
    assert.equal(fs.existsSync(pt), false);
    assert.ok(fs.existsSync(fw));
    assert.equal((await fetch(base + '/api/system/hardware/mode', {method:'POST',headers:{'Content-Type':'application/json'},body:'{"mode":"gpu"}'})).status, 404);
    assert.ok(['cpu','gpu'].includes((await json('/api/system/hardware')).mode));
    // A file-shaped but nonfunctional runtime must not allow model download work to start.
    const python = path.join(root, process.platform === 'win32' ? 'runtime/venv/Scripts/python.exe' : 'runtime/venv/bin/python');
    fs.mkdirSync(path.dirname(python), {recursive:true}); fs.writeFileSync(python, '');
    const refreshedRequirements = await json('/api/requirements/status?refresh=true');
    assert.equal(refreshedRequirements.components.find(component => component.id === 'python').status, 'missing');
    const blocked = await fetch(base + '/api/models/tiny/prepare?engine=faster-whisper&force=true', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(blocked.status, 424);
    assert.deepEqual((await blocked.json()).missingRequirements, ['Python Runtime']);
  } finally {
    server.kill();
    await new Promise(resolve => server.once('exit', resolve));
  }
});
