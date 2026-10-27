// Opt-in network acceptance check. Run only against a disposable release copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = path.resolve(process.argv[2] || '');
assert.equal(process.argv[3], '--download-tools', 'Explicit --download-tools is required.');
assert.equal(fs.readFileSync(path.join(root, '.swissmouse-release-validation'), 'utf8').trim(), 'disposable', 'Use a marked disposable installation only.');
assert.equal(process.platform, 'win32', 'This acceptance check targets Windows.');
const requirePackage = createRequire(path.join(root, 'package.json'));
for (const name of Object.keys(requirePackage('./package.json').dependencies))
  assert.ok(requirePackage.resolve(name).startsWith(path.join(root, 'node_modules') + path.sep), `${name} must resolve inside the release`);
const sentinel = path.join(root, 'inputs', 'preserve-validation.txt');
fs.mkdirSync(path.dirname(sentinel), { recursive: true }); fs.writeFileSync(sentinel, 'Do not modify user media');
const port = 43000 + Math.floor(Math.random() * 900), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(root, 'dist/server.cjs')], {
  cwd: root, env: { ...process.env, APP_ROOT: root, PORT: String(port), NODE_ENV: 'production', SWISSMOUSE_RUNTIME_MODE: 'managed', SWISSMOUSE_OPEN_BROWSER: '0' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '', failure;
child.on('error', error => failure = error);
child.stdout.on('data', chunk => logs = (logs + chunk).slice(-50000));
child.stderr.on('data', chunk => logs = (logs + chunk).slice(-50000));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = async (route, body, expected = 200) => {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data)); return data;
};
const settle = async expected => {
  let lastMessage = '', lastPrinted = 0;
  for (let i = 0; i < 960; i++) {
    const progress = await request('/api/requirements/install-progress');
    if (progress.currentActivity !== lastMessage || Date.now() - lastPrinted > 10000) {
      lastMessage = progress.currentActivity; lastPrinted = Date.now(); console.log(`${progress.phase}: ${lastMessage}`);
    }
    if (!progress.isActive) { assert.equal(progress.phase, expected, JSON.stringify(progress)); return progress; }
    await pause(500);
  }
  throw new Error('Installation did not settle within eight minutes.');
};
try {
  for (let i = 0; i < 120 && !logs.includes('server running'); i++) { if (failure) throw failure; if (child.exitCode !== null) throw new Error(logs); await pause(100); }
  assert.match(logs, /server running/);
  assert.equal((await request('/api/jobs')).length, 0, 'Never run this check against an existing library');
  const before = await request('/api/requirements/status');
  assert.equal(before.components.find(item => item.id === 'python').status, 'ready', 'Create a private runtime/venv with a supported Python before this check');
  for (const id of ['ffmpeg', 'ffprobe', 'yt_dlp']) assert.notEqual(before.components.find(item => item.id === id).status, 'ready', `${id} should start missing`);
  const started = await request('/api/requirements/install-repair', { selectedIds: ['yt_dlp'] });
  assert.ok(started.componentsToFix.some(item => item.id === 'ffmpeg'));
  // Request cancellation during a real download; the active step finishes safely.
  await request('/api/requirements/cancel', {});
  await settle('cancelled');
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'Do not modify user media');
  await request('/api/requirements/install-repair', { selectedIds: ['yt_dlp'] });
  await settle('completed');
  const after = await request('/api/requirements/status?refresh=true');
  const tools = after.components.filter(item => ['ffmpeg', 'ffprobe', 'yt_dlp'].includes(item.id));
  for (const tool of tools) { assert.equal(tool.status, 'ready', JSON.stringify(tool)); assert.ok(tool.installLocation.startsWith(path.join(root, 'runtime'))); }
  const ffmpeg = path.join(root, 'runtime/bin/ffmpeg.exe'), ffprobe = path.join(root, 'runtime/bin/ffprobe.exe');
  const generated = path.join(root, 'validation-tone.wav');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', generated], { windowsHide: true });
  const probe = JSON.parse(execFileSync(ffprobe, ['-v','error','-show_format','-show_streams','-of','json',generated], { windowsHide:true, encoding:'utf8' }));
  assert.equal(probe.streams[0].codec_type, 'audio'); assert.equal(Number(probe.format.duration), 1);
  execFileSync(ffmpeg, ['-v','error','-i',generated,'-f','null','-'], { windowsHide:true });
  const ytVersion = execFileSync(path.join(root,'runtime/bin/yt-dlp.exe'), ['--version'], { windowsHide:true,encoding:'utf8',timeout:30000 }).trim();
  assert.ok(fs.readdirSync(path.join(root,'runtime/licenses/ffmpeg')).length);
  assert.equal(fs.readFileSync(sentinel,'utf8'),'Do not modify user media');
  const result = { verifiedAt: new Date().toISOString(), node: process.version, root, cancellation: 'waited for the current step; retry completed', tools: tools.map(({id,installedVersion,installLocation})=>({id,installedVersion,installLocation})), ytVersion, generatedAudioSeconds: 1, systemToolsModified: false };
  fs.writeFileSync(path.join(root,'verification-runtime.json'), JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} catch (error) { console.error(logs.slice(-12000)); throw error; }
finally {
  if (child.exitCode === null) { const exit = new Promise(resolve=>child.once('exit',resolve)); child.kill(); await exit; }
}
