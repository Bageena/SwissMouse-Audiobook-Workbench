import { readProjectState } from './project-store-fixture';
import { after, test } from 'node:test';
import { createTestFixture, stopTestServer } from './test-fixtures.mjs';
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
import { applyChapterNumberFormat } from '../src/utils/chapters';
import vm from 'node:vm';
import {downloadYoutubeAudio, youtubeUrl} from './youtube-audio';
import metadataFixture from './fixtures/audiobook-metadata.json';
const ff = process.env.TEST_FFMPEG || 'ffmpeg';
const fp = process.env.TEST_FFPROBE || 'ffprobe';
const binaryName = (name: string) => process.platform === 'win32' ? name + '.exe' : name;
const fixture = createTestFixture('audio-test-');
const { root } = fixture;
after(() => fixture.cleanup());
const run = (args: string[]) => execFileSync(ff, ['-v', 'error', '-y', ...args], {windowsHide: true});
const chapters = [{start: '00:00:00.000', title: 'Opening'}, {start: '00:00:01.250', title: 'Chapter One'}, {start: '00:00:04.500', title: 'Two = # ; \\ café'}];
const master = path.join(root, 'master.wav');
// Audible opening, middle and trailing intervals; deliberately no chapter at zero or the end.
run(['-f', 'lavfi', '-i', "aevalsrc='0.25*sin(2*PI*(if(lt(t,1),330,if(gt(t,7),880,550)))*t)':s=48000:d=9", '-c:a', 'pcm_s16le', master]);
const cover = path.join(root, 'cover.png');
run(['-f', 'lavfi', '-i', 'color=c=blue:s=32x32', '-frames:v', '1', cover]);
const packets = (file: string) => JSON.parse(execFileSync(fp, ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', file], {encoding: 'utf8', maxBuffer: 20e6})).packets.map((p: any) => p.data_hash);
const fixtures: Record<string, string[]> = {mp3: ['-c:a','libmp3lame'], m4b: ['-c:a','aac','-f','mp4'], m4a: ['-c:a','aac'], aac: ['-c:a','aac'], ogg: ['-c:a','libvorbis'], oga: ['-c:a','libvorbis','-f','ogg'], opus: ['-c:a','libopus'], flac: ['-c:a','flac'], wav: ['-c:a','pcm_s16le'], aiff: ['-c:a','pcm_s16be'], aif: ['-c:a','pcm_s16be','-f','aiff'], wma: ['-c:a','wmav2'], alac: ['-c:a','alac','-f','mp4']};
test('export accepts a final chapter at the rounded millisecond duration', () => {
  const duration = 17790.275918;
  assert.doesNotThrow(() => validateChapters([
    { start: '00:00:00.000', end: '04:56:30.276', title: 'Opening' },
  ], duration));
  assert.throws(() => validateChapters([
    { start: '00:00:00.000', end: '04:56:30.277', title: 'Opening' },
  ], duration), /Invalid end timestamp/);
});
test('gap export removes the exact PCM samples and rebases chapters in every format', async () => {
  const ranges = [
    { start: '00:00:00.000', end: '00:00:02.000', title: 'Chapter 1' },
    { start: '00:00:03.000', end: '00:00:04.000', title: 'Chapter 2' },
    { start: '00:00:05.000', end: '00:00:08.000', title: 'Chapter 3' },
  ];
  const pcm = (file: string) => execFileSync(ff, ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 's16le', '-c:a', 'pcm_s16le', 'pipe:1']);
  const original = pcm(master);
  const expected = Buffer.concat([[0, 2], [3, 4], [5, 8]].map(([start, end]) => original.subarray(start * 48000 * 2, end * 48000 * 2)));
  for (const format of outputFormats) {
    const output = path.join(root, `gap-output.${format}`);
    const result = await exportAudio({ ffmpeg: ff, ffprobe: fp, source: master, output, format, chapters: ranges });
    assert.equal(result.mode, 'convert');
    assert.ok(Math.abs(result.duration - 6) < 0.15, format);
    assert.deepEqual(inspect(fp, output).chapters.map((c: any) => c.start), ['00:00:00.000', '00:00:02.000', '00:00:03.000'], format);
    assert.match(fs.readFileSync(output + '.cue', 'utf8'), /INDEX 01 00:03:00/);
    if (format === 'wav' || format === 'flac') assert.deepEqual(pcm(output), expected, format);
  }
  await assert.rejects(exportAudio({ ffmpeg: ff, ffprobe: fp, source: master, output: path.join(root, 'overlap.wav'), format: 'wav', chapters: [{ ...ranges[0], end: '00:00:03.500' }, ...ranges.slice(1)] }), /end timestamp/i);
});
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
  const child=spawn(process.execPath,[path.resolve('dist/server.cjs')],{env:{...process.env,SWISSMOUSE_RUNTIME_MODE:'managed',APP_ROOT:appRoot,NODE_ENV:'production',PORT:String(port)},windowsHide:true,stdio:'pipe'});
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  const base='http://127.0.0.1:'+port;
  const request=async(url:string,body?:unknown)=>{const response=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const bodyText=await response.text();let data:any;try{data=JSON.parse(bodyText);}catch{throw new Error(url+' returned '+response.status+': '+bodyText+'\n'+logs);}assert.ok(response.ok,JSON.stringify(data));return data;};
  const requestExport=async(jobId:string,body:any)=>{
    const url=base+'/api/jobs/'+jobId+'/build-m4b';
    const post=async(payload:any)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    let response=await post(body);
    let data:any=await response.json();
    if(data.requiresOverwriteConfirmation){
      assert.equal(response.status,409);
      assert.ok(data.existingFiles.every((file:string)=>fs.existsSync(file)));
      response=await post({...body,overwriteExisting:true,confirmedOverwritePaths:data.existingFiles});
      data=await response.json();
    }
    assert.ok(response.ok,JSON.stringify(data));
    return data;
  };
  try {
    let ready=false;for(let i=0;i<80;i++){try{await request('/api/jobs');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
    assert.ok(ready,logs);
    const source=path.join(root,'export.m4b');const original=await fingerprint([source],{});
    const job=await request('/api/jobs',{name:'API fixture',author:'Project author',narrator:'Project narrator',parts:[{name:source}]});
    assert.equal((await fetch(base+'/api/jobs/'+job.id+'/export/open-folder',{method:'POST'})).status,400,'unfinished projects cannot open an export folder');
    let mediaReady=false;
    for(let attempt=0;attempt<3;attempt++){
      const status=await request('/api/requirements/status?refresh=true');
      mediaReady=['ffmpeg','ffprobe'].every(id=>status.components.some((item:any)=>item.id===id&&item.status==='ready'));
      if(mediaReady)break;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    assert.ok(mediaReady,'managed media tools are ready before processing the fixture');
    await request('/api/config',{audiobookshelf_metadata:true});
    await request('/api/jobs/'+job.id+'/process-step1',{chapterSource:'existing_files',generateWaveform:true});
    let updated:any;
    for(let i=0;i<100;i++){updated=await request('/api/jobs/'+job.id);if(updated.status==='transcribed')break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(updated.status,'transcribed',logs);
    assert.equal(updated.mergedMp3.fullPath,source);
    assert.equal(updated.existingChapters.length,3);
    assert.deepEqual([updated.metadata.title,updated.metadata.author,updated.metadata.narrator],['API fixture','Project author','Project narrator']);
    assert.ok(updated.metadata.cover.url.startsWith('data:image/'));
    const range=await fetch(base+'/api/jobs/'+job.id+'/audio-preview',{headers:{Range:'bytes=1000-1999'}});
    assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,1000);
    const waveform = await fetch(base+'/api/jobs/'+job.id+'/waveform?start=0&duration=300&pixels=800');
    assert.equal(waveform.status, 200);
    const peaks = await waveform.json();
    assert.ok(peaks.peaks.length > 0 && peaks.peaks.length <= 3201);
    assert.ok(Math.abs(peaks.duration - 9) < 0.15);
    const invalidWaveform = await fetch(base+'/api/jobs/'+job.id+'/waveform?start=-1&duration=300&pixels=800');
    assert.equal(invalidWaveform.status, 400);
    const exports=await request('/api/jobs/'+job.id+'/build-m4b',{outputFormats});
    assert.equal(exports.exports.length,7);
    assert.ok(exports.exports.every((e:any)=>e.status==='success'),JSON.stringify(exports));
    const exportedCover=exports.exports[0].coverPath;
    assert.equal(path.basename(exportedCover),'cover.png');
    assert.equal(path.dirname(exportedCover),path.dirname(exports.exports[0].fullPath));
    assert.deepEqual(fs.readFileSync(exportedCover),Buffer.from(updated.metadata.cover.url.split(',')[1],'base64'));
    assert.ok(exports.exports.every((e:any)=>e.coverPath===exportedCover));
    assert.equal(await fingerprint([source],{}),original);
    const pendingCheck=fetch(base+'/api/jobs/'+job.id+'/validate',{method:'POST'});
    let checkRunning=false;
    for(let attempt=0;attempt<40;attempt++){
      if((await request('/api/jobs/'+job.id+'/final-check')).running){checkRunning=true;break;}
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.ok(checkRunning,'long audio checks expose progress');
    await request('/api/jobs/'+job.id+'/final-check/cancel',{});
    assert.equal((await (await pendingCheck).json()).status,'cancelled');
    assert.equal((await request('/api/jobs/'+job.id+'/final-check')).report.state,'cancelled');
    const validation=await request('/api/jobs/'+job.id+'/validate',{});assert.equal(validation.validation.status,'PASS',JSON.stringify(validation.finalCheck?.items.filter((item:any)=>item.status==='failed')));
    assert.equal(validation.finalCheck.state,'complete');
    assert.equal(validation.finalCheck.files.length,7);
    assert.ok(validation.finalCheck.items.some((item:any)=>item.id==='file-0-decode'&&item.status==='passed'));
    assert.equal((await request('/api/jobs/'+job.id+'/final-check')).outdated,false);
    const extendedSidecar=path.join(path.dirname(exports.exports[0].fullPath),'exmetadata.json');
    fs.unlinkSync(extendedSidecar);
    assert.equal((await request('/api/jobs/'+job.id+'/final-check')).outdated,true);
    assert.equal((await request('/api/jobs/'+job.id+'/validate',{})).validation.status,'FAIL');
    await request('/api/jobs/'+job.id+'/final-check/repair',{kind:'sidecar'});
    assert.ok(fs.existsSync(extendedSidecar));
    fs.unlinkSync(exportedCover);
    await request('/api/jobs/'+job.id+'/final-check/repair',{kind:'cover'});
    assert.ok(fs.existsSync(exportedCover));
    assert.equal((await request('/api/jobs/'+job.id+'/validate',{})).validation.status,'PASS');
    const firstPath=exports.exports.find((item:any)=>item.format==='m4b').fullPath;
    const sidecar=path.join(path.dirname(firstPath),'metadata.json');
    assert.ok(fs.existsSync(sidecar),'export writes Audiobookshelf metadata.json beside the audiobook');
    assert.ok(!fs.existsSync(firstPath+'.ffmeta'),'working FFmetadata is not left beside the audiobook');
    const initialJson=JSON.parse(fs.readFileSync(sidecar,'utf8'));
    assert.equal(initialJson.title,'API fixture');
    assert.deepEqual(initialJson.authors,['Project author']);
    assert.deepEqual(initialJson.narrators,['Project narrator']);
    assert.ok(Array.isArray(initialJson.genres) && Array.isArray(initialJson.tags));
    const firstHash=await fingerprint([firstPath],{});
    const declined=await fetch(base+'/api/jobs/'+job.id+'/build-m4b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outputFormats:['m4b']})});
    assert.equal(declined.status,409);
    assert.deepEqual((await declined.json()).existingFiles,[firstPath]);
    assert.equal(await fingerprint([firstPath],{}),firstHash,'unconfirmed export leaves the audiobook intact');
    const staleApproval=await fetch(base+'/api/jobs/'+job.id+'/build-m4b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outputFormats:['m4b'],overwriteExisting:true,confirmedOverwritePaths:['a different file']})});
    assert.equal(staleApproval.status,409,'approval must identify the exact file being replaced');
    await request('/api/jobs/'+job.id+'/metadata',{metadata:{...updated.metadata,title:'Edited book',narrator:'Edited narrator',series:'Edited series',cover:null}});
    assert.equal(JSON.parse(fs.readFileSync(sidecar,'utf8')).title,'Edited book','Save Metadata updates the adjacent JSON');
    fs.writeFileSync(sidecar,'{}');
    const refreshedJson=await request('/api/jobs/'+job.id+'/metadata-json',{});
    assert.ok(refreshedJson.written.includes(sidecar));
    assert.ok(refreshedJson.written.includes(path.join(path.dirname(sidecar),'exmetadata.json')));
    assert.equal(JSON.parse(fs.readFileSync(sidecar,'utf8')).title,'Edited book','Update JSON repairs a stale sidecar');
    assert.equal(await fingerprint([firstPath],{}),firstHash,'Update JSON does not rewrite audio');
    const edited=await requestExport(job.id,{outputFormats:['m4b']});
    assert.equal(edited.exports[0].fullPath,firstPath,'confirmed export replaces the existing file');
    assert.equal(edited.exports[0].status,'success',JSON.stringify(edited));
    assert.equal(edited.exports[0].coverPath,undefined);
    const editedFile=inspect(fp,edited.exports[0].fullPath);
    assert.equal(editedFile.tags.title,'Edited book');assert.equal(editedFile.tags.composer,'Edited narrator');assert.equal(editedFile.tags.series,'Edited series');assert.equal(editedFile.artwork,undefined);
    const sourceChapterNames = [
      {id:'opening',title:'Prologue',start:'00:00:00.000'},
      {id:'three',title:'chapter three',start:'00:00:01.000'},
      {id:'seven',title:'CHAPTER SEVEN',start:'00:00:02.000'},
      {id:'eight',title:'Chapter Eight',start:'00:00:03.000'},
      {id:'corrected-placeholder',title:'CHAPTER XIII',start:'00:00:04.000',isMissing:false},
      {id:'manually-added',title:'Closing Notes',start:'00:00:05.000',manuallyInserted:true,titleManuallyEdited:true},
    ];
    const finalizedChapters = applyChapterNumberFormat(sourceChapterNames, 'numerical');
    const finalizedTitles = ['Prologue','Chapter 3','Chapter 7','Chapter 8','Chapter 13','Closing Notes'];
    assert.deepEqual(finalizedChapters.map(chapter=>chapter.title),finalizedTitles);
    await request('/api/jobs/'+job.id+'/chapters',{chapters:finalizedChapters});
    const reopened = await request('/api/jobs/'+job.id);
    assert.deepEqual(reopened.chapters.map((chapter:any)=>chapter.title),finalizedTitles,'reopened editor gets the saved titles');
    assert.deepEqual(readProjectState(appRoot).find((saved:any)=>saved.id===job.id).chapters.map((chapter:any)=>chapter.title),finalizedTitles,'project state persists finalized titles');
    const finalizedExport = await requestExport(job.id,{outputFormats:['m4b']});
    assert.equal(finalizedExport.exports[0].status,'success',JSON.stringify(finalizedExport));
    const embeddedChapters = inspect(fp,finalizedExport.exports[0].fullPath).chapters;
    assert.deepEqual(embeddedChapters.map((chapter:any)=>chapter.title),finalizedTitles,'embedded M4B titles match the editor exactly');
    assert.deepEqual(JSON.parse(fs.readFileSync(sidecar,'utf8')).chapters.map((chapter:any)=>chapter.title),finalizedTitles,'sidecar chapter titles match the editor');
    assert.deepEqual(embeddedChapters.map((chapter:any)=>chapter.start),reopened.chapters.map((chapter:any)=>chapter.start),'embedded chapter order and starts match');
    await request('/api/library/metadata',{changes:[{id:job.id,fields:{genres:['Science Fiction'],tags:['Aliens','Space Opera']}}]});
    assert.deepEqual(JSON.parse(fs.readFileSync(sidecar,'utf8')).tags,['Aliens','Space Opera'],'bulk save refreshes the adjacent JSON by default');
    fs.writeFileSync(sidecar,'{}');
    await request('/api/jobs/'+job.id+'/metadata-json',{});
    const bulkJson=JSON.parse(fs.readFileSync(sidecar,'utf8'));
    assert.deepEqual(bulkJson.genres,['Science Fiction']);
    assert.deepEqual(bulkJson.tags,['Aliens','Space Opera']);
    const partial=await requestExport(job.id,{outputFormats:['mp3','wav'],bitrate:'invalid'});
    assert.deepEqual(partial.exports.map((e:any)=>e.status),['failed','success']);

    // Final validation must compare the compact exported timeline, not source duration.
    await request('/api/jobs/'+job.id+'/chapters',{chapters:[
      {id:'cut-1',title:'Chapter 1',start:'00:00:00.000',end:'00:00:02.000',endManuallyEdited:true},
      {id:'cut-2',title:'Chapter 2',start:'00:00:03.000',end:'00:00:04.000',endManuallyEdited:true},
      {id:'cut-3',title:'Chapter 3',start:'00:00:05.000',end:'00:00:08.000',endManuallyEdited:true},
    ]});
    const compact = await requestExport(job.id,{outputFormats:['m4b']});
    assert.equal(compact.exports[0].status,'success',JSON.stringify(compact));
    const compactInfo = inspect(fp,compact.exports[0].fullPath);
    assert.ok(Math.abs(compactInfo.durationSeconds - 6) < 0.15);
    assert.deepEqual(compactInfo.chapters.map(chapter=>chapter.start),['00:00:00.000','00:00:02.000','00:00:03.000']);
    assert.equal((await request('/api/jobs/'+job.id+'/validate',{})).validation.status,'FAIL','older alternate formats must match the current chapter review too');
    const webpCover = path.join(root,'selected-cover.webp');
    run(['-f','lavfi','-i','color=c=green:s=32x32','-frames:v','1',webpCover]);
    const currentJob = await request('/api/jobs/'+job.id);
    await request('/api/jobs/'+job.id+'/metadata',{metadata:{...currentJob.metadata,cover:{source:'upload',url:'data:image/webp;base64,'+fs.readFileSync(webpCover).toString('base64')}}});
    const currentFormats = await requestExport(job.id,{outputFormats});
    assert.ok(currentFormats.exports.every((item:any)=>item.status==='success'),JSON.stringify(currentFormats));
    const normalizedCover = currentFormats.exports[0].coverPath;
    assert.equal(path.extname(normalizedCover),'.png');
    const pixels = (file:string) => run(['-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
    assert.deepEqual(pixels(normalizedCover),pixels(webpCover),'exported cover pixels match the selected WebP image');
    assert.equal((await request('/api/jobs/'+job.id+'/validate',{})).validation.status,'PASS');
    assert.equal(await fingerprint([source],{}),original);

    // Disabling the cover sidecar must preserve embedding and existing user files.
    assert.equal((await request('/api/config')).save_cover_beside_audio,true,'cover sidecars default on');
    const existingCoverHash = fs.readFileSync(normalizedCover);
    await request('/api/config',{save_cover_beside_audio:false});
    assert.equal((await request('/api/config')).save_cover_beside_audio,false);
    const withoutCoverSidecar = await requestExport(job.id,{outputFormats:['m4b']});
    assert.equal(withoutCoverSidecar.exports[0].status,'success',JSON.stringify(withoutCoverSidecar));
    assert.equal(withoutCoverSidecar.exports[0].coverPath,undefined);
    assert.ok(inspect(fp,withoutCoverSidecar.exports[0].fullPath).artwork,'selected artwork is still embedded');
    assert.deepEqual(fs.readFileSync(normalizedCover),existingCoverHash,'existing cover is left untouched');
    assert.ok(!fs.readdirSync(appRoot,{recursive:true}).some(name=>String(name).includes('export-cover-')),'temporary embedding artwork is cleaned up');
    const invalidCoverSetting = await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({save_cover_beside_audio:'false'})});
    assert.equal(invalidCoverSetting.status,400);
    await request('/api/config',{save_cover_beside_audio:true});

    const loose=path.join(root,'loose');fs.mkdirSync(loose);
    for(const [name,freq] of [['10',900],['2',600],['1',300]] as const) run(['-f','lavfi','-i',`sine=frequency=${freq}:sample_rate=44100:duration=3`,'-c:a','libmp3lame','-b:a','128k',path.join(loose,name+'.mp3')]);
    const tagged=path.join(root,'tagged');fs.mkdirSync(tagged);
    for(const [name,disc,track] of [['A',2,1],['B',1,10],['C',1,2]] as const)
      run(['-i',path.join(loose,'1.mp3'),'-c:a','copy','-metadata',`disc=${disc}`,'-metadata',`track=${track}`,path.join(tagged,name+'.mp3')]);
    const taggedScan=await request('/api/system/scan-folder',{folderPath:tagged});
    assert.deepEqual(taggedScan.files.map((file:any)=>file.fileName),['C.mp3','B.mp3','A.mp3']);
    fs.copyFileSync(cover,path.join(loose,'cover.png'));
    await request('/api/config',{audiobookshelf_metadata:true});
    const processBook=async(name:string,folder:string,mergeMethod='standard',chapterSource='existing_files', supplied?:any[])=>{
      const scan=await request('/api/system/scan-folder',{folderPath:folder});
      const parts=supplied || scan.files.map((f:any)=>({name:f.relativePath,sourceRelativePath:f.relativePath}));
      const book=await request('/api/jobs',{name,parts});
      await request('/api/jobs/'+book.id+'/process-step1',{sourceFolderPath:folder,mergeMethod,chapterSource,selectedModelId:'small',parts,generateWaveform:true});
      let progress:any;
      for(let i=0;i<200;i++){progress=await request('/api/step1/progress');if(!progress.isActive)break;await new Promise(r=>setTimeout(r,100));}
      assert.equal(progress.isActive,false,'Processing timed out');
      return {book:await request('/api/jobs/'+book.id),progress,scan};
    };
    const pcm=await processBook('Loose PCM',loose);
    const pathCover=await request('/api/jobs/'+pcm.book.id+'/scan-cover',{});
    assert.equal(pathCover.found,true,'path import scans its original source folder');
    assert.equal(pathCover.cover.filename,'cover.png');
    assert.equal((await request('/api/jobs/'+pcm.book.id)).metadata?.cover?.url,undefined,'scanning does not overwrite saved metadata');
    assert.equal(pcm.progress.stage,'completed',JSON.stringify(pcm.progress));
    assert.equal(pcm.book.sourceBitrate,128);
    assert.equal(pcm.book.sourceCodec,'pcm_s24le');
    assert.deepEqual(pcm.book.chapters.map((c:any)=>[c.title,c.start]),[['1','00:00:00.000'],['2','00:00:03.000'],['10','00:00:06.000']]);
    const manuallyEdited = pcm.book.chapters.map((chapter:any,index:number)=>index === 0 ? {...chapter,title:'Manual opening',titleManuallyEdited:true} : chapter);
    await request('/api/jobs/'+pcm.book.id+'/chapters',{chapters:manuallyEdited});
    const unconfirmedRerun = await fetch(base+'/api/jobs/'+pcm.book.id+'/rerun/extracting_chapters',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(unconfirmedRerun.status,409);
    assert.equal((await unconfirmedRerun.json()).requiresConfirmation,true);
    assert.equal((await request('/api/jobs/'+pcm.book.id)).chapters[0].title,'Manual opening');
    await request('/api/jobs/'+pcm.book.id+'/rerun/extracting_chapters',{confirmReplaceManualChapters:true});
    let stageRerunProgress:any;
    for(let i=0;i<100;i++){stageRerunProgress=await request('/api/step1/progress');if(!stageRerunProgress.isActive)break;await new Promise(resolve=>setTimeout(resolve,100));}
    const stageRerunBook=await request('/api/jobs/'+pcm.book.id);
    assert.equal(stageRerunProgress.stage,'completed',JSON.stringify(stageRerunProgress));
    assert.equal(stageRerunProgress.rerunStep,'extracting_chapters');
    assert.equal(stageRerunBook.chapters[0].title,'1');
    assert.equal(stageRerunBook.pipelineSteps.extracting_chapters.status,'current');
    assert.equal(stageRerunBook.pipelineSteps.generating_waveform.status,'current');
    assert.ok(stageRerunBook.transcription == null);
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
    assert.equal(fs.existsSync(preparedMasterPath),false,'verified export clears the disposable PCM master by default');
    assert.equal(fs.existsSync(pcm.book.previewPath),false,'verified export clears review PCM while preserving book state');
    assert.equal(inspect(fp,encoded.exports[0].fullPath).bitrate,128);
    assert.ok((await request('/api/jobs/'+pcm.book.id)).logs.some((entry:any)=>entry.message.includes('MP3 export: Starting FFmpeg audio conversion')),'conversion stages reach project logs');
    const manual=await requestExport(pcm.book.id,{outputFormats:['mp3'],bitrates:{mp3:64}});
    assert.equal(inspect(fp,manual.exports[0].fullPath).bitrate,64);
    assert.equal(fs.existsSync(preparedMasterPath),false,'another export rebuilds and then clears PCM');

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
    const higher=await requestExport(quick.book.id,{outputFormats:['mp3'],convert:true,bitrates:{mp3:192}});
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
    {const checked=await request('/api/jobs/'+youtube.book.id+'/validate',{});assert.equal(checked.validation.status,'PASS',JSON.stringify(checked.finalCheck?.items.filter((item:any)=>item.status==='failed')));}
    assert.equal(await fingerprint([youtubeSource],{}),youtubeHash);
    const beforeFailedRetry=await fingerprint([youtubeExport.exports[0].fullPath],{});
    fs.writeFileSync(youtube.book.previewPath,'keep-on-failure');
    const failed=await fetch(base+'/api/jobs/'+youtube.book.id+'/build-m4b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outputFormats:['m4b'],bitrate:'invalid',overwriteExisting:true,confirmedOverwritePaths:[youtubeExport.exports[0].fullPath]})});
    assert.equal(failed.status,500);
    assert.equal(fs.readFileSync(youtube.book.previewPath,'utf8'),'keep-on-failure','failed export does not clear PCM');
    assert.equal((await request('/api/jobs/'+youtube.book.id)).outputM4b.fullPath,youtubeExport.exports[0].fullPath,'failed conversion keeps the previous export');
    assert.equal(await fingerprint([youtubeExport.exports[0].fullPath],{}),beforeFailedRetry,'failed conversion does not alter the existing audiobook');

    const uploadedJob=await request('/api/jobs',{name:'Folder upload',parts:[]});
    const form=new FormData();
    for(const name of ['01/1.mp3','01/2.mp3','02/1.mp3'])form.append('files',new Blob([fs.readFileSync(path.join(loose,'1.mp3'))]),name);
    form.append('cover',new Blob([fs.readFileSync(cover)],{type:'image/png'}),'cover.png');
    const uploadResponse=await fetch(base+'/api/upload-audio?jobId='+uploadedJob.id,{method:'POST',body:form});
    assert.ok(uploadResponse.ok);const upload:any=await uploadResponse.json();
    assert.equal(new Set(upload.files.map((f:any)=>f.filename)).size,3);
    assert.deepEqual(upload.files.map((f:any)=>f.originalName),['01/1.mp3','01/2.mp3','02/1.mp3']);
    const importMessages=(await request('/api/jobs/'+uploadedJob.id)).logs.map((entry:any)=>entry.message);
    assert.ok(importMessages.some((message:string)=>message.includes('Copying "01/1.mp3"')));
    assert.ok(importMessages.some((message:string)=>message.includes('Validated "01/1.mp3"')));
    assert.ok(importMessages.some((message:string)=>message.includes('Committed 3/3')));
    assert.ok(importMessages.at(-1).includes('Completed: 3 file(s)'));
    const masterLogs=await request('/api/logs');
    assert.ok(masterLogs.some((entry:any)=>entry.message.includes('[Folder upload] Audio import: Copying "01/1.mp3"')));
    assert.ok(masterLogs.some((entry:any)=>entry.message.includes('[Step 1 '+job.id+']')));
    assert.ok(masterLogs.some((entry:any)=>entry.message.includes("Job 'API fixture' initialized")));
    const uploadedParts=upload.files.map((f:any)=>({name:f.filename,sourceRelativePath:f.originalName}));
    await request('/api/jobs/'+uploadedJob.id+'/step1-settings',{sourceFolderPath:upload.uploadDir,parts:uploadedParts});
    const uploadedCover=await request('/api/jobs/'+uploadedJob.id+'/scan-cover',{});
    assert.equal(uploadedCover.found,true,'browser folder import retains its selected cover');
    assert.match(uploadedCover.cover.filename,/^cover-[a-f0-9-]+\.png$/);
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
    assert.deepEqual(whisperError.missingRequirements,['Python Runtime','Faster Whisper','CTranslate2']);
    const whisper=await request('/api/jobs/'+whisperJob.id);
    assert.ok(!whisper.transcription);assert.ok(!whisper.transcriptWords?.length);
    assert.match(whisper.logs.at(-1).message,/Step 1 processing failed.*Missing requirements/);

    // Folder relocation follows saved metadata without touching the original source audio.
    fs.writeFileSync(path.join(path.dirname(firstPath),'book-notes.txt'),'Unassociated notes stay in place.');
    const beforeMove=await request('/api/jobs/'+job.id);
    await request('/api/jobs/'+job.id+'/metadata',{metadata:{...beforeMove.metadata,title:'Renamed for folder move',author:'Moved Author'}});
    const preview=await request('/api/jobs/'+job.id+'/export-folder-move');
    assert.equal(preview.moves.length,1);
    assert.equal(preview.moves[0].from,path.dirname(firstPath));
    assert.match(preview.moves[0].to,/Moved Author/);
    fs.mkdirSync(preview.moves[0].to,{recursive:true});
    const collision=await fetch(base+'/api/jobs/'+job.id+'/export-folder-move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmedMoves:preview.moves})});
    assert.equal(collision.status,409,'an existing destination is never overwritten');
    assert.ok(fs.existsSync(firstPath),'a collision leaves the old audiobook in place');
    fs.rmdirSync(preview.moves[0].to);
    const moved=await request('/api/jobs/'+job.id+'/export-folder-move',{confirmedMoves:preview.moves});
    assert.deepEqual(moved.moved,preview.moves);
    const relocated=await request('/api/jobs/'+job.id);
    assert.equal(path.dirname(relocated.outputM4b.fullPath),preview.moves[0].to);
    assert.ok(Object.values(relocated.exportedFiles).every((file:any)=>path.dirname(file)===preview.moves[0].to));
    assert.equal(fs.existsSync(path.join(preview.moves[0].to,'book-notes.txt')),false,'unassociated notes are excluded from the transfer');
    assert.equal(fs.readFileSync(path.join(preview.moves[0].from,'book-notes.txt'),'utf8'),'Unassociated notes stay in place.');
    assert.equal(JSON.parse(fs.readFileSync(path.join(preview.moves[0].to,'metadata.json'),'utf8')).title,'Renamed for folder move');
    assert.ok(fs.existsSync(preview.moves[0].from),'nonempty old book folder is retained');
    assert.ok(fs.existsSync(path.dirname(preview.moves[0].from)),'nonempty old author folder is retained');
    assert.equal(await fingerprint([source],{}),original,'source audio remains unchanged');
    const afterMoveExport=await requestExport(job.id,{outputFormats:['m4b']});
    assert.equal(path.dirname(afterMoveExport.exports[0].fullPath),preview.moves[0].to,'the next export reuses the moved audiobook path');
    assert.equal(JSON.parse(fs.readFileSync(path.join(preview.moves[0].to,'metadata.json'),'utf8')).title,'Renamed for folder move');
    const oldAuthorFolder=path.dirname(preview.moves[0].to);
    fs.writeFileSync(path.join(oldAuthorFolder,'keep.txt'),'another file');
    await request('/api/jobs/'+job.id+'/metadata',{metadata:{...(await request('/api/jobs/'+job.id)).metadata,author:'Another Author'}});
    const secondMove=await request('/api/jobs/'+job.id+'/export-folder-move');
    await request('/api/jobs/'+job.id+'/export-folder-move',{confirmedMoves:secondMove.moves});
    assert.ok(!fs.existsSync(secondMove.moves[0].from));
    assert.ok(fs.existsSync(path.join(oldAuthorFolder,'keep.txt')),'nonempty old parent folders are preserved');

    // Moving a series from either book includes its exported siblings, while
    // leaving unrelated files in the old parent directory alone.
    const series="The Hitchhiker's Guide to the Galaxy";
    const firstSeriesMetadata=(await request('/api/jobs/'+job.id)).metadata;
    const quickSeriesMetadata=(await request('/api/jobs/'+quick.book.id)).metadata;
    await request('/api/jobs/'+job.id+'/metadata',{metadata:{...firstSeriesMetadata,author:'Series Author',series}});
    await request('/api/jobs/'+quick.book.id+'/metadata',{metadata:{...quickSeriesMetadata,author:'Series Author',series}});
    const seriesPreview=await request('/api/jobs/'+quick.book.id+'/export-folder-move');
    assert.equal(seriesPreview.moves.length,2,'a series move includes both exported books');
    assert.deepEqual(new Set(seriesPreview.moves.map((move:any)=>move.jobId)),new Set([job.id,quick.book.id]));
    const samePreview=await request('/api/jobs/'+job.id+'/export-folder-move');
    assert.deepEqual(samePreview.moves,seriesPreview.moves,'the series has one stable move plan from either book');
    const existingSeriesFolder=path.dirname(seriesPreview.moves[0].to);
    fs.mkdirSync(existingSeriesFolder,{recursive:true});
    fs.writeFileSync(path.join(existingSeriesFolder,'existing-book.txt'),'Keep existing series contents.');
    const seriesMoved=await request('/api/jobs/'+quick.book.id+'/export-folder-move',{confirmedMoves:seriesPreview.moves});
    assert.deepEqual(seriesMoved.moved,seriesPreview.moves);
    assert.ok(fs.existsSync(path.join(existingSeriesFolder,'existing-book.txt')),'existing series contents remain in place');
    for (const bookId of [job.id,quick.book.id]) {
      const updated=await request('/api/jobs/'+bookId);
      assert.ok(fs.existsSync(updated.exports.find((item:any)=>item.status==='success').fullPath));
      assert.match(updated.outputM4b?.fullPath || updated.exports.find((item:any)=>item.status==='success').fullPath,/Series Author/);
      assert.ok(Object.values(updated.exportedFiles).every((file:any)=>fs.existsSync(file)));
    }
    assert.equal((await request('/api/jobs/'+job.id+'/export-folder-move')).moves.length,0);

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
  } finally { await stopTestServer(child); }
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
async function exportMetadataFixture(format: typeof outputFormats[number], prefix: string) {
  const output=path.join(root,`${prefix}.${format}`);
  await exportAudio({ffmpeg:ff,ffprobe:fp,source:master,output,format,chapters,tags:audiobookTags(metadataFixture.metadata,undefined,{},format)});
  const info=inspect(fp,output);
  const tags=Object.fromEntries(Object.entries(info.tags).map(([k,v])=>[k.toLowerCase(),v]));
  return {info,tags};
}

test('all friendly metadata fields survive each container (local fixture)',async()=>{
  for(const format of outputFormats){
    const {info,tags}=await exportMetadataFixture(format,'metadata');
    const names: Record<string,string> = metadataFixture.tagNamesByFormat[format] || {};
    for(const [key,value] of Object.entries(metadataFixture.expectedTags)) assert.equal(tags[names[key] || key],value,format+' '+key);
    assert.equal(tags[metadataFixture.descriptionTagByFormat[format]],metadataFixture.metadata.description,format+' description');
    assert.equal(info.chapters.length,chapters.length);
  }
});

const absReference=process.env.TEST_ABS_PROBER || path.resolve('audio-test-reference/prober.cjs');
test('exported metadata is compatible with the external Audiobookshelf parser',{
  skip: !fs.existsSync(absReference) && `Optional Audiobookshelf parser not found at ${absReference}; set TEST_ABS_PROBER to prober.js to enable this compatibility check. Local metadata read-back is tested separately.`,
},async()=>{
  const code=fs.readFileSync(absReference,'utf8');
  const grab=code.slice(code.indexOf('function tryGrabTags('),code.indexOf('function parseMediaStreamInfo('));
  const parse=code.slice(code.indexOf('function parseTags('),code.indexOf('function getDefaultAudioStream('));
  const absParse=vm.runInNewContext(grab+'\n'+parse+'\nparseTags');
  for(const format of outputFormats){
    const {tags}=await exportMetadataFixture(format,'metadata-abs');
    const read=absParse({tags});
    for(const [key,value] of Object.entries(metadataFixture.expectedParserOutput)) assert.equal(read[key],value,format+' '+key);
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
