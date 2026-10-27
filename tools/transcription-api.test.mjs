import test from 'node:test';
import { createTestFixture, stopTestServer } from './test-fixtures.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';

test('HTTP transcription rerun retains cache; beam invalidates; lead-in and model-panel preferences reuse words', { timeout: 60000 }, async t => {
  fs.mkdirSync('.cache', { recursive: true });
  const fixture = createTestFixture('.cache/transcription-api-');
  const { root } = fixture;
  t.after(() => fixture.cleanup());
  const bin = path.join(root, 'runtime/bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const name of ['ffmpeg', 'ffprobe']) {
    const suffix = process.platform === 'win32' ? '.exe' : '';
    const source = process.env[name === 'ffmpeg' ? 'TEST_FFMPEG' : 'TEST_FFPROBE'] || path.resolve('runtime/bin', name + suffix);
    fs.copyFileSync(source, path.join(bin, name + suffix));
  }
  const audio = path.join(root, 'source.wav');
  execFileSync(path.join(bin, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=5', audio], { windowsHide: true });
  const python = path.join(root, process.platform === 'win32' ? 'runtime/venv/Scripts/python.exe' : 'runtime/venv/bin/python');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, 'Test-only executable placeholder; subprocess is intercepted.');
  const trace = path.join(root, 'trace.cjs');
  fs.writeFileSync(trace, [
    "const cp = require('node:child_process'), fs = require('node:fs'), util = require('node:util');",
    "const original = cp.execFile;",
    "cp.execFile = function(file, args, options, callback) {",
    "  if (!String(file).includes('venv')) return original.apply(this, arguments);",
    "  try {",
    "    let value;",
    "    if (args[0] === '-S') value = Object.fromEntries(['python','torch','faster-whisper','ctranslate2','openai-whisper'].map(k=>[k,{ok:true,output:'test-version'}]));",
    "    else if (args[1].includes('r = dict(engine=')) value = {engine:args[2],installed:true,version:'test-version',runtimeVersion:'test-runtime',gpuAvailable:false,deviceCount:0,cpuComputeTypes:['int8','float32'],gpuComputeTypes:[],supportsBatching:true,initialization:'not-tested'};",
    "    else if (args[1].includes(\"cfg = json.loads\")) {",
    "      const c=JSON.parse(args[2]); process.stderr.write('TRANSCRIPTION_RUN\\n');",
    "      value={engine:c.engine,model:c.model,device:c.device,computeType:c.compute_type,batchSize:c.batch_size,beamSize:c.beam_size,language:c.language,segments:[{id:0,start:2,end:3,text:'Chapter One.',words:[{word:'Chapter',start:2,end:2.5},{word:'One.',start:2.5,end:3}]}]};",
    "      value.segments.push({id:1,start:3,end:4,text:'Untimed passage.',words:[]});",
    "      if(fs.statSync(c.audio).size>1000000){ const groups=[['Chapter One.',2],...['One.','Two.','Three.'].flatMap((n,i)=>[['Earlier narration ends.',96+i*150],[n,100+i*150],['The story resumes across the valley.',103+i*150]])]; value.segments=groups.map(([text,start],id)=>({id,start,end:start+text.split(' ').length*.35,text,words:text.split(' ').map((word,i)=>({word,start:start+i*.35,end:start+(i+1)*.35,probability:.95}))})); }",
    "      fs.writeFileSync(c.output,JSON.stringify(value)); value={};",
    "    } else throw Error('Unexpected Python call');",
    "    process.nextTick(()=>callback(null, JSON.stringify(value), ''));",
    "  } catch(error) { process.nextTick(()=>callback(error)); }",
    "};",
    "cp.execFile[util.promisify.custom] = function(...args) { return new Promise((resolve,reject)=>cp.execFile(...args,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr}))); };",
  ].join('\n'));
  const entry = path.join(root, 'server.cjs');
  buildSync({ entryPoints: ['server.ts'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: entry });
  const port = 24000 + Math.floor(Math.random() * 5000);
  const server = spawn(process.execPath, ['--require', trace, entry], { env: { ...process.env, SWISSMOUSE_RUNTIME_MODE: 'managed', APP_ROOT: root, PORT: String(port), NODE_ENV: 'production' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  server.stdout.on('data', data => logs += data);
  server.stderr.on('data', data => logs += data);
  const base = 'http://127.0.0.1:' + port;
  const request = async (url, body) => {
    const response = await fetch(base + url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    assert.ok(response.ok, url + ': ' + JSON.stringify(data) + '\n' + logs);
    return data;
  };
  try {
    for (let i=0; i<100 && !logs.includes('server running'); i++) await new Promise(resolve=>setTimeout(resolve,100));
    assert.match(logs, /server running/);
    const book = await request('/api/jobs', {name:'Transcription test',parts:[{name:audio}]});
    const route = '/api/jobs/' + book.id;
    const runs = () => (logs.match(/TRANSCRIPTION_RUN/g) || []).length;
    const wait = async () => {
      for (let i=0;i<150;i++) {
        const progress = await request('/api/step1/progress');
        if (!progress.isActive) { assert.equal(progress.error, null, logs); return; }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.fail('Processing timed out\n'+logs);
    };
    const full = async (options={}) => { await request(route+'/process-step1',{chapterSource:'whisperx',...options}); await wait(); };
    await full();
    assert.equal(runs(), 1);
    let saved = await request(route);
    assert.equal(saved.waveformReady,false,'transcription can run with waveform generation off');
    assert.equal(fs.existsSync(saved.previewPath+'.analysis.json'),false,'default detection does not build acoustic features');
    assert.ok(saved.transcription.requestKey && saved.transcriptKey);
    assert.equal(saved.transcriptSegments[1].text, 'Untimed passage.');
    assert.deepEqual(saved.transcriptSegments[1].words, []);
    assert.equal(saved.transcriptWords.length, 2);
    assert.match(logs, /WARNING: 1 speech segments have no word timestamps/);
    assert.match(logs, /Missing word timestamps.*00:00:03.000.*Untimed passage/);
    const firstKey = saved.transcriptKey;
    await full();
    assert.equal(runs(), 1);
    assert.equal((await request('/api/config')).detect_musical_transitions, false, 'experimental detection is off by default');
    const originalDetectionKey = saved.chapterDetectionKey;
    await request('/api/config', { detect_musical_transitions: true });
    await full();
    saved = await request(route);
    assert.notEqual(saved.chapterDetectionKey, originalDetectionKey);
    assert.equal(runs(), 1, 'changing music detection reuses transcription');
    assert.equal(saved.candidates[0].chapterNumber, 1, 'short/no-music book keeps its spoken heading');
    await request(route + '/rerun/detecting_chapters', {}); await wait();
    assert.equal(runs(), 1, 'music-aware detection rerun does not transcribe');
    assert.equal((await request(route)).chapterDetectionKey, saved.chapterDetectionKey);
    await request('/api/config', { detect_musical_transitions: false });
    await full();
    assert.equal((await request(route)).chapterDetectionKey, originalDetectionKey);
    assert.equal(runs(), 1);
    await request('/api/config',{lead_in_seconds:0.25,whisper_profile:'some-unrelated-profile'});
    await full();
    assert.equal(runs(), 1, 'detection/profile changes reuse the aligned transcript');
    await request(route+'/rerun/transcribing_whisper',{}); await wait();
    assert.equal(runs(), 2);
    saved = await request(route);
    assert.equal(saved.transcriptKey, firstKey);
    assert.ok(saved.transcription.requestKey);
    await full();
    assert.equal(runs(), 2, 'successful transcription rerun survives subsequent full processing');
    await full({transcriptionSettings:{'faster-whisper':{beamSize:2}}});
    assert.equal(runs(), 3);
    assert.equal((await request(route)).transcription.beamSize, 2);
    await full({chapterSource:'existing_files'});
    await full();
    assert.equal(runs(), 3, 'changing chapter workflow reuses retained transcript');
    assert.equal((await request(route)).candidates[0].chapterNumber, 1);
    await request(route + '/step1-settings', {chapterSource:'manual',mergeMethod:'skip',generateTranscript:true});
    const reviewedChapters = (await request(route)).chapters;
    await full({chapterSource:'manual',mergeMethod:'skip',generateTranscript:true});
    let independent = await request(route);
    assert.deepEqual(independent.chapters, reviewedChapters, 'transcription-only processing preserves chapter names and timing');
    assert.deepEqual(independent.candidates, []);
    assert.ok(independent.transcriptWords.length);
    assert.equal(independent.mergedMp3.fullPath, audio, 'skip mode reads the original recording directly');
    const beforeTranscript = independent.chapters;
    await request(route + '/rerun/transcribing_whisper', {}); await wait();
    independent = await request(route);
    assert.deepEqual(independent.chapters, beforeTranscript, 'standalone transcription never replaces chapter markers');
    assert.ok(!independent.staleSteps.includes('chapter_review'), 'a new transcript does not invalidate independent chapters');
    const invalid = await fetch(base+route+'/step1-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transcriptionSettings:{'openai-whisper':{beamSize:5}}})});
    assert.equal(invalid.status, 400);
    assert.match(logs, /Transcript cache: Hit/);
    assert.match(logs, /Transcription completed.*Device: CPU.*Batching: Off.*Beam: 2.*Fallback used: No/);

    // Both the full-processing and detection-only paths must keep suggestions
    // out of the saved/exportable list and protect an accepted manual review.
    const longAudio = path.join(root, 'experimental.wav');
    execFileSync(path.join(bin, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '600', longAudio], { windowsHide: true });
    const experimental = await request('/api/jobs', {name:'Experimental review test',parts:[{name:longAudio}]});
    const experimentalRoute = '/api/jobs/' + experimental.id;
    await request(experimentalRoute+'/process-step1', {chapterSource:'whisperx'}); await wait();
    const ordinary = await request(experimentalRoute);
    assert.equal(ordinary.candidates.length, 1);
    const originalWords = ordinary.transcriptWords;
    await request('/api/config', {detect_musical_transitions:true});
    await request(experimentalRoute+'/rerun/detecting_chapters', {}); await wait();
    const enhanced = await request(experimentalRoute);
    assert.equal(enhanced.candidates.filter(candidate=>candidate.suggestionOnly).length, 3);
    assert.deepEqual(enhanced.transcriptWords, originalWords);
    assert.deepEqual(enhanced.chapters, enhanced.chapterReviewBaseline);
    assert.equal(enhanced.chapters.length, 2);
    const suggestion = enhanced.candidates.find(candidate=>candidate.suggestionOnly);
    const accepted = [...enhanced.chapters, {id:'accepted',start:suggestion.candidate_start,title:suggestion.proposed_title,headingType:suggestion.headingType,
      parentChapterStart:suggestion.parentChapterStart,manuallyInserted:true}];
    await request(experimentalRoute+'/chapters', {chapters:accepted});
    const protectedRerun = await fetch(base+experimentalRoute+'/rerun/detecting_chapters',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(protectedRerun.status,409);
    assert.equal((await request(experimentalRoute)).chapters.length,3);
    await request(experimentalRoute+'/rerun/detecting_chapters',{confirmReplaceManualChapters:true}); await wait();
    assert.equal((await request(experimentalRoute)).chapters.length,2);
    await request(experimentalRoute+'/process-step1',{chapterSource:'whisperx'}); await wait();
    assert.equal((await request(experimentalRoute)).chapters.length,2);
  } finally {
    await stopTestServer(server);
  }
});
