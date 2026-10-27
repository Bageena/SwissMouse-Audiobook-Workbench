import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AudiobookJob, ChapterEntry, FinalCheckItem, FinalCheckReport, WorkbenchConfig } from '../src/types';
import { outputFormats, type ExportFormat } from '../src/audioFormats';
import { planChapterExport } from '../src/utils/chapterExport';
import { parseChapterTimestamp } from '../src/utils/chapters';
const parseTimestampToMs = (value: string) => parseChapterTimestamp(value) ?? NaN;
import { metadataPeople } from '../src/utils/metadataPeople';
import { cleanMemberships, extendedMetadata } from '../src/utils/extendedMetadata';
import { audiobookshelfMetadata } from '../src/utils/audiobookshelfMetadata';
import { audiobookTags } from './audiobook-metadata';
import { readManifest } from './audio-analysis';
import { checkSourceAudio } from './audio-integrity';
import { inspectAsync } from './audio-engine';

const stat = (file: string) => { try { const s=fs.statSync(file); return [file,s.size,s.mtimeMs,s.ctimeMs]; } catch { return [file,'missing']; } };
export function finalCheckSignature(job: AudiobookJob, config: WorkbenchConfig, files: string[], originals: string[], artifacts: string[]) {
  const folders=[...new Set(files.map(file=>path.dirname(file)))];
  const companions=folders.flatMap(folder=>['exmetadata.json','metadata.json','cover.jpg','cover.png'].map(name=>path.join(folder,name)));
  let metadata = job.metadata;
  if (metadata) {
    const { authors, narrators, collections, additionalSeries, ...fields } = metadata;
    // Sidecar discovery materializes contributor arrays and empty memberships.
    // Equivalent saved values must not invalidate a successful audio check.
    metadata = { ...fields, authors: metadataPeople(metadata, 'author'), narrators: metadataPeople(metadata, 'narrator'), collections: cleanMemberships(collections), additionalSeries: cleanMemberships(additionalSeries) };
  }
  return createHash('sha256').update(JSON.stringify({metadata,draft:job.metadataDraft,chapters:job.chapters,sourceKey:job.sourceKey,parts:job.parts,stale:job.staleSteps?.filter(step=>step!=='validation'),exports:job.exports,output:job.outputM4b,retainedWaveform:job.retainedWaveform,transcript:[job.transcriptKey,job.transcription,job.transcriptWords?.length,job.transcriptSegments?.length],settings:[config.audiobookshelf_metadata,config.save_cover_beside_audio],files:[...files,...originals,...companions,...artifacts].map(stat)})).digest('hex');
}

// Only compare tag fields the writer can represent in the selected container.
export function metadataTagMismatches(metadata: AudiobookJob['metadata'], tags: Record<string,unknown>, format: string) {
  if (!metadata || !outputFormats.includes(format as ExportFormat)) return { mismatches: ['Unsupported metadata format'], unsupported: [] as string[] };
  const expected=audiobookTags(metadata,undefined,{},format as ExportFormat);
  const actual=Object.fromEntries(Object.entries(tags).map(([key,value])=>[key.toLowerCase(),String(value)]));
  const wav=new Set(['title','album','artist','genre','date','comment','description','desc','copyright','subtitle']);
  const unsupported:string[]=[],mismatches:string[]=[];
  for (const [raw,value] of Object.entries(expected)) {
    const key=raw.toLowerCase();
    if (format==='wav' && !wav.has(key)) { if(value && value!=='0') unsupported.push(key); continue; }
    const aliases=key==='description' || key==='comment' || key==='desc' ? ['description','comment','desc'] : key==='subtitle' ? ['subtitle','tit3'] : key==='album_artist' ? ['album_artist','albumartist'] : [key];
    if (aliases.some(alias=>actual[alias]===value)) continue;
    // Absent false flags and cleared fields represent the same value.
    if ((!value || (['explicit','abridged'].includes(key) && value==='0')) && aliases.every(alias=>!actual[alias])) continue;
    if (key==='language' && ['m4b','m4a'].includes(format) && value==='eng' && !actual.language) continue;
    mismatches.push(key);
  }
  return {mismatches:[...new Set(mismatches)],unsupported};
}

export async function runFinalCheck(options: {
  job:AudiobookJob; config:WorkbenchConfig; files:string[]; originals:string[]; artifacts:{waveform?:string;transcript?:string};
  ffmpeg:string;ffprobe:string;signal:AbortSignal;progress:(message:string,items:FinalCheckItem[])=>void;
}) {
  const {job,config,files,originals,signal}=options;
  const items:FinalCheckItem[]=[], reports:FinalCheckReport['files']=[];
  const add=(id:string,label:string,status:FinalCheckItem['status'],detail:string,fix?:FinalCheckItem['fix'])=>{items.push({id,label,status,detail,fix:status==='passed'?undefined:fix});options.progress(label,items);};
  const exported=!!job.outputM4b;
  let originalDuration=0, originalsRead=0;
  for (const file of originals) {
    signal.throwIfAborted(); options.progress('Reading original audio duration',items);
    try { originalDuration+=(await inspectAsync(options.ffprobe,file)).durationSeconds; originalsRead++; }
    catch { /* Report unavailable comparison below; do not substitute a verified original. */ }
  }
  let plan:ReturnType<typeof planChapterExport>|undefined;
  try { plan=planChapterExport(job.chapters,job.totalDurationSeconds); }
  catch(error) {if(exported) add('timeline','Reviewed chapter timeline','failed',String((error as Error).message),'chapters');}
  const expected=exported ? plan?.durationSeconds ?? job.totalDurationSeconds : originalDuration || job.totalDurationSeconds;
  const removed=exported ? plan?.removedSeconds ?? 0 : 0;
  if(originalDuration>0 && originalsRead===originals.length && originals.length===job.parts.length) {
    const matches=Math.abs(originalDuration-job.totalDurationSeconds)<=Math.max(.15,originals.length*.03);
    add('original','Original audio timeline',matches?'passed':'failed',`${originalDuration.toFixed(3)} seconds in original files; project timeline ${job.totalDurationSeconds.toFixed(3)} seconds.`,matches?undefined:'processing');
  } else add('original','Original audio timeline','optional','Originals are unavailable or archived; a fresh comparison cannot be completed. Saved project duration is used.');
  add('cuts','Chapter Editor cuts','passed',removed>0?`${removed.toFixed(3)} seconds intentionally removed in Chapter Editor. Expected output: ${expected.toFixed(3)} seconds.`:'No intentional audio cuts in the exported timeline.');
  if (!files.length) add('outputs','Audio files','failed','No audio files are associated with this project.','processing');
  for (const [index,file] of files.entries()) {
    signal.throwIfAborted(); const name=path.basename(file),format=path.extname(file).slice(1).toLowerCase(),id=`file-${index}`;
    options.progress(`Checking file ${index+1}/${files.length}: ${name}`,items);
    try {
      const media=await inspectAsync(options.ffprobe,file);
      reports.push({file,format,duration:media.durationSeconds,chapters:media.chapters.length});
      const integrity=await checkSourceAudio(options.ffmpeg,options.ffprobe,file,signal,message=>options.progress(`${name}: ${message}`,items));
      if(integrity.encodedDurationSeconds!==undefined && Math.abs(integrity.encodedDurationSeconds-media.durationSeconds)>.15) integrity.issues.push(`Packet timeline duration ${integrity.encodedDurationSeconds.toFixed(3)}s differs from container duration ${media.durationSeconds.toFixed(3)}s.`);
      add(`${id}-decode`,`${format.toUpperCase()} audio integrity`,integrity.issues.length?'failed':'passed',integrity.issues.join('\n')||'Full decoding and packet PTS/DTS continuity verified.',integrity.issues.length?'processing':undefined);
      const tagFormat=format==='mp4'?'m4b':format;
      const comparable=outputFormats.includes(tagFormat as ExportFormat);
      const metadata=metadataTagMismatches(job.metadata,media.tags,tagFormat);
      add(`${id}-metadata`,`${format.toUpperCase()} file metadata`,!comparable?'optional':metadata.mismatches.length?'failed':'passed',!comparable?'Tag comparison is unavailable for this source format.':metadata.mismatches.length?`Does not match saved metadata: ${metadata.mismatches.join(', ')}.`:'Supported file tags match saved Metadata.', 'metadata');
      if(metadata.unsupported.length) add(`${id}-unsupported`,`${format.toUpperCase()} unsupported tags`,'optional',`These fields are retained in exmetadata.json: ${metadata.unsupported.join(', ')}.`);
      if(exported && plan) {
        const chaptersMatch=media.chapters.length===plan.chapters.length && media.chapters.every((chapter,i)=>{
          const reviewed=plan!.chapters[i];
          return chapter.title===reviewed.title && Math.abs(parseTimestampToMs(chapter.start)-parseTimestampToMs(reviewed.start))<=25 && (!['m4b','m4a','mp3'].includes(format)||!reviewed.end||Math.abs(parseTimestampToMs(chapter.end)-parseTimestampToMs(reviewed.end))<=25);
        });
        add(`${id}-chapters`,`${format.toUpperCase()} chapters`,chaptersMatch?'passed':'failed',`${media.chapters.length} embedded chapters; ${plan.chapters.length} reviewed chapters. ${chaptersMatch?'Titles and timestamps match.':'Re-export the saved chapter list.'}`,'chapters');
        const durationMatches=Math.abs(media.durationSeconds-expected)<=.15;
        add(`${id}-coverage`,`${format.toUpperCase()} audio coverage`,durationMatches?'passed':'failed',`${media.durationSeconds.toFixed(3)} seconds; expected ${expected.toFixed(3)} seconds after intentional cuts. ${durationMatches?'Within encoder timing tolerance.':`Unexpected difference: ${(media.durationSeconds-expected).toFixed(3)} seconds.`}`,'processing');
      }
      const coverExpected=!!job.metadata?.cover?.url;
      const supportsCover=!['wav','ogg','opus'].includes(format);
      add(`${id}-art`,`${format.toUpperCase()} embedded artwork`,!coverExpected||!supportsCover?'optional':media.artwork?'passed':'failed',!coverExpected?'No cover selected.':!supportsCover?'This exporter does not embed artwork in this format.':media.artwork?'Embedded artwork present.':'Selected artwork is missing.','metadata');
    } catch(error) {
      signal.throwIfAborted();
      if(!reports.some(report=>report.file===file)) reports.push({file,format,duration:0,chapters:0,error:(error as Error).message});
      add(`${id}-read`,name,'failed',`Cannot read file: ${(error as Error).message}`,'processing');
    }
  }
  if (!exported) add('source-chapters','Chapter changes','optional','Source audio was checked. Chapter edits are embedded only when you Convert.');
  for (const [index,folder] of [...new Set(files.map(file=>path.dirname(file)))].entries()) {
    for (const kind of ['extended','audiobookshelf'] as const) {
      const filename=kind==='extended'?'exmetadata.json':'metadata.json',file=path.join(folder,filename);
      if(kind==='audiobookshelf'&&!config.audiobookshelf_metadata) {add(`sidecar-${index}-${kind}`,filename,'optional','Audiobookshelf compatibility is disabled. Existing files are left untouched.');continue;}
      try {
        if(!job.metadata) throw new Error('Save Metadata first.');
        const data=JSON.parse(fs.readFileSync(file,'utf8'));
        const chapters=((exported?plan?.chapters:job.chapters)||[]) as ChapterEntry[];
        const desired=kind==='extended'?extendedMetadata(job.metadata,chapters,job.id):audiobookshelfMetadata(job.metadata,chapters);
        const differences=Object.entries(JSON.parse(JSON.stringify(desired))).flatMap(([key,value])=>{
          if (isDeepStrictEqual(data[key],value)) return [];
          if(key==='fileTags' && value && typeof value==='object') return Object.entries(value).filter(([field,v])=>{
            const actual=data.fileTags?.[field];
            if(isDeepStrictEqual(actual,v)) return false;
            if(field==='authors'||field==='narrators') return !isDeepStrictEqual(metadataPeople(data.fileTags||{},field==='authors'?'author':'narrator'),v);
            if(actual===undefined && (v===''||v===false||(Array.isArray(v)&&!v.length))) return false;
            return true;
          }).map(([field])=>'fileTags.'+field);
          return [key];
        });
        const matches=!differences.length;
        add(`sidecar-${index}-${kind}`,filename,matches?'passed':'failed',`${folder}: ${matches?'Contents match saved metadata and chapters.':`Contents differ from saved metadata or chapters: ${differences.join(', ')}.`}`,'sidecar');
      } catch(error) {add(`sidecar-${index}-${kind}`,filename,'failed',`${folder}: missing or unreadable sidecar. ${(error as Error).message}`,'sidecar');}
    }
    const coverExpected=!!job.metadata?.cover?.url;
    const coverPresent=['cover.jpg','cover.png'].some(name=>{try{return fs.statSync(path.join(folder,name)).size>0;}catch{return false;}});
    const enabled=config.save_cover_beside_audio!==false;
    add(`cover-${index}`,'Cover image beside audio',!enabled||!coverExpected?'optional':coverPresent?'passed':'failed',!enabled?'Disabled in Settings. Existing covers are left untouched.':!coverExpected?'No cover selected in Metadata.':coverPresent?`${folder}: cover.jpg or cover.png present.`:`${folder}: cover.jpg or cover.png is missing.`,!enabled?undefined:!coverExpected?'metadata':'cover');
  }
  const waveformPresent=(!!job.previewPath && !!readManifest(job.previewPath)) || (!!job.retainedWaveform && job.retainedWaveform.sourceKey === job.sourceKey && !!readManifest(job.retainedWaveform.audio,true));
  const transcriptPresent=!!(job.transcriptWords?.length || job.transcriptSegments?.length);
  add('waveform','Waveform',waveformPresent?'passed':'optional',waveformPresent?'Generated waveform is available.':'Not available; optional.','processing');
  add('transcript','Transcript',transcriptPresent?'passed':'optional',transcriptPresent?'Saved transcript is available.':'Not generated; optional.','processing');
  signal.throwIfAborted();
  return {checkedAt:new Date().toISOString(),inputSignature:'',state:'complete',items,files:reports,sourceDuration:originalDuration||job.totalDurationSeconds,expectedDuration:expected,removedSeconds:removed} satisfies FinalCheckReport;
}
