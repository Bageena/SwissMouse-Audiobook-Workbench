import {checkSourceAudio} from './audio-integrity';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inspect} from './audio-engine';
import {stitchCompatibility} from '../src/audioFormats';
import {sampleRateFloor} from './audio-sample-rate';
import {makePreview} from './audio-engine';
import {rebuildAnalysis} from './audio-analysis';
const run=promisify(execFile);

/** Review-only PCM; originals remain the eventual export inputs. */
export async function sourceReviewPreview(ffmpeg: string, sources: string[], output: string, signal?: AbortSignal, log: (message: string) => void = ()=>{}, generateWaveform = true) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (sources.length === 1) return makePreview(ffmpeg, sources[0], output, signal, log, generateWaveform, generateWaveform);
  const temporary = fs.mkdtempSync(path.join(path.dirname(output), 'review-parts-'));
  try {
    const files: string[] = [];
    for (const [index, source] of sources.entries()) {
      signal?.throwIfAborted();
      const file = path.join(temporary, `${index}.wav`); files.push(file);
      log(`Creating review-only preview ${index + 1}/${sources.length}`);
      await run(ffmpeg, ['-v','error','-y','-i',source,'-map','0:a:0','-map_metadata','-1','-map_chapters','-1','-ac','1','-ar','16000','-c:a','pcm_s16le','-rf64','auto',file], {windowsHide:true,signal});
    }
    const manifest = path.join(temporary, 'concat.txt');
    fs.writeFileSync(manifest, files.map(file => `file '${file.replace(/\\/g,'/').replace(/'/g,"'\\''")}'`).join('\n'));
    await run(ffmpeg, ['-v','error','-y','-f','concat','-safe','0','-i',manifest,'-map','0:a:0','-c:a','copy','-rf64','auto',output], {windowsHide:true,signal});
    signal?.throwIfAborted(); if (generateWaveform) await rebuildAnalysis(output);
  } finally { fs.rmSync(temporary, {recursive:true,force:true}); }
}

export async function prepareMaster(ffmpeg:string, ffprobe:string, sources:string[], directory:string, method:'standard'|'quick', progress:(message:string)=>void = ()=>{}, signal?:AbortSignal) {
  signal?.throwIfAborted();
  const media=sources.map(file=>inspect(ffprobe,file));
  const compatibility=stitchCompatibility(media.map(m=>({...m,isProbed:true})));
  if(method==='quick' && !compatibility.compatible) throw new Error('Skip PCM Conversion is unavailable: '+compatibility.reason);
  if(sources.some(file=>{const relative=path.relative(directory,file);return !relative.startsWith('..') && !path.isAbsolute(relative);})) throw new Error('Source files must be outside the intermediate directory.');
  fs.mkdirSync(directory,{recursive:true});
  if(sources.length===1) return {master:sources[0],media,durations:[media[0].durationSeconds],normalized:false};
  const inputs:string[]=[];
  const durations:number[]=[];
  const targetRate=Math.min(...media.map(m=>sampleRateFloor(m.sampleRate)));
  progress(`Source sample rates: ${media.map(m=>m.sampleRate).join(', ')} Hz. Master: ${targetRate} Hz; no source will be upsampled.`);
  const targetChannels=Math.max(...media.map(m=>m.channels));
  for(let i=0;i<sources.length;i++) {
    if(method==='quick') {
      progress(`Checking clean decoding for direct stitching: ${i+1}/${sources.length}`);
      const verification = await checkSourceAudio(ffmpeg, ffprobe, sources[i], signal);
      if (verification.issues.length) throw new Error(`${sources[i]}: ${verification.issues.join(' ')}`);
      inputs.push(sources[i]);durations.push(verification.encodedDurationSeconds!);
    } else {
      progress(`Normalizing PCM: ${i+1}/${sources.length}`);
      const normalized=path.join(directory,`part-${i}.wav`);
      await run(ffmpeg,['-v','error','-y','-i',sources[i],'-map','0:a:0','-c:a','pcm_s24le','-ar',String(targetRate),'-ac',String(targetChannels),'-rf64','auto',normalized],{windowsHide:true, signal});
      const info=inspect(ffprobe,normalized);
      if(info.sampleRate!==targetRate) throw new Error(`PCM sample-rate verification failed: expected ${targetRate} Hz, got ${info.sampleRate} Hz.`);
      inputs.push(normalized);durations.push(info.durationSeconds);
    }
  }
  const concat=path.join(directory,'concat.txt');
  fs.writeFileSync(concat,inputs.map((file,i)=>"file '"+file.replace(/\\/g,'/').replace(/'/g,"'\\''")+"'\nduration "+durations[i].toFixed(9)).join('\n'));
  const master=path.join(directory,method==='quick'?'master.mka':'master.wav');
  progress('Stitching the complete recording');
  await run(ffmpeg,['-v','error','-xerror','-y','-f','concat','-safe','0','-i',concat,'-map','0:a:0','-map_metadata','-1','-map_chapters','-1','-c:a','copy',...(method==='quick'?[]:['-rf64','auto']),master],{windowsHide:true, signal});
  const masterInfo=inspect(ffprobe,master);
  if(masterInfo.sampleRate!==targetRate) throw new Error('Stitched sample rate does not match the selected master rate.');
  const measured=masterInfo.durationSeconds;
  if(Math.abs(measured-durations.reduce((sum,d)=>sum+d,0))>0.15) throw new Error('Stitched duration does not match source coverage. Use PCM normalization or inspect the source timestamps.');
  if(method==='standard') for(const file of inputs) fs.unlinkSync(file); // The verified master replaces per-part PCM; analysis can still seek the master.
  return {master,media,durations,normalized:method==='standard'};
}
