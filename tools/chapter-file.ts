import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SaxesParser } from 'saxes';
import type { ChapterEntry } from '../src/types';
import { formatTimestampMs } from '../src/utils/chapters';
import { parseTimestampToMs } from '../src/utils/wordAlignment';

export type ChapterAudioSource = { file: string; durationSeconds: number; chapters: ChapterEntry[] };
export const CHAPTER_FILE_EXTENSIONS = ['.cue','.m3u','.m3u8','.pls','.xspf','.wpl','.asx','.ffmeta','.ffmetadata','.txt','.xml','.vtt'];
const key = (file: string) => path.resolve(file).toLowerCase();
type Xml = { name: string; text: string; attrs: Record<string,string>; children: Xml[] };
function xmlTree(text: string): Xml {
  const parser = new SaxesParser(); const stack: Xml[] = []; let root: Xml | undefined; let count = 0;
  // Saxes never loads an external DTD. Accept ordinary Matroska declarations,
  // but reject internal subsets and custom entity definitions.
  parser.on('doctype', value => { if(value.includes('[')||/ENTITY/i.test(value))throw new Error('XML internal document types and entities are not supported.'); });
  parser.on('opentag', tag => {
    if (++count > 30000 || stack.length > 64) throw new Error('Chapter XML is too complex.');
    const node: Xml = { name:tag.name.split(':').pop()!.toLowerCase(), text:'', attrs:tag.attributes as Record<string,string>, children:[] };
    if (stack.length) stack[stack.length-1].children.push(node); else root=node;
    stack.push(node);
  });
  parser.on('text', value => { if(stack.length)stack[stack.length-1].text+=value; });
  parser.on('cdata', value => { if(stack.length)stack[stack.length-1].text+=value; });
  parser.on('closetag', () => { stack.pop(); });
  parser.write(text).close(); if(!root)throw new Error('The XML file is empty.'); return root;
}
const children = (node:Xml,name:string)=>node.children.filter(child=>child.name===name);
const childText = (node:Xml,name:string)=>children(node,name)[0]?.text.trim() || '';
const descendants = (node:Xml,name:string):Xml[]=>node.children.flatMap(child=>[...(child.name===name?[child]:[]),...descendants(child,name)]);
function chapterTime(value:string) {
  if(!/^\d+:([0-5]\d):([0-5]\d)(?:\.\d+)?$/.test(value))throw new Error('Invalid chapter timestamp.');
  return parseTimestampToMs(value);
}

export function validateImportedChapters(chapters: ChapterEntry[], total: number): ChapterEntry[] {
  if(!chapters.length || chapters.length>10000)throw new Error('The file must contain between 1 and 10,000 chapters.');
  let previous=-1;
  return chapters.map((chapter,index)=>{
    const start=parseTimestampToMs(chapter.start);
    if(!Number.isFinite(start)||start<0||start<=previous||start>=Math.round(total*1000))throw new Error(`Chapter ${index+1} has an invalid, out-of-order, or out-of-range start.`);
    previous=start;
    return {...chapter,id:`imported-${index}`,start:formatTimestampMs(start),title:chapter.title.trim()||`Chapter ${index+1}`};
  });
}

/** Parse bounded local chapter/playlist data. References only resolve to existing project inputs. */
export function parseChapterFile(name:string,content:string,sources:ChapterAudioSource[],directory:string): {chapters:ChapterEntry[];kind:'markers'|'tracks';format:string} {
  if(Buffer.byteLength(content,'utf8')>1024*1024)throw new Error('Choose a chapter or playlist file smaller than 1 MiB.');
  const extension=path.extname(name).toLowerCase();
  if(!CHAPTER_FILE_EXTENSIONS.includes(extension))throw new Error('Unsupported chapter or playlist file type.');
  const text=content.replace(/^\uFEFF/,''); const lines=text.split(/\r?\n/);
  const total=sources.reduce((sum,source)=>sum+source.durationSeconds,0);
  const offsets:number[]=[];let offset=0;for(const source of sources){offsets.push(offset);offset+=source.durationSeconds*1000;}
  const resolve=(value:string)=>{
    let reference=value.trim();
    if(/^file:/i.test(reference))reference=fileURLToPath(reference);
    else if(/^[a-z][a-z\d+.-]*:/i.test(reference)&&!/^[a-z]:[\\/]/i.test(reference))throw new Error('Only local project audio is supported; remote playlist entries are not fetched.');
    const normalized=reference.replace(/[\\/]/g,path.sep);
    const absolute=path.resolve(directory,normalized);
    let matches=sources.map((source,index)=>({source,index})).filter(item=>key(item.source.file)===key(absolute));
    if(!matches.length && !/[\\/]/.test(reference))matches=sources.map((source,index)=>({source,index})).filter(item=>path.basename(item.source.file).toLowerCase()===reference.toLowerCase());
    if(matches.length!==1)throw new Error(`Playlist entry does not uniquely match selected project audio: ${value}`);
    return matches[0].index;
  };
  let chapters:ChapterEntry[]=[];let kind:'markers'|'tracks'='markers';
  const marker=(start:number,title:string)=>{
    if(!Number.isFinite(start)||start<0||!Number.isSafeInteger(Math.round(start)))throw new Error('Invalid chapter timestamp.');
    return {id:'',start:formatTimestampMs(start),title};
  };
  const trackList=(tracks:{file:string;title?:string}[])=>{
    kind='tracks';
    const indexes=tracks.map(track=>resolve(track.file));
    if(indexes.length!==sources.length||new Set(indexes).size!==sources.length)throw new Error('The playlist must reference every selected audio file exactly once, without extra files.');
    if(indexes.some((index,position)=>index!==position))throw new Error('Playlist order differs from Processing Order. Reorder the project files to match, then import again.');
    chapters=tracks.map((track,index)=>marker(offsets[index],track.title||path.parse(sources[index].file).name));
  };
  if(extension==='.cue'){
    let current:number|undefined;let title='';let inTrack=false;const referenced=new Set<number>();
    for(const line of lines){
      const file=/^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+\S+/i.exec(line);
      if(file){current=resolve(file[1]||file[2]);referenced.add(current);inTrack=false;}
      if(/^\s*TRACK\s+\d+\s+AUDIO\s*$/i.test(line)){inTrack=true;title='';}
      const named=/^\s*TITLE\s+(?:"(.*)"|(.*))\s*$/i.exec(line);if(named&&inTrack)title=named[1]??named[2];
      const index=/^\s*INDEX\s+01\s+(\d+):(\d{2}):(\d{2})\s*$/i.exec(line);
      if(index&&inTrack){
        if(current===undefined||+index[2]>=60||+index[3]>=75)throw new Error('Invalid CUE index.');
        const local=(+index[1]*60+ +index[2]+ +index[3]/75)*1000;
        if(local>=sources[current].durationSeconds*1000)throw new Error('CUE index exceeds the corresponding audio.');
        chapters.push(marker(offsets[current]+local,title||`Chapter ${chapters.length+1}`));
      }
    }
    if(referenced.size!==sources.length)throw new Error('The CUE file must reference every selected audio file.');
  }else if(extension==='.m3u'||extension==='.m3u8'){
    if(/^#EXT-X-/im.test(text))throw new Error('Streaming HLS playlists are not local chapter lists.');
    const tracks:{file:string;title?:string}[]=[];let title='';
    for(const raw of lines){const line=raw.trim();if(/^#EXTINF:/i.test(line)){title=line.slice(line.indexOf(',')+1);continue;}if(line&&!line.startsWith('#')){tracks.push({file:line,title});title='';}}
    trackList(tracks);
  }else if(extension==='.pls'){
    if(!/^\s*\[playlist\]/im.test(text))throw new Error('Invalid PLS playlist.');
    const entries=new Map<number,{file:string;title?:string}>();
    for(const line of lines){const match=/^\s*(File|Title)(\d+)\s*=(.*)$/i.exec(line);if(match){const index=+match[2];const entry=entries.get(index)||{file:''};const field=match[1].toLowerCase();if(field==='file'&&entry.file)throw new Error('Duplicate PLS entry.');if(field==='file')entry.file=match[3].trim();else entry.title=match[3].trim();entries.set(index,entry);}}
    const declared=/^\s*NumberOfEntries\s*=\s*(\d+)\s*$/im.exec(text);
    if(declared&&+declared[1]!==entries.size)throw new Error('PLS entry count does not match its files.');
    trackList([...entries].sort((a,b)=>a[0]-b[0]).map(([,entry])=>entry));
  }else if(['.xspf','.wpl','.asx','.xml'].includes(extension)){
    const root=xmlTree(text);
    if(root.name==='playlist')trackList(children(children(root,'tracklist')[0]||{...root,children:[]},'track').map(track=>{
      const locations=children(track,'location');if(locations.length!==1)throw new Error('Each XSPF track needs one unambiguous local location.');return{file:locations[0].text.trim(),title:childText(track,'title')};
    }));
    else if(root.name==='smil')trackList(descendants(root,'media').map(media=>({file:media.attrs.src||''})));
    else if(root.name==='asx')trackList(children(root,'entry').map(entry=>{const refs=children(entry,'ref');if(refs.length!==1)throw new Error('Each ASX entry needs one local reference.');return{file:refs[0].attrs.href||refs[0].attrs.HREF||'',title:childText(entry,'title')};}));
    else if(root.name==='chapters'){
      if(children(root,'editionentry').length!==1)throw new Error('Choose chapter XML with one edition.');
      chapters=descendants(root,'chapteratom').filter(atom=>!children(atom,'chapteratom').length).map(atom=>{
        const start=chapterTime(childText(atom,'chaptertimestart'));
        return marker(start,childText(children(atom,'chapterdisplay')[0]||atom,'chapterstring'));
      });
    }else throw new Error('Unsupported XML playlist or chapter structure.');
  }else if(extension==='.ffmeta'||extension==='.ffmetadata'||/^;FFMETADATA1\s*$/m.test(text)){
    if(!/^;FFMETADATA1\s*$/m.test(text))throw new Error('Invalid FFmetadata header.');
    for(const section of text.split(/^\[CHAPTER\]\s*$/m).slice(1)){
      const values=Object.fromEntries(section.split(/^\[[^\]]+\]\s*$/m)[0].split(/\r?\n/).flatMap(line=>{const match=/^([A-Za-z]+)=(.*)$/.exec(line);return match?[[match[1].toUpperCase(),match[2]]]:[];}));
      const base=/^(\d+)\/(\d+)$/.exec(values.TIMEBASE||'1/1000000000');
      if(!base||!+base[2]||!/^\d+$/.test(values.START||''))throw new Error('Invalid FFmetadata chapter timebase or start.');
      chapters.push(marker(Number(values.START)*Number(base[1])/Number(base[2])*1000,(values.TITLE||'').replace(/\\([\\=;#])/g,'$1')));
    }
  }else if(extension==='.vtt'){
    if(!/^WEBVTT(?:\s|$)/.test(text))throw new Error('Invalid WebVTT header.');
    for(const block of text.split(/\r?\n\s*\r?\n/)){
      const rows=block.split(/\r?\n/);const index=rows.findIndex(line=>line.includes('-->'));if(index<0)continue;
      let time=rows[index].split('-->')[0].trim();if(/^\d{2}:\d{2}\.\d{3}$/.test(time))time='00:'+time;
      const start=chapterTime(time);
      chapters.push(marker(start,rows.slice(index+1).join(' ').replace(/<[^>]*>/g,'')));
    }
  }else {
    const starts=new Map<string,string>();const titles=new Map<string,string>();
    for(const line of lines){const match=/^CHAPTER(\d+)(NAME)?=(.*)$/i.exec(line.trim());if(match)(match[2]?titles:starts).set(match[1],match[3]);}
    if(starts.size)chapters=[...starts].sort((a,b)=>+a[0]-+b[0]).map(([id,time])=>marker(chapterTime(time),titles.get(id)||''));
    else for(const line of lines.filter(line=>line.trim())){const match=/^(\d+:\d{2}:\d{2}(?:\.\d+)?)\s+(.+)$/.exec(line.trim());if(!match)throw new Error('Use OGM chapter text or HH:MM:SS.mmm followed by a chapter title.');chapters.push(marker(chapterTime(match[1]),match[2]));}
  }
  return {chapters:validateImportedChapters(chapters,total),kind,format:extension.slice(1).toUpperCase()};
}
