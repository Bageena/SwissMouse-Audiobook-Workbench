import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sampleRateFloor,parseEncoderSampleRates,verifyOutputSampleRate,opusInputSampleRate} from './audio-sample-rate';
import {exportAudio,inspect} from './audio-engine';
import {prepareMaster} from './source-audio';
import {preparationKey,processingKey} from './transcription-cache';
import {outputFormats} from '../src/audioFormats';

test('sample-rate selection preserves exact matches and floors unsupported rates, never rounding up',()=>{
  const rates=[48000,24000,16000,12000,8000];
  for(const [source,expected] of [[96000,48000],[48000,48000],[44100,24000],[22050,16000],[11025,8000]]) assert.equal(sampleRateFloor(source,rates),expected);
  assert.equal(sampleRateFloor(44100),44100);
  assert.equal(sampleRateFloor(46000,[44100,48000]),44100);
  assert.throws(()=>sampleRateFloor(7000,rates),/automatic upsampling is disabled/);
  for(const source of [0,NaN,Infinity,-1,22050.5]) assert.throws(()=>sampleRateFloor(source),/valid source/);
});

test('encoder rates are read from capabilities; unknown or malformed lists are not invented',()=>{
  assert.deepEqual(parseEncoderSampleRates('Encoder aac\n    Supported sample rates: 96000 48000 44100'),[96000,48000,44100]);
  assert.equal(parseEncoderSampleRates('Encoder flac\nSupported sample formats: s16 s32'),undefined);
  assert.throws(()=>parseEncoderSampleRates('Supported sample rates: unknown'),/capabilities/);
});

test('verification rejects unexpected rates and checks Opus input separately from playback',()=>{
  assert.doesNotThrow(()=>verifyOutputSampleRate(44100,44100));
  assert.throws(()=>verifyOutputSampleRate(48000,44100),/verification failed/);
  assert.doesNotThrow(()=>verifyOutputSampleRate(48000,24000,24000));
  assert.throws(()=>verifyOutputSampleRate(48000,24000,48000),/verification failed/);
  assert.throws(()=>verifyOutputSampleRate(24000,24000,24000),/verification failed/);
});

test('new normalization policy invalidates old prepared masters but leaves quick-copy keys stable',()=>{
  assert.notEqual(preparationKey('source','standard'),processingKey('audio-preparation','source',{mergeMethod:'standard'}));
  assert.equal(preparationKey('source','quick'),processingKey('audio-preparation','source',{mergeMethod:'quick'}));
});

const ff=process.env.TEST_FFMPEG || 'ffmpeg', fp=process.env.TEST_FFPROBE || 'ffprobe';
fs.mkdirSync('.cache',{recursive:true});
const root=fs.mkdtempSync(path.resolve('.cache/sample-rate-test-'));
function source(rate:number) {
  const file=path.join(root,`input-${rate}.wav`);
  if(!fs.existsSync(file)) execFileSync(ff,['-v','error','-f','lavfi','-i',`sine=frequency=440:sample_rate=${rate}:duration=1`,'-c:a','pcm_s16le',file],{windowsHide:true});
  return file;
}
const chapters=[{start:'00:00:00.000',title:'Opening'}];
test('actual conversion verifies all formats at 22.05, 44.1, 48 and 96 kHz including Vorbis fallback',async()=>{
  for(const rate of [22050,44100,48000,96000]) for(const format of outputFormats) {
    const output=path.join(root,`${rate}.${format}`), logs:string[]=[];
    const result=await exportAudio({ffmpeg:ff,ffprobe:fp,source:source(rate),output,format,chapters,convert:true,cue:false,onLog:line=>logs.push(line)});
    const target=format==='opus'?sampleRateFloor(rate,[48000,24000,16000,12000,8000]):format==='mp3'&&rate===96000?48000:rate;
    assert.equal(result.encodingSampleRate,target,`${rate} ${format}`);
    assert.ok(target<=rate); assert.equal(result.sourceSampleRate,rate);
    assert.equal(inspect(fp,output).sampleRate,format==='opus'?48000:target);
    if(format==='opus') assert.equal(opusInputSampleRate(output),target);
    assert.ok(logs.some(line=>/verified/.test(line)));
    if(format==='ogg'&&[22050,96000].includes(rate)) {
      assert.equal(result.bitrate,'VBR quality 4'); assert.match(result.warnings.join(' '),/Sample rate was retained/);
      assert.ok(logs.some(line=>/preflight failed/.test(line)));
    }
  }
});

test('mixed-rate normalization uses the lowest source rate and prevents mismatched direct stitching',async()=>{
  const prepared=await prepareMaster(ff,fp,[source(44100),source(48000)],path.join(root,'mixed'),'standard');
  assert.equal(inspect(fp,prepared.master).sampleRate,44100);
  assert.ok(Math.abs(inspect(fp,prepared.master).durationSeconds-2)<0.02);
  await assert.rejects(prepareMaster(ff,fp,[source(44100),source(48000)],path.join(root,'invalid-quick'),'quick'),/differs/);
});

test('existing higher-rate masters honor original-input ceiling; ordinary copies stay unchanged',async()=>{
  const capped=await exportAudio({ffmpeg:ff,ffprobe:fp,source:source(48000),output:path.join(root,'capped.wav'),format:'wav',chapters,sampleRateCeiling:44100,cue:false});
  assert.equal(capped.mode,'convert'); assert.equal(capped.sampleRate,44100);
  const copy=await exportAudio({ffmpeg:ff,ffprobe:fp,source:source(44100),output:path.join(root,'copy.wav'),format:'wav',chapters,cue:false});
  assert.equal(copy.mode,'copy'); assert.equal(copy.sampleRate,44100);
});

test('precise chapter cuts use the same floor policy, and an impossible ceiling fails without output',async()=>{
  const cut=await exportAudio({ffmpeg:ff,ffprobe:fp,source:source(44100),output:path.join(root,'cut.opus'),format:'opus',chapters:[{start:'00:00:00.000',end:'00:00:00.500',title:'Cut'}],cue:false});
  assert.equal(cut.encodingSampleRate,24000); assert.ok(Math.abs(cut.duration-0.5)<0.02);
  const output=path.join(root,'impossible.mp3');
  await assert.rejects(exportAudio({ffmpeg:ff,ffprobe:fp,source:source(44100),output,format:'mp3',chapters,sampleRateCeiling:7000,cue:false}),/upsampling is disabled/);
  assert.equal(fs.existsSync(output),false);
});
