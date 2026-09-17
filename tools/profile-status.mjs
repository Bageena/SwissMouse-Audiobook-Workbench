// Read-only local API latency trace. Uses the current runtime/models but never
// starts transcription, installs packages, or changes configuration.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildSync } from 'esbuild';

fs.mkdirSync('.cache', {recursive:true});
const folder = fs.mkdtempSync(path.resolve('.cache/status-profile-'));
const entry = path.join(folder, 'server.cjs');
buildSync({entryPoints:['server.ts'], bundle:true, platform:'node', format:'cjs', packages:'external', outfile:entry});
const port = 19000 + Math.floor(Math.random() * 10000);
const child = spawn(process.execPath, [entry], {
  env:{...process.env, PORT:String(port), NODE_ENV:'production'}, windowsHide:true, stdio:['ignore','pipe','pipe'],
});
let output = '';
child.stdout.on('data', data => output += data);
child.stderr.on('data', data => output += data);
const request = async route => {
  const start = performance.now();
  const response = await fetch(`http://localhost:${port}${route}`);
  await response.text();
  if (!response.ok) throw Error(`${route}: ${response.status}`);
  return Math.round(performance.now() - start);
};
try {
  for (let i = 0; i < 100 && !output.includes('server running'); i++) await new Promise(r => setTimeout(r, 100));
  if (!output.includes('server running')) throw Error(output || 'Server did not start');
  const cold = request('/api/requirements/status');
  await new Promise(r => setTimeout(r, 100));
  const config = await request('/api/config');
  console.log(JSON.stringify({coldRequirementsMs:await cold, concurrentConfigMs:config,
    warmRequirementsMs:await request('/api/requirements/status'), modelsMs:await request('/api/models'),
    cachedHardwareMs:await request('/api/system/hardware')}, null, 2));
} finally { child.kill(); }
