import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';
import {promisify} from 'node:util';
import { inspect, exportAudio, makePreview, fingerprint, validateChapters } from './audio-engine';
import { outputFormats } from '../src/audioFormats';
import {defaultBitrate, stitchCompatibility} from '../src/audioFormats';
import {audiobookTags} from './audiobook-metadata';
import {naturalPathCompare, sourceChapterGroups} from '../src/utils/sourceStructure';
import vm from 'node:vm';
import {downloadYoutubeAudio, youtubeUrl} from './youtube-audio';
const ff = process.env.TEST_FFMPEG || 'ffmpeg';
const fp = process.env.TEST_FFPROBE || 'ffprobe';
const binaryName = (name: string) => process.platform === 'win32' ? name + '.exe' : name;
const root = fs.mkdtempSync(path.resolve('audio-test-'));
const run = (args: string[]) => execFileSync(ff, ['-v', 'error', '-y', ...args], {windowsHide: true});
const chapters = [{start: '00:00:00.000', title: 'Opening'}, {start: '00:00:01.250', title: 'Chapter One'}, {start: '00:00:04.500', title: 'Two = # ; \\ café'}];
const master = path.join(root, 'master.wav');
// Audible opening, middle and trailing intervals; deliberately no chapter at zero or the end.
run(['-f', 'lavfi', '-i', "aevalsrc='0.25*sin(2*PI*(if(lt(t,1),330,if(gt(t,7),880,550)))*t)':s=48000:d=9", '-c:a', 'pcm_s16le', master]);
const cover = path.join(root, 'cover.png');
run(['-f', 'lavfi', '-i', 'color=c=blue:s=32x32', '-frames:v', '1', cover]);
const packets = (file: string) => JSON.parse(execFileSync(fp, ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', file], {encoding: 'utf8', maxBuffer: 20e6})).packets.map((p: any) => p.data_hash);
const fixtures: Record<string, string[]> = {mp3: ['-c:a','libmp3lame'], m4b: ['-c:a','aac','-f','mp4'], m4a: ['-c:a','aac'], aac: ['-c:a','aac'], ogg: ['-c:a','libvorbis'], oga: ['-c:a','libvorbis','-f','ogg'], opus: ['-c:a','libopus'], flac: ['-c:a','flac'], wav: ['-c:a','pcm_s16le'], aiff: ['-c:a','pcm_s16be'], aif: ['-c:a','pcm_s16be','-f','aiff'], wma: ['-c:a','wmav2'], alac: ['-c:a','alac','-f','mp4']};
test('all advertised inputs probe, decode, preserve opening/trailing audio, and seek on the preview timeline', async () => {
  for (const [ext, encoding] of Object.entries(fixtures)) {
    const file = path.join(root, 'input.' + ext);
    run(['-i', master, ...encoding, file]);
    const info = inspect(fp, file);
    assert.ok(Math.abs(info.durationSeconds - 9) < 0.2, ext);
    const preview = path.join(root, ext + '-preview.wav');
    await makePreview(ff, file, preview);
    assert.ok(Math.abs(inspect(fp, preview).durationSeconds - 9) < 0.2, ext);
    for (const seek of ['0.1', '4.5', '8.5']) {
      const output = run(['-ss', seek, '-i', preview, '-t', '0.1', '-f', 's16le', '-']);
      assert.ok(output.length >= 3100, ext + ' seek ' + seek);
      assert.ok(output.some(b => b !== 0), ext + ' audible ' + seek);
    }
  }
  const bad = path.join(root, 'invalid.mp3'); fs.writeFileSync(bad, 'not audio');
  assert.throws(() => inspect(fp, bad));
});
test('all selected outputs read chapters back and preserve source duration; compatible audio copies match packet hashes', async () => {
  for (const format of outputFormats) {
    const result = await exportAudio({ffmpeg: ff, ffprobe: fp, source: master, output: path.join(root, 'export.' + format), format, chapters, tags: {title: 'Fixture book', artist: 'Fixture author', series: 'Fixture series'}, cover});
    assert.ok(Math.abs(result.duration - 9) < 0.15, format);
    assert.equal(result.verifiedTags.title || result.verifiedTags.TITLE, 'Fixture book', format);
    assert.ok(fs.existsSync(path.join(root, 'export.' + format + '.cue')));
    const repaired = path.join(root, 'repair.' + format);
    const changed = [{start: '00:00:00.000', title: 'Opening'}, {start: '00:00:03.125', title: 'Reviewed'}];
    const repair = await exportAudio({ffmpeg: ff, ffprobe: fp, source: path.join(root, 'export.' + format), output: repaired, format, chapters: changed});
    assert.equal(repair.mode, 'copy');
    assert.deepEqual(packets(repaired), packets(path.join(root, 'export.' + format)), format + ' encoded packets');
    const read = inspect(fp, repaired);
    if (['m4b','m4a','mp3','flac'].includes(format)) assert.ok(read.artwork, format + ' artwork');
    if (['m4b','m4a'].includes(format)) assert.equal(read.tags.series,'Fixture series');
    if (format === 'wav') {
      const data = fs.readFileSync(repaired); const cue = data.indexOf(Buffer.from('cue '));
      assert.ok(cue > 0); assert.equal(data.readUInt32LE(cue + 8), 2);
      assert.equal(data.readUInt32LE(cue + 12 + 24 + 20), 150000);
    } else assert.deepEqual(read.chapters.map((c: any) => ({start:c.start,title:c.title})), changed);
  }
});
test('HTTP single-book repair, range preview and seven selected outputs', async () => {
  const appRoot=path.join(root,'app');const bin=path.join(appRoot,'runtime','bin');fs.mkdirSync(bin,{recursive:true});
  for(const [name,command] of [['ffmpeg',ff],['ffprobe',fp]]) {
    const executable=path.isAbsolute(command)?command:execFileSync(process.platform === 'win32' ? 'where.exe' : 'which',[command],{encoding:'utf8'}).trim().split(/\r?\n/)[0];
    fs.copyFileSync(executable,path.join(bin,binaryName(name)));
  }
  if(process.env.TEST_YOUTUBE_URL) fs.copyFileSync(path.resolve('runtime/bin',binaryName('yt-dlp')),path.join(bin,binaryName('yt-dlp')));
  const port=39000+Math.floor(Math.random()*1000);
  const child=spawn(process.execPath,[path.resolve('dist/server.cjs')],{env:{...process.env,APP_ROOT:appRoot,NODE_ENV:'production',PORT:String(port)},windowsHide:true,stdio:'pipe'});
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  const base='http://127.0.0.1:'+port;
  const request=async(url:string,body?:unknown)=>{const response=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const bodyText=await response.text();let data:any;try{data=JSON.parse(bodyText);}catch{throw new Error(url+' returned '+response.status+': '+bodyText+'\n'+logs);}assert.ok(response.ok,JSON.stringify(data));return data;};
  try {
    let ready=false;for(let i=0;i<80;i++){try{await request('/api/jobs');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
    assert.ok(ready,logs);
    const source=path.join(root,'export.m4b');const original=await fingerprint([source],{});
    const job=await request('/api/jobs',{name:'API fixture',parts:[{name:source}]});
    await request('/api/jobs/'+job.id+'/process-step1',{chapterSource:'existing_files'});
    let updated:any;
    for(let i=0;i<100;i++){updated=await request('/api/jobs/'+job.id);if(updated.status==='transcribed')break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(updated.status,'transcribed',logs);
    assert.equal(updated.mergedMp3.fullPath,source);
    assert.equal(updated.existingChapters.length,3);
    assert.ok(updated.metadata.cover.url.startsWith('data:image/'));
    const range=await fetch(base+'/api/jobs/'+job.id+'/audio-preview',{headers:{Range:'bytes=1000-1999'}});
    assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,1000);
    const exports=await request('/api/jobs/'+job.id+'/build-m4b',{outputFormats});
    assert.equal(exports.exports.length,7);
    assert.ok(exports.exports.every((e:any)=>e.status==='success'),JSON.stringify(exports));
    assert.equal(await fingerprint([source],{}),original);
    const validation=await request('/api/jobs/'+job.id+'/validate',{});assert.equal(validation.validation.status,'PASS');
    await request('/api/jobs/'+job.id+'/metadata',{metadata:{...updated.metadata,title:'Edited book',narrator:'Edited narrator',series:'Edited series',cover:null}});
    const edited=await request('/api/jobs/'+job.id+'/build-m4b',{outputFormats:['m4b']});
    assert.equal(edited.exports[0].status,'success',JSON.stringify(edited));
    const editedFile=inspect(fp,edited.exports[0].fullPath);
    assert.equal(editedFile.tags.title,'Edited book');assert.equal(editedFile.tags.composer,'Edited narrator');assert.equal(editedFile.tags.series,'Edited series');assert.equal(editedFile.artwork,undefined);
    const partial=await request('/api/jobs/'+job.id+'/build-m4b',{outputFormats:['mp3','wav'],bitrate:'invalid'});
    assert.deepEqual(partial.exports.map((e:any)=>e.status),['failed','success']);

    const loose=path.join(root,'loose');fs.mkdirSync(loose);
    for(const [name,freq] of [['10',900],['2',600],['1',300]] as const) run(['-f','lavfi','-i',`sine=frequency=${freq}:sample_rate=44100:duration=3`,'-c:a','libmp3lame','-b:a','128k',path.join(loose,name+'.mp3')]);
    const processBook=async(name:string,folder:string,mergeMethod='standard',chapterSource='existing_files', supplied?:any[])=>{
      const scan=await request('/api/system/scan-folder',{folderPath:folder});
      const parts=supplied || scan.files.map((f:any)=>({name:f.relativePath,sourceRelativePath:f.relativePath}));
      const book=await request('/api/jobs',{name,parts});
      await request('/api/jobs/'+book.id+'/process-step1',{sourceFolderPath:folder,mergeMethod,chapterSource,selectedModelId:'small',parts});
      let progress:any;
      for(let i=0;i<200;i++){progress=await request('/api/step1/progress');if(!progress.isActive)break;await new Promise(r=>setTimeout(r,100));}
      assert.equal(progress.isActive,false,'Processing timed out');
      return {book:await request('/api/jobs/'+book.id),progress,scan};
    };
    const pcm=await processBook('Loose PCM',loose);
    assert.equal(pcm.progress.stage,'completed',JSON.stringify(pcm.progress));
    assert.equal(pcm.book.sourceBitrate,128);
    assert.equal(pcm.book.sourceCodec,'pcm_s24le');
    assert.deepEqual(pcm.book.chapters.map((c:any)=>[c.title,c.start]),[['1','00:00:00.000'],['2','00:00:03.000'],['10','00:00:06.000']]);
    const preparedMasterPath=pcm.book.mergedMp3.fullPath;
    const preparedMasterMtime=fs.statSync(preparedMasterPath).mtimeMs;
    const rerunParts=pcm.scan.files.map((file:any)=>({name:file.relativePath,sourceRelativePath:file.relativePath}));
    await request('/api/jobs/'+pcm.book.id+'/process-step1',{sourceFolderPath:loose,mergeMethod:'standard',chapterSource:'existing_files',selectedModelId:'medium',parts:rerunParts});
    let rerunProgress:any;
    for(let i=0;i<200;i++){rerunProgress=await request('/api/step1/progress');if(!rerunProgress.isActive)break;await new Promise(resolve=>setTimeout(resolve,100));}
    const rerunBook=await request('/api/jobs/'+pcm.book.id);
    assert.equal(rerunProgress.stage,'completed',JSON.stringify(rerunProgress));
    assert.equal(rerunBook.mergedMp3.fullPath,preparedMasterPath);
    assert.equal(fs.statSync(preparedMasterPath).mtimeMs,preparedMasterMtime);
    assert.ok(rerunProgress.logs.some((line:string)=>line.includes('Reusing prepared master audio')));
    const encoded=await request('/api/jobs/'+pcm.book.id+'/build-m4b',{outputFormats:['mp3']});
    assert.equal(encoded.exports[0].status,'success',JSON.stringify(encoded));
    assert.equal(inspect(fp,encoded.exports[0].fullPath).bitrate,128);
    const manual=await request('/api/jobs/'+pcm.book.id+'/build-m4b',{outputFormats:['mp3'],bitrates:{mp3:64}});
    assert.equal(inspect(fp,manual.exports[0].fullPath).bitrate,64);

    const quick=await processBook('Loose Direct',loose,'quick');
    assert.equal(quick.scan.isStreamCopyCompatible,true);
    assert.equal(quick.progress.stage,'completed',JSON.stringify(quick.progress));
    assert.equal(quick.book.sourceCodec,'mp3');
    assert.equal(quick.book.chapters.length,3);
    assert.ok(fs.existsSync(quick.book.previewPath));
    assert.ok(!fs.existsSync(path.join(path.dirname(quick.book.previewPath),'part-0.wav')));
    assert.deepEqual(packets(quick.book.mergedMp3.fullPath),['1','2','10'].flatMap(n=>packets(path.join(loose,n+'.mp3'))));
    const remux=await request('/api/jobs/'+quick.book.id+'/build-m4b',{outputFormats:['mp3'],bitrates:{mp3:320}});
    assert.equal(remux.exports[0].mode,'copy');
    const higher=await request('/api/jobs/'+quick.book.id+'/build-m4b',{outputFormats:['mp3'],convert:true,bitrates:{mp3:192}});
    assert.equal(inspect(fp,higher.exports[0].fullPath).bitrate,192);

    const incompatible=path.join(root,'incompatible');fs.mkdirSync(incompatible);
    fs.copyFileSync(path.join(loose,'1.mp3'),path.join(incompatible,'1.mp3'));
    run(['-i',path.join(loose,'2.mp3'),'-ar','22050','-ac','2','-c:a','libmp3lame',path.join(incompatible,'2.mp3')]);
    const rejected=await processBook('Incompatible Direct',incompatible,'quick');
    assert.equal(rejected.scan.isStreamCopyCompatible,false);
    assert.match(rejected.scan.streamCopyIncompatibilityReason,/channels|sample/);
    assert.equal(rejected.progress.stage,'error');assert.match(rejected.progress.error,/Skip PCM/);
    const normalized=await processBook('Mixed PCM',incompatible);
    assert.equal(normalized.progress.stage,'completed',JSON.stringify(normalized.progress));

    const folders=path.join(root,'numbered');for(const n of ['1','2','10'])fs.mkdirSync(path.join(folders,n),{recursive:true});
    for(const name of ['1/1.mp3','1/2.mp3','2/1.mp3','10/1.mp3'])fs.copyFileSync(path.join(loose,'1.mp3'),path.join(folders,name));
    const grouped=await processBook('Numbered folders',folders);
    assert.equal(grouped.progress.stage,'completed',JSON.stringify(grouped.progress));
    assert.equal(grouped.book.chapterStructure,'sequential_folders');
    assert.deepEqual(grouped.book.chapters.map((c:any)=>[c.title,c.start]),[['1','00:00:00.000'],['2','00:00:06.000'],['10','00:00:09.000']]);
    assert.equal(grouped.book.mergedMp3.duration,12);
    const groupedExport=await request('/api/jobs/'+grouped.book.id+'/build-m4b',{outputFormats:['m4b']});
    assert.equal(groupedExport.exports[0].status,'success',JSON.stringify(groupedExport));
    assert.equal(inspect(fp,groupedExport.exports[0].fullPath).chapters.length,3);

    // The native YouTube audio container must go straight into processing, without a repair master.
    const youtubeFolder=path.join(root,"YouTube café's audio");fs.mkdirSync(youtubeFolder);
    let youtubeSource=path.join(youtubeFolder,'source.webm');
    const live=path.resolve('audio-test-youtube-live/Me at the zoo_jNQXAC9IVRw.webm');
    if(fs.existsSync(live)) fs.copyFileSync(live,youtubeSource);
    else run(['-i',master,'-c:a','libopus',youtubeSource]);
    let youtube:any;
    if(process.env.TEST_YOUTUBE_URL) {
      const info=await request('/api/youtube/fetch-info',{url:process.env.TEST_YOUTUBE_URL});
      assert.ok(info.info.durationSeconds>0);
      const book=await request('/api/jobs',{name:'Live YouTube import',parts:[]});
      const imported=await request('/api/youtube/download',{jobId:book.id,url:process.env.TEST_YOUTUBE_URL,format:'best'});
      assert.equal(imported.job.mergeMethod,'quick');
      youtubeSource=imported.file.filePath;
      await request('/api/jobs/'+book.id+'/process-step1',{chapterSource:'existing_files'});
      let progress:any;
      for(let i=0;i<200;i++){progress=await request('/api/step1/progress');if(!progress.isActive)break;await new Promise(r=>setTimeout(r,100));}
      youtube={book:await request('/api/jobs/'+book.id),progress};
    } else youtube=await processBook('YouTube native Opus',youtubeFolder,'quick');
    const youtubeHash=await fingerprint([youtubeSource],{});
    assert.equal(youtube.progress.stage,'completed',JSON.stringify(youtube.progress));
    assert.equal(youtube.book.mergedMp3.fullPath,youtubeSource);
    assert.equal(youtube.book.sourceCodec,'opus');
    assert.ok(!fs.existsSync(path.join(path.dirname(youtube.book.previewPath),'master.wav')));
    await request('/api/jobs/'+youtube.book.id+'/chapters',{chapters:[{id:'opening',start:'00:00:00.000',title:'Opening'},{id:'reviewed',start:'00:00:02.000',title:'Reviewed chapter'}]});
    await request('/api/jobs/'+youtube.book.id+'/metadata',{metadata:{...youtube.book.metadata,title:'YouTube conversion test',author:'Test author',narrator:'Test narrator'}});
    const youtubeExport=await request('/api/jobs/'+youtube.book.id+'/build-m4b',{outputFormats:['m4b']});
    assert.equal(youtubeExport.exports[0].status,'success',JSON.stringify(youtubeExport));
    assert.equal(inspect(fp,youtubeExport.exports[0].fullPath).tags.title,'YouTube conversion test');
    assert.equal((await request('/api/jobs/'+youtube.book.id+'/validate',{})).validation.status,'PASS');
    assert.equal(await fingerprint([youtubeSource],{}),youtubeHash);
    const failed=await fetch(base+'/api/jobs/'+youtube.book.id+'/build-m4b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outputFormats:['m4b'],bitrate:'invalid'})});
    assert.equal(failed.status,500);
    assert.equal((await request('/api/jobs/'+youtube.book.id)).outputM4b,null);

    const uploadedJob=await request('/api/jobs',{name:'Folder upload',parts:[]});
    const form=new FormData();
    for(const name of ['01/1.mp3','01/2.mp3','02/1.mp3'])form.append('files',new Blob([fs.readFileSync(path.join(loose,'1.mp3'))]),name);
    const uploadResponse=await fetch(base+'/api/upload-audio?jobId='+uploadedJob.id,{method:'POST',body:form});
    assert.ok(uploadResponse.ok);const upload:any=await uploadResponse.json();
    assert.equal(new Set(upload.files.map((f:any)=>f.filename)).size,3);
    assert.deepEqual(upload.files.map((f:any)=>f.originalName),['01/1.mp3','01/2.mp3','02/1.mp3']);
    const uploadedParts=upload.files.map((f:any)=>({name:f.filename,sourceRelativePath:f.originalName}));
    await request('/api/jobs/'+uploadedJob.id+'/step1-settings',{sourceFolderPath:upload.uploadDir,parts:uploadedParts});
    assert.deepEqual((await request('/api/jobs/'+uploadedJob.id)).parts.map((p:any)=>p.sourceRelativePath),['01/1.mp3','01/2.mp3','02/1.mp3']);
    const uploadProcessed=await processBook('Uploaded structure',upload.uploadDir,'standard','existing_files',uploadedParts);
    assert.equal(uploadProcessed.progress.stage,'completed',JSON.stringify(uploadProcessed.progress));
    assert.deepEqual(uploadProcessed.book.chapters.map((c:any)=>[c.title,c.start]),[['01','00:00:00.000'],['02','00:00:06.000']]);
    const whisperJob=await request('/api/jobs',{name:'Whisper missing runtime',parts:[]});
    const whisperScan=await request('/api/system/scan-folder',{folderPath:loose});
    const whisperParts=whisperScan.files.map((f:any)=>({name:f.relativePath,sourceRelativePath:f.relativePath}));
    const whisperResponse=await fetch(base+'/api/jobs/'+whisperJob.id+'/process-step1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceFolderPath:loose,mergeMethod:'quick',chapterSource:'whisperx',selectedModelId:'small',parts:whisperParts})});
    assert.equal(whisperResponse.status,424);
    const whisperError:any=await whisperResponse.json();
    assert.deepEqual(whisperError.missingRequirements,['Application Runtime','Faster Whisper','CTranslate2']);
    const whisper=await request('/api/jobs/'+whisperJob.id);
    assert.ok(!whisper.transcription);assert.ok(!whisper.transcriptWords?.length);
    assert.match(whisper.logs.at(-1).message,/Step 1 processing failed.*Missing requirements/);

    // Dependency validation runs before Multer writes any staged upload files.
    const ffprobeBinary=path.join(bin,binaryName('ffprobe'));
    fs.renameSync(ffprobeBinary,ffprobeBinary+'.missing');
    await request('/api/requirements/status?refresh=true');
    const blockedImportJob=await request('/api/jobs',{name:'Blocked import',parts:[]});
    const inputsRoot=path.join(appRoot,'inputs');
    const inputsBefore=fs.readdirSync(inputsRoot,{recursive:true}).map(String).sort();
    const blockedForm=new FormData();
    blockedForm.append('files',new Blob([fs.readFileSync(path.join(loose,'1.mp3'))]),'1.mp3');
    const blockedImport=await fetch(base+'/api/upload-audio?jobId='+blockedImportJob.id,{method:'POST',body:blockedForm});
    assert.equal(blockedImport.status,424);
    assert.deepEqual((await blockedImport.json()).missingRequirements,['FFprobe']);
    assert.deepEqual(fs.readdirSync(inputsRoot,{recursive:true}).map(String).sort(),inputsBefore,'blocked imports must not stage or move files');
    assert.match((await request('/api/jobs/'+blockedImportJob.id)).logs.at(-1).message,/Import failed.*No files were copied or modified/);
    console.log('API fixtures: '+appRoot);
  } finally {child.kill();}
});

test('YouTube wrapper preserves native audio, handles exact Unicode paths, and rejects invalid inputs',async()=>{
  assert.equal(youtubeUrl('youtu.be/example'),'https://youtu.be/example');
  for(const value of [null,42,'https://example.com/video','https://youtube.com.evil/video']) assert.throws(()=>youtubeUrl(value));
  const fixture=path.join(root,'fake-ytdlp.cjs');
  fs.writeFileSync(fixture,`const fs=require('fs'),path=require('path'); const args=process.argv.slice(2);
    const folder=path.dirname(args[args.indexOf('-o')+1]);
    if(args[args.indexOf('-f')+1]!=='bestaudio'||args.includes('-x'))process.exit(2);
    if(!args.includes('--ffmpeg-location')||!args.includes('--ignore-config'))process.exit(3);
    const output=path.join(folder,"Audio café's & %PATH%.webm");
    fs.writeFileSync(output,'native stream');fs.writeFileSync(path.join(folder,'newer-unrelated.part'),'partial');
    console.log(JSON.stringify(output));`);
  const folder=path.join(root,'wrapper output');
  const result=await downloadYoutubeAudio(process.execPath,path.dirname(ff),folder,'https://youtu.be/example','best',[fixture]);
  assert.equal(result.file,"Audio café's & %PATH%.webm");
  await assert.rejects(downloadYoutubeAudio(process.execPath,'',folder,'https://youtu.be/example','invalid',[fixture]),/Unsupported/);
  fs.writeFileSync(fixture,'console.error("Video unavailable");process.exit(1)');
  await assert.rejects(downloadYoutubeAudio(process.execPath,'',folder,'https://youtu.be/example','best',[fixture]),/Video unavailable/);
});
test('source bitrate defaults and conservative folder grouping',()=>{
  assert.equal(defaultBitrate(128),128);assert.equal(defaultBitrate(127),96);assert.equal(defaultBitrate(320),320);assert.equal(defaultBitrate(0),96);
  assert.equal(stitchCompatibility([{codec:'mp3'}]).compatible,false);
  const paths=['10/1.mp3','2/10.mp3','2/2.mp3'].sort(naturalPathCompare);
  assert.deepEqual(sourceChapterGroups(paths).groups.map(g=>[g.title,g.indices.length]),[['2',2],['10',1]]);
  assert.equal(sourceChapterGroups(['extras/1.mp3','notes/1.mp3']).mode,'files');
  assert.equal(sourceChapterGroups(['01/1.mp3','notes/1.mp3']).mode,'files');
});
test('all friendly metadata fields survive each container and Audiobookshelf parser',async()=>{
  const reference=process.env.TEST_ABS_PROBER || path.resolve('audio-test-reference/prober.cjs');
  assert.ok(fs.existsSync(reference),'Download the official Audiobookshelf prober.js and set TEST_ABS_PROBER (see FORMAT-SUPPORT.md).');
  const code=fs.readFileSync(reference,'utf8');
  const grab=code.slice(code.indexOf('function tryGrabTags('),code.indexOf('function parseMediaStreamInfo('));
  const parse=code.slice(code.indexOf('function parseTags('),code.indexOf('function getDefaultAudioStream('));
  const absParse=vm.runInNewContext(grab+'\n'+parse+'\nparseTags');
  const meta={title:'Book title',subtitle:'Subtitle',author:'Author One; Author Two',narrator:'Narrator One; Narrator Two',series:'Book series',seriesSequence:'2.5',genres:['Fiction','Fantasy'],publishedYear:'2024',releaseDate:'2024-09-01',publisher:'Publisher',language:'eng',isbn:'9780000000001',asin:'B000000001',description:'A description.',copyright:'Copyright fixture',explicit:true,abridged:false};
  for(const format of outputFormats){
    const output=path.join(root,'metadata.'+format);
    await exportAudio({ffmpeg:ff,ffprobe:fp,source:master,output,format,chapters,tags:audiobookTags(meta,undefined,{},format)});
    const info=inspect(fp,output);const tags=Object.fromEntries(Object.entries(info.tags).map(([k,v])=>[k.toLowerCase(),v]));
    const read=absParse({tags});
    for(const [key,value] of Object.entries({album:meta.title,title:meta.title,subtitle:meta.subtitle,artist:meta.author,composer:meta.narrator,series:meta.series,seriespart:meta.seriesSequence,genre:'Fiction; Fantasy',publisher:meta.publisher,date:meta.publishedYear,language:meta.language,isbn:meta.isbn,asin:meta.asin,description:meta.description})) assert.equal(read['file_tag_'+key],value,format+' '+key);
    assert.equal(tags.releasetime,meta.releaseDate,format+' release date');
    assert.equal(tags.explicit,'1');assert.equal(tags.abridged,'0');
    assert.equal(info.chapters.length,3);
  }
});
test('actual Whisper recognition with word alignment (requires runtime and TEST_WHISPER_AUDIO)', {skip:!fs.existsSync(path.resolve('runtime/venv/Scripts/python.exe')) || !process.env.TEST_WHISPER_AUDIO},async()=>{
  const audio=path.resolve(process.env.TEST_WHISPER_AUDIO!);
  assert.ok(inspect(fp,audio).durationSeconds<=60,'Use a short spoken fixture, not a full audiobook.');
  const output=path.join(root,'whisper');fs.mkdirSync(output);
  await promisify(execFile)(path.resolve('runtime/venv/Scripts/python.exe'),['-m','whisperx',audio,'--model','large-v3-turbo','--language','en','--device',process.env.TEST_WHISPER_DEVICE || 'cpu','--compute_type',process.env.TEST_WHISPER_DEVICE==='cuda'?'float16':'int8','--model_dir',path.resolve('models/whisperx'),'--output_dir',output,'--output_format','json'],{windowsHide:true,maxBuffer:64*1024*1024,env:{...process.env,PATH:path.resolve('runtime/bin')+path.delimiter+process.env.PATH,TORCH_HOME:path.resolve('models/torch')}});
  const result=JSON.parse(fs.readFileSync(path.join(output,path.parse(audio).name+'.json'),'utf8'));
  assert.ok(result.segments.some((s:any)=>/chapter/i.test(s.text)),'Spoken fixture must include a chapter heading.');
  const words=result.segments.flatMap((s:any)=>s.words||[]);
  assert.ok(words.length>5);assert.ok(words.some((w:any)=>Number.isFinite(w.start)&&Number.isFinite(w.end)));
});
test('ALAC M4A/M4B repairs preserve packets and metadata; source and settings invalidate fingerprints', async () => {
  for (const format of ['m4a','m4b'] as const) {
    const source = path.join(root, 'alac.' + format);
    run(['-i', master, '-i', cover, '-map','0:a','-map','1:v','-c:a','alac','-c:v','copy','-disposition:v','attached_pic','-metadata','title=Original','-metadata','composer=Narrator','-f','mp4',source]);
    const output = path.join(root, 'alac-repaired.' + format);
    await exportAudio({ffmpeg:ff,ffprobe:fp,source,output,format,chapters});
    assert.deepEqual(packets(source),packets(output));
    assert.equal(inspect(fp,output).tags.composer,'Narrator');
  }
  assert.notEqual(await fingerprint([master], {model:'large-v3-turbo'}), await fingerprint([master], {model:'small'}));
  const copy = path.join(root,'changed.wav'); fs.copyFileSync(master,copy);
  const before = await fingerprint([copy],{}); fs.appendFileSync(copy,'changed');
  assert.notEqual(before, await fingerprint([copy],{}));
  assert.throws(() => validateChapters([{start:'00:00:09.000',title:'End'}],9));
  await assert.rejects(exportAudio({ffmpeg:ff,ffprobe:fp,source:master,output:master,format:'wav',chapters}));
});
