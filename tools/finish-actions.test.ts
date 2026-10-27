import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {fingerprint,exportAudio,makePreview,inspectAsync} from './audio-engine';
import {audiobookTags} from './audiobook-metadata';
const ffmpeg=process.env.TEST_FFMPEG||path.resolve('runtime/bin/ffmpeg.exe'),ffprobe=process.env.TEST_FFPROBE||path.resolve('runtime/bin/ffprobe.exe');
test('finish actions preserve reusable artifacts, safely organize in Inbox, then verify before moving to Library',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'swissmouse-finish-')),inbox=path.join(root,'Inbox'),library=path.join(root,'Library'),source=path.join(inbox,'Unsorted'),work=path.join(root,'Work');
 fs.mkdirSync(source,{recursive:true});fs.mkdirSync(library);const pcm=path.join(root,'input.wav');
 execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','sine=duration=2',pcm],{windowsHide:true});
 const metadata={title:'Fixture',author:'Writer',narrator:'Reader',genres:[],language:'eng',abridged:false,explicit:false};
 const chapters=[{id:'c1',title:'First',start:'00:00:00.000',end:'00:00:02.000'}];
 const original=path.join(source,'Original.m4b');await exportAudio({ffmpeg,ffprobe,source:pcm,output:original,format:'m4b',chapters,tags:audiobookTags({...metadata,title:'Old title'},undefined,{},'m4b')});
 const preview=path.join(work,'intermediates','finish-book','analysis.wav');fs.mkdirSync(path.dirname(preview),{recursive:true});await makePreview(ffmpeg,original,preview);
 fs.writeFileSync(path.join(source,'notes.txt'),'Unrelated note');
 const job={id:'finish-book',name:'Fixture',metadata,metadataDraft:metadata,source:{kind:'inbox',mode:'folder',path:source},sourceFolderPath:source,outputFolderPath:work,sourceMembership:'confirmed',sourceKey:await fingerprint([original],{}),parts:[{id:'p',name:'Original.m4b',durationSeconds:2,sizeBytes:fs.statSync(original).size,order:1}],mergedMp3:{fullPath:original,duration:2,sizeBytes:fs.statSync(original).size},previewPath:preview,waveformReady:true,generateWaveform:true,transcriptWords:[{word:'Hello',start:0,end:.3}],totalDurationSeconds:2,chapters,candidates:[],logs:[],createdAt:new Date().toISOString(),status:'review'};
 fs.writeFileSync(path.join(root,'jobs.json'),JSON.stringify([job]));fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({inbox_folder:inbox,library_folder:library,library_template:'%Author%/%Book Title%',ffmpeg_path:ffmpeg,ffprobe_path:ffprobe,pcm_retention:'keep'}));
 const port=55000+Math.floor(Math.random()*700),base=`http://127.0.0.1:${port}`;
 let server=spawn(process.execPath,[path.resolve('dist/server.cjs')],{env:{...process.env,APP_ROOT:root,PORT:String(port),NODE_ENV:'production'},windowsHide:true,stdio:'pipe'});let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
 const request=async(route:string,body?:unknown,expected=200)=>{const res=await fetch(base+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data)+'\n'+logs);return data;};
 try{
  for(let i=0;i<100;i++){try{if(!(await request('/api/library/scan-status')).scanning)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const before=await inspectAsync(ffprobe,original);
  const tags=await request('/api/library/finish-book/write-audio-metadata',{});assert.equal(tags.written.length,1);assert.equal(tags.failures.length,0);
  const after=await inspectAsync(ffprobe,original);assert.equal(after.tags.title,'Fixture');assert.deepEqual(after.chapters,before.chapters);
  await request('/api/jobs/finish-book/build-m4b',{outputFormats:['m4b']});
  const checked=await request('/api/jobs/finish-book/validate',{});assert.equal(checked.validation.status,'PASS',JSON.stringify(checked.finalCheck.items));
  const current=await request('/api/jobs/finish-book/finish?location=current');
  await request('/api/jobs/finish-book/finish',{location:'current',target:current.target});
  assert.equal(fs.existsSync(preview),false,'finished processing removes disposable PCM even with Keep configured');
  let saved=await request('/api/jobs/finish-book');assert.ok(saved.retainedWaveform);assert.equal(saved.transcriptWords.length,1);
  assert.ok((await request('/api/jobs/finish-book/waveform?start=0&duration=2&pixels=100')).peaks.length);
  assert.equal((await request('/api/jobs/finish-book/final-check')).outdated,false);
  const organized=await request('/api/jobs/finish-book/finish?location=inbox');assert.equal(organized.target,path.join(inbox,'Writer','Fixture'));
  fs.mkdirSync(organized.target,{recursive:true});fs.writeFileSync(path.join(organized.target,'sentinel'),'Keep');
  await request('/api/jobs/finish-book/finish',{location:'inbox',target:organized.target},409);assert.ok(fs.existsSync(original));fs.unlinkSync(path.join(organized.target,'sentinel'));fs.rmdirSync(organized.target);
  const moved=await request('/api/jobs/finish-book/finish',{location:'inbox',target:organized.target});assert.equal(moved.job.source.kind,'inbox');assert.ok(fs.existsSync(path.join(source,'notes.txt')));assert.equal(fs.existsSync(original),false);
  assert.ok((await request('/api/jobs/finish-book/waveform?start=0&duration=2&pixels=100')).peaks.length);
  const final=await request('/api/jobs/finish-book/finish?location=library');
  const finished=await request('/api/jobs/finish-book/finish',{location:'library',target:final.target});assert.equal(finished.job.source.kind,'managed');assert.equal(finished.job.finishLocation,'library');assert.ok(fs.existsSync(path.join(final.target,'exmetadata.json')));assert.ok(fs.existsSync(finished.job.outputM4b.fullPath));
  assert.equal(fs.existsSync(moved.job.outputM4b.fullPath),false,'verified move removes the prior exported file');
  assert.ok((await request('/api/jobs/finish-book/waveform?start=0&duration=2&pixels=100')).peaks.length);
  assert.equal((await request('/api/jobs/finish-book/final-check')).outdated,false);
  const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped;
  server=spawn(process.execPath,[path.resolve('dist/server.cjs')],{env:{...process.env,APP_ROOT:root,PORT:String(port),NODE_ENV:'production'},windowsHide:true,stdio:'pipe'});server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
  for(let i=0;i<100;i++){try{if(!(await request('/api/library/scan-status')).scanning)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok((await request('/api/jobs/finish-book/waveform?start=0&duration=2&pixels=100')).peaks.length,'retained waveform survives restart');
  assert.equal((await request('/api/jobs/finish-book')).transcriptWords.length,1,'saved transcript survives restart');
 }finally{if(server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill();await done;}fs.rmSync(root,{recursive:true,force:true});}
});
