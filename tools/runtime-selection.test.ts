import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverRuntime, pathCandidates, optionalPackages, optionalRemoval, cleanPythonEnv, isWithin, PRIVATE_UNINSTALL_CHECK, assertManagedTarget } from './runtime-selection';
import { pytorchInstallPlan } from './requirements';
import { execFileSync } from 'node:child_process';

function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = (dir: string, name: string) => {
    const file = path.join(root, dir, name + (process.platform === 'win32' ? '.exe' : ''));
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'test placeholder'); return file;
  };
  const options = { runtimeRoot: path.join(root, 'app/runtime'), python: executable('app/runtime/venv', 'python'),
    ffmpeg: executable('app/runtime/bin', 'ffmpeg'), ffprobe: executable('app/runtime/bin', 'ffprobe'), ytDlp: executable('app/runtime/bin', 'yt-dlp') };
  return { root, executable, options };
}

test('PATH candidates exclude relative directories, Windows aliases and the private runtime', t => {
  const { root, executable, options } = fixture(t);
  const system = executable('system', 'python'); executable('WindowsApps', 'python');
  const value = ['.', path.dirname(options.python), path.join(root, 'WindowsApps'), `"${path.dirname(system)}"`, path.dirname(system)].join(path.delimiter);
  assert.deepEqual(pathCandidates(['python'], options.runtimeRoot, value), [system]);
  assert.equal(isWithin(options.runtimeRoot, options.runtimeRoot + '-other'), false);
  assert.equal(isWithin(options.runtimeRoot, options.python), true);
});

test('system-first discovery skips broken/old binaries and retains app fallbacks', async t => {
  const { root, executable, options } = fixture(t);
  executable('bad', 'ffmpeg'); executable('old', 'ffmpeg'); const good = executable('good', 'ffmpeg');
  const goodProbe = executable('good', 'ffprobe');
  executable('old', 'yt-dlp');
  const selected = await discoverRuntime({ ...options, pathValue: ['bad', 'old', 'good'].map(dir => path.join(root, dir)).join(path.delimiter),
    probe: async (file) => { if (file.includes('bad')) throw new Error('Cannot execute'); return file.includes('yt-dlp') ? '2024.01.01' : file.includes('old') ? 'ffmpeg version 4.4' : path.basename(file).startsWith('ffprobe') ? 'ffprobe version 8.0' : 'ffmpeg version 8.0'; } });
  assert.equal(selected.ffmpeg.path, good); assert.equal(selected.ffmpeg.source, 'system');
  assert.equal(selected.ffprobe.path, goodProbe); assert.equal(selected.ytDlp.path, options.ytDlp);
  assert.equal(selected.warnings.length, 3);
});

test('each engine selects one complete environment, never merges system and private packages', async t => {
  const { root, executable, options } = fixture(t);
  const first = executable('one', 'python'), second = executable('two', 'python');
  const selected = await discoverRuntime({ ...options, pathValue: ['one', 'two'].map(dir => path.join(root, dir)).join(path.delimiter),
    probe: async file => JSON.stringify({ compatible: true, version: '3.12.1', packages: file === first ? {'faster-whisper': {ok:true,output:'1.2.1'},ctranslate2:{ok:true,output:'4.8.2'}} : {torch:{ok:true,output:'2.8.0'}},
      engines: file === first ? ['faster-whisper'] : ['openai-whisper'], libraryPaths: [path.dirname(file)], errors: [] }) });
  assert.equal(selected.python.path, first);
  assert.equal(selected.backends['faster-whisper']?.path, first);
  assert.equal(selected.backends['openai-whisper']?.path, second);
  assert.equal(selected.backends['faster-whisper']?.packages.torch, undefined);
});

test('bare system Python is usable as a base without falsely selecting an engine', async t => {
  const { executable, options } = fixture(t); const python = executable('system', 'python');
  const selected = await discoverRuntime({ ...options, pathValue: path.dirname(python), probe: async () => JSON.stringify({compatible:true,version:'3.12.1',packages:{},engines:[],libraryPaths:[],errors:['Missing engines']}) });
  assert.equal(selected.python.source, 'system'); assert.deepEqual(selected.backends, {});
  assert.match(selected.warnings[0], /Missing engines/);
});

test('managed-only mode does not probe system tools', async t => {
  const { options } = fixture(t);
  const selected = await discoverRuntime({ ...options, mode:'managed', probe:async () => { throw new Error('Must not probe'); } });
  assert.equal(selected.mode, 'managed'); assert.equal(selected.python.source, 'app'); assert.deepEqual(selected.warnings, []);
});

test('current date/git FFmpeg builds are supported using their library version', async t => {
  const { executable, options } = fixture(t); const ffmpeg = executable('system','ffmpeg'); executable('system','ffprobe');
  const selected = await discoverRuntime({...options,pathValue:path.dirname(ffmpeg),probe:async(file)=> `${path.basename(file).startsWith('ffprobe') ? 'ffprobe' : 'ffmpeg'} version 2026-09-02-git-full_build\nlibavformat   63.  1.100 / 63.  1.100`});
  assert.equal(selected.ffmpeg.path,ffmpeg);
});

test('partial system media installations fall back as a pair for YouTube conversion', async t => {
  const {executable,options}=fixture(t); const ffmpeg=executable('system','ffmpeg');
  const selected=await discoverRuntime({...options,pathValue:path.dirname(ffmpeg),probe:async()=> 'ffmpeg version 8.0'});
  assert.equal(selected.ffmpeg.path,options.ffmpeg); assert.equal(selected.ffprobe.path,options.ffprobe);
  assert.match(selected.warnings[0],/pair/);
});

test('removal rejects redirected runtime directories', t => {
  const { root, options }=fixture(t);
  assert.doesNotThrow(()=>assertManagedTarget(path.join(root,'app'),path.dirname(options.python)));
  const outside=path.join(root,'outside'); fs.mkdirSync(outside);
  const link=path.join(options.runtimeRoot,'redirected'); fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>assertManagedTarget(path.join(root,'app'),link),/redirected/);
  assert.throws(()=>assertManagedTarget(path.join(root,'app'),outside),/Not an app-managed/);
});

test('uninstall requires allowlisted optional app copies and explicit confirmation', () => {
  for (const id of ['python', 'ffmpeg', 'ffprobe', '../torch', '__proto__', 'constructor']) assert.throws(() => optionalRemoval(id,true,true), /Only optional/);
  assert.throws(() => optionalRemoval('pytorch',true,false), /System installations are never removed/);
  assert.throws(() => optionalRemoval('pytorch',false,true), /Confirm/);
  for (const [id, packages] of Object.entries(optionalPackages)) assert.deepEqual(optionalRemoval(id,true,true), packages);
  assert.deepEqual(optionalRemoval('yt_dlp',true,true), []);
});

test('system PyTorch cannot be replaced by the app installer', () => {
  const report: any = {hardware:{hasNvidiaGpu:false},components:[{id:'pytorch',source:'system',installedVersion:'2.8.0'}]};
  assert.throws(() => pytorchInstallPlan(report,'cpu',true), /System PyTorch/);
});

test('Python subprocesses do not inherit paths that mix environments', () => {
  assert.deepEqual(cleanPythonEnv({PYTHONHOME:'outside',pythonpath:'outside',PATH:'tools',KEEP:'yes'}), {PATH:'tools',KEEP:'yes'});
});

const python = path.resolve(process.platform === 'win32' ? 'runtime/venv/Scripts/python.exe' : 'runtime/venv/bin/python');
test('ownership check rejects a real interpreter outside the requested private environment', {skip: !fs.existsSync(python)}, t => {
  const { root } = fixture(t);
  assert.throws(() => execFileSync(python, ['-c', PRIVATE_UNINSTALL_CHECK, root, '["torch"]'], { windowsHide:true, env:cleanPythonEnv(), stdio:'pipe' }), /Not the private runtime/);
});
