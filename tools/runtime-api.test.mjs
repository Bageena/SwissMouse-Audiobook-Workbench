import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildSync } from 'esbuild';

test('hybrid HTTP reports active paths, routes model downloads and safely removes only private copies', {timeout:60000}, async () => {
  fs.mkdirSync('.cache',{recursive:true});
  const root = fs.mkdtempSync(path.resolve('.cache/runtime-api-'));
  const system = path.join(root,'system');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const placeholder = (relative) => { const file = path.join(root,relative); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,'fixture placeholder'); return file; };
  for(const name of ['ffmpeg','ffprobe','yt-dlp','python']) placeholder('system/'+name+suffix);
  const privatePython = placeholder(process.platform === 'win32' ? 'runtime/venv/Scripts/python.exe' : 'runtime/venv/bin/python');
  const localYt = placeholder('runtime/bin/yt-dlp'+suffix);
  const model = placeholder('models/keep-me');
  const book = placeholder('inputs/keep-me');
  const entry = path.join(root,'server.cjs');
  buildSync({entryPoints:['server.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:entry});
  const port = 31000+Math.floor(Math.random()*5000);
  const server=spawn(process.execPath,['--require',path.resolve('tools/fixtures/runtime-requirements.cjs'),entry],{env:{...process.env,PATH:system,APP_ROOT:root,PORT:String(port),NODE_ENV:'production',SWISSMOUSE_RUNTIME_MODE:'hybrid'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let logs=''; server.stdout.on('data',data=>logs+=data); server.stderr.on('data',data=>logs+=data);
  const request = async (route,body) => {
    const response = await fetch(`http://127.0.0.1:${port}`+route,body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(error => { throw new Error(route + ': ' + error.message + '\n' + logs); });
    return {status:response.status,data:await response.json()};
  };
  const settle = async () => {
    for(let i=0;i<100;i++) { const {data}=await request('/api/requirements/install-progress'); if(!data.isActive) {assert.equal(data.phase,'completed',JSON.stringify(data)); return;} await new Promise(r=>setTimeout(r,50)); }
    assert.fail('Removal never settled');
  };
  try {
    for(let i=0;i<100&&!logs.includes('server running');i++) await new Promise(r=>setTimeout(r,100));
    assert.match(logs,/server running/);
    const {data:report}=await request('/api/requirements/status');
    assert.equal(report.runtimeMode,'hybrid');
    for(const id of ['python','ffmpeg','ffprobe','yt_dlp','faster_whisper','ctranslate2','pytorch','openai_whisper']) {
      const component=report.components.find(item=>item.id===id);
      assert.equal(component.source,'system',id); assert.ok(component.installLocation.startsWith(system),id);
      assert.equal(component.canUninstall,component.classification==='optional',id);
    }
    assert.equal((await request('/api/requirements/install-repair',{selectedIds:[],pytorchFlavor:'cpu',confirmPytorchReplacement:true})).status,400);
    for(const id of ['python','ffmpeg','constructor']) assert.equal((await request('/api/requirements/uninstall',{id,confirmed:true})).status,400);
    assert.equal((await request('/api/requirements/uninstall',{id:'pytorch'})).status,400);
    assert.equal((await request('/api/requirements/uninstall',{id:'pytorch',confirmed:true})).status,200);
    assert.equal((await request('/api/requirements/status?refresh=true')).status,409);
    assert.equal((await request('/api/requirements/uninstall',{id:'ctranslate2',confirmed:true})).status,409);
    assert.equal((await request('/api/jobs',{name:'Blocked'})).status,409);
    await settle();
    const {data:after}=await request('/api/requirements/status');
    assert.equal(after.components.find(item=>item.id==='pytorch').status,'ready','system copy is still active');
    assert.equal(after.components.find(item=>item.id==='pytorch').canUninstall,false);
    assert.equal((await request('/api/requirements/uninstall',{id:'pytorch',confirmed:true})).status,400);
    const spawnLines=logs.split('\n').filter(line=>line.startsWith('FIXTURE_SPAWN:')).map(line=>JSON.parse(line.slice(14)));
    assert.deepEqual(spawnLines[0],{file:privatePython,args:['-m','pip','uninstall','--yes','torch']});
    assert.equal((await request('/api/requirements/uninstall',{id:'yt_dlp',confirmed:true})).status,200); await settle();
    assert.equal(fs.existsSync(localYt),false); assert.equal(fs.existsSync(path.join(system,'yt-dlp'+suffix)),true);
    assert.equal(fs.existsSync(model),true); assert.equal(fs.existsSync(book),true);
    assert.equal((await request('/api/tools/yt-dlp/uninstall',{})).status,200,'the separate YouTube panel uses the same protected private target');
    assert.equal(fs.existsSync(path.join(system,'yt-dlp'+suffix)),true);
    assert.equal((await request('/api/jobs',{name:'After maintenance'})).status,201,'the runtime lock is released after tool maintenance');
    assert.equal((await request('/api/models/tiny/prepare',{})).status,200);
    assert.equal((await request('/api/requirements/uninstall',{id:'ctranslate2',confirmed:true})).status,409);
    assert.ok(logs.includes(JSON.stringify(path.join(system,'python'+suffix))));
    const download=logs.split('\n').filter(line=>line.startsWith('FIXTURE_SPAWN:')).map(line=>JSON.parse(line.slice(14))).find(call=>call.args[1]?.includes('snapshot_download'));
    assert.equal(download.file,path.join(system,'python'+suffix));
  } finally { server.kill(); await new Promise(resolve=>server.once('exit',resolve)); }
});
