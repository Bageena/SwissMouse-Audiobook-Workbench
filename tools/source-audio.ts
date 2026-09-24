import fs from 'node:fs';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {inspect} from './audio-engine';
import {stitchCompatibility} from '../src/audioFormats';
import {sampleRateFloor} from './audio-sample-rate';
const run=promisify(execFile);

// Gapless duration metadata excludes encoder padding. A stream-copy concat must
// advance by encoded packet span instead, otherwise the next file overlaps it.
async function encodedSpan(ffprobe:string,file:string, signal?:AbortSignal) {
  return new Promise<number>((resolve,reject)=>{
    const child=spawn(ffprobe,['-v','error','-select_streams','a:0','-show_packets','-show_entries','packet=pts_time,dts_time,duration_time','-of','compact=p=0',file],{windowsHide:true, signal});
    let pending='',error='',invalid='';let first=Infinity,last=-Infinity,previousDts=-Infinity,previousEnd:number|undefined;
    const read=(line:string)=>{
      const values=Object.fromEntries(line.trim().split('|').map(part=>part.split('=')));
      if(!values.pts_time) return;
      const pts=Number(values.pts_time),dts=Number(values.dts_time),duration=Number(values.duration_time);
      if(!Number.isFinite(pts)||!Number.isFinite(dts)||!(duration>0)||dts<previousDts || (previousEnd!==undefined && Math.abs(pts-previousEnd)>0.1)) invalid='Packet timestamps are missing, discontinuous or non-monotonic. Use PCM normalization.';
      first=Math.min(first,pts);last=Math.max(last,pts+duration);previousDts=dts;previousEnd=pts+duration;
    };
    child.stdout.on('data',data=>{pending+=data;const lines=pending.split('\n');pending=lines.pop()||'';lines.forEach(read);});
    child.stderr.on('data',data=>{error=(error+data).slice(-4000);});
    child.on('error',reject);
    child.on('close',code=>{if(pending)read(pending);if(code!==0||invalid||!Number.isFinite(last-first)) reject(new Error(invalid||error||'Cannot measure packet timeline'));else resolve(last-first);});
  });
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
      await run(ffmpeg,['-v','error','-xerror','-err_detect','explode','-i',sources[i],'-map','0:a:0','-f','null','-'],{windowsHide:true, signal});
      inputs.push(sources[i]);durations.push(await encodedSpan(ffprobe,sources[i],signal));
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
  return {master,media,durations,normalized:method==='standard'};
}
