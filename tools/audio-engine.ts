import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { canCopy, outputFormats, type ExportFormat } from '../src/audioFormats';
import { preserveMp4Metadata } from './mp4-metadata';
import { writeWavMetadata } from './wav-metadata';
import { PcmAnalysis } from './audio-analysis';
const run = promisify(execFile);
function readWavCues(file: string, rate: number) {
  const fd=fs.openSync(file,'r'); const points=new Map<number,number>();const labels=new Map<number,string>();
  try {
    const size=fs.statSync(file).size;let dataSize=0;
    for(let pos=12;pos+8<=size;) {
      const header=Buffer.alloc(8);fs.readSync(fd,header,0,8,pos);const type=header.toString('ascii',0,4);let length=header.readUInt32LE(4);
      if(type==='data' && length===0xffffffff) length=dataSize;
      if(!length || pos+8+length>size) break;
      if(['ds64','cue ','LIST'].includes(type) && length<16e6) {
        const b=Buffer.alloc(length);fs.readSync(fd,b,0,length,pos+8);
        if(type==='ds64') dataSize=Number(b.readBigUInt64LE(8));
        if(type==='cue ') for(let i=0;i<b.readUInt32LE(0);i++){const p=4+i*24;if(p+24<=b.length) points.set(b.readUInt32LE(p),b.readUInt32LE(p+20));}
        if(type==='LIST' && b.toString('ascii',0,4)==='adtl') for(let p=4;p+8<=b.length;){const n=b.readUInt32LE(p+4);if(p+8+n>b.length) break;if(b.toString('ascii',p,p+4)==='labl' && n>=4) labels.set(b.readUInt32LE(p+8),b.toString('utf8',p+12,p+8+n).replace(/\0+$/,''));p+=8+n+(n%2);}
      }
      pos+=8+length+(length%2);
    }
  } finally {fs.closeSync(fd);}
  return [...points].map(([id,samples])=>({id:'cue-'+id,start:timestamp(samples/rate),title:labels.get(id)||'Cue '+id}));
}
export const timestamp = (seconds: number) => {
  const ms = Math.round(seconds * 1000);
  return `${Math.floor(ms / 3600000).toString().padStart(2, '0')}:${Math.floor(ms / 60000) % 60}`.replace(/:(\d)$/, ':0$1') + `:${(Math.floor(ms / 1000) % 60).toString().padStart(2, '0')}.${(ms % 1000).toString().padStart(3, '0')}`;
};
export function seconds(value: string) {
  if (!/^\d+:\d{2}:\d{2}\.\d{3}$/.test(value)) throw new Error(`Invalid timestamp: ${value}`);
  const [h, m, s] = value.split(':').map(Number);
  if (m >= 60 || s >= 60) throw new Error(`Invalid timestamp: ${value}`);
  return h * 3600 + m * 60 + s;
}
export function inspect(probe: string, file: string) {
  const data = JSON.parse(execFileSync(probe, ['-v', 'error', '-show_format', '-show_streams', '-show_data_hash', 'sha256', '-show_chapters', '-of', 'json', file], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 }));
  const audio = data.streams?.find((s: any) => s.codec_type === 'audio');
  let duration = Number(audio?.duration || data.format?.duration);
  // Raw ADTS has no duration header. FFprobe's bitrate estimate can be wildly wrong for VBR.
  if (data.format?.format_name === 'aac' && audio) {
    const frames = JSON.parse(execFileSync(probe, ['-v', 'error', '-select_streams', 'a:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'json', file], {encoding:'utf8', windowsHide:true}));
    const first = JSON.parse(execFileSync(probe, ['-v','error','-select_streams','a:0','-read_intervals','%+#1','-show_frames','-show_entries','frame=nb_samples','-of','json',file],{encoding:'utf8',windowsHide:true}));
    duration = Number(frames.streams[0].nb_read_frames) * Number(first.frames[0].nb_samples) / Number(audio.sample_rate);
  }
  if (!audio || !Number.isFinite(duration) || duration <= 0) throw new Error('No readable audio stream with a measured duration');
  const tags = { ...audio.tags, ...data.format.tags };
  const chapters = (data.chapters || []).map((c: any, i: number) => ({ id: `existing-${i}`, start: timestamp(Number(c.start_time)), end: timestamp(Number(c.end_time)), title: c.tags?.title || `Chapter ${i + 1}` }));
  if (!chapters.length) for (const key of Object.keys(tags).sort()) {
    if (/^chapter\d+$/i.test(key)) chapters.push({ id: key, start: tags[key], title: tags[`${key}NAME`] || tags[`${key}name`] || key });
  }
  const container = data.format.format_name;
  if(container==='wav' && !chapters.length) chapters.push(...readWavCues(file,Number(audio.sample_rate)));
  const ext = path.extname(file).slice(1).toLowerCase();
  const format = container.includes('mov') ? (ext === 'm4b' ? 'm4b' : 'm4a') : container === 'ogg' ? (audio.codec_name === 'opus' ? 'opus' : 'ogg') : container.split(',')[0];
  return { codec: audio.codec_name as string, sampleRate: Number(audio.sample_rate), channels: audio.channels as number,
    streamSignature: JSON.stringify([container,audio.codec_name,audio.profile,audio.sample_fmt,audio.sample_rate,audio.channels,audio.channel_layout,audio.time_base,audio.extradata_hash]),
    bitrate: Math.round(Number(audio.bit_rate || data.format.bit_rate || 0) / 1000), durationSeconds: duration,
    format, rawFormatName: container, tags, chapters, artwork: data.streams.find((s: any) => s.disposition?.attached_pic === 1), data, isAudio: true };
}
export async function fingerprint(files: string[], settings: unknown) {
  const hash = createHash('sha256').update(JSON.stringify(settings));
  for (const file of files) {
    hash.update('\0' + path.resolve(file) + '\0');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  }
  return hash.digest('hex');
}
const escape = (s: unknown) => String(s).replace(/([\\=;#\n\r])/g, '\\$1');
export function validateChapters(chapters: {start: string; end?: string; title: string; isMissing?: boolean}[], duration: number) {
  let previous = -1;
  if (!chapters.length) throw new Error('Review at least one chapter before exporting');
  if (seconds(chapters[0].start) !== 0) throw new Error('Add an Opening chapter at 00:00:00.000. MP4 chapter tracks require a chapter at time zero.');
  for (let index = 0; index < chapters.length; index++) {
    const chapter = chapters[index];
    const start = seconds(chapter.start);
    const end = chapter.end ? seconds(chapter.end) : (chapters[index + 1] ? seconds(chapters[index + 1].start) - 0.001 : duration);
    const nextStart = chapters[index + 1] ? seconds(chapters[index + 1].start) : undefined;
    if (chapter.isMissing || !chapter.title.trim() || start <= previous || start >= duration) throw new Error('Chapter titles must be nonempty and starts must increase within the recording');
    if (end <= start || end > duration || (nextStart !== undefined && end >= nextStart)) throw new Error(`Invalid end timestamp for ${chapter.title}`);
    previous = start;
  }
}
export async function makePreview(ffmpeg: string, source: string, output: string, signal?: AbortSignal, log: (message: string) => void = console.warn, requireWaveform = false) {
  if(path.resolve(source).toLowerCase()===path.resolve(output).toLowerCase()) throw new Error('Analysis audio must be separate from the source');
  let analysis: PcmAnalysis | undefined;
  let waveformError: Error | undefined;
  try { analysis = new PcmAnalysis(output); } catch (e: any) { waveformError = e; log(`Waveform analysis failed: ${e.message}`); }
  try {
    await new Promise<void>((resolve, reject) => {
      // Split the existing preview PCM pass after resampling; no additional decode.
      const child = spawn(ffmpeg, ['-v', 'error', '-y', '-i', source,
        '-filter_complex', '[0:a:0]aformat=sample_fmts=s16:sample_rates=16000:channel_layouts=mono,asplit=2[preview][analysis]',
        '-map', '[preview]', '-map_metadata', '-1', '-c:a', 'pcm_s16le', '-rf64', 'auto', output,
        '-map', '[analysis]', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'], { windowsHide: true, signal });
      let error = '';
      child.stderr.on('data', chunk => { error = (error + chunk).slice(-8000); });
      child.stdout.on('data', chunk => {
        try { analysis?.push(chunk); } catch (e: any) { waveformError = e; log(`Waveform analysis failed: ${e.message}`); try { analysis?.abort(); } catch {} analysis = undefined; }
      });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error(error || 'Preview conversion failed')));
    });
    if (analysis) {
      try { await analysis.finish(); } catch (e: any) { waveformError = e; log(`Waveform analysis failed: ${e.message}`); try { analysis.abort(); } catch {} }
    }
    if (waveformError && requireWaveform) throw new Error(`Waveform generation failed: ${waveformError.message}`);
    return { waveformAvailable: !waveformError };
  } catch (e) { try { analysis?.abort(); } catch {} throw e; }
}
// Append small RIFF chunks without loading an audiobook's sample data in memory.
function wavCues(file: string, chapters: {start: string; title: string}[], rate: number) {
  const chunk = (id: string, payload: Buffer) => {
    const header = Buffer.alloc(8); header.write(id); header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload, ...(payload.length % 2 ? [Buffer.alloc(1)] : [])]);
  };
  const cues = Buffer.alloc(4 + chapters.length * 24); cues.writeUInt32LE(chapters.length);
  const labels = chapters.map((c, i) => {
    const offset = 4 + i * 24; cues.writeUInt32LE(i + 1, offset); cues.write('data', offset + 8); cues.writeUInt32LE(Math.round(seconds(c.start) * rate), offset + 20);
    const label = Buffer.alloc(4); label.writeUInt32LE(i + 1);
    return chunk('labl', Buffer.concat([label, Buffer.from(c.title + '\0')]));
  });
  fs.appendFileSync(file, Buffer.concat([chunk('cue ', cues), chunk('LIST', Buffer.concat([Buffer.from('adtl'), ...labels]))]));
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r+');
  try {
    const header = Buffer.alloc(12); fs.readSync(fd, header, 0, 12, 0);
    if (header.toString('ascii', 0, 4) === 'RF64') { const n = Buffer.alloc(8); n.writeBigUInt64LE(BigInt(size - 8)); fs.writeSync(fd, n, 0, 8, 20); }
    else { const n = Buffer.alloc(4); n.writeUInt32LE(size - 8); fs.writeSync(fd, n, 0, 4, 4); }
  } finally { fs.closeSync(fd); }
}
export async function exportAudio(options: {ffmpeg: string; ffprobe: string; source: string; output: string; format: ExportFormat; chapters: {start: string; end?: string; title: string; isMissing?: boolean}[]; tags?: Record<string, string>; cover?: string | null; convert?: boolean; bitrate?: string; cue?: boolean; onProgress?: (n: number) => void}) {
  const o = options;
  if (!outputFormats.includes(o.format)) throw new Error('Unsupported output format');
  if (path.resolve(o.source).toLowerCase() === path.resolve(o.output).toLowerCase() || fs.existsSync(o.output)) throw new Error('Output already exists; choose a new output name');
  const source = inspect(o.ffprobe, o.source);
  validateChapters(o.chapters, source.durationSeconds);
  const copy = !o.convert && !o.bitrate && canCopy(source.codec, o.format);
  const tags = Object.fromEntries(Object.entries(source.tags).map(([k,v])=>[k.toLowerCase(),String(v)]));
  for(const [key,value] of Object.entries(o.tags || {})) tags[key.toLowerCase()] = value;
  for (const key of Object.keys(tags)) if (/^chapter\d+/i.test(key) || ['major_brand', 'minor_version', 'compatible_brands', 'encoder'].includes(key)) delete tags[key];
  const tagged = ['flac', 'ogg', 'opus'].includes(o.format);
  if (tagged) o.chapters.forEach((c, i) => { const key = `CHAPTER${String(i + 1).padStart(3, '0')}`; tags[key] = c.start; tags[key + 'NAME'] = c.title; });
  let meta = ';FFMETADATA1\n' + Object.entries(tags).map(([k, v]) => `${escape(k)}=${escape(v)}\n`).join('');
  if (!tagged && o.format !== 'wav') o.chapters.forEach((c, i) => { meta += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(seconds(c.start) * 1000)}\nEND=${Math.round((c.end ? seconds(c.end) : o.chapters[i + 1] ? seconds(o.chapters[i + 1].start) - 0.001 : source.durationSeconds) * 1000)}\ntitle=${escape(c.title)}\n`; });
  const metaPath = o.output + '.ffmeta'; fs.writeFileSync(metaPath, meta);
  const args = ['-v', 'error', '-n', '-i', o.source, '-i', metaPath];
  if (o.cover) args.push('-i', o.cover);
  args.push('-map', '0:a:0', '-map_metadata', '1', '-map_metadata:s:a', '-1', '-map_chapters', tagged || o.format === 'wav' ? '-1' : '1');
  if (['m4b','m4a'].includes(o.format) && tags.language) args.push('-metadata:s:a:0', 'language=' + tags.language);
  const coverSupported = ['m4b', 'm4a', 'mp3', 'flac'].includes(o.format);
  if (coverSupported && (o.cover || (o.cover === undefined && source.artwork))) args.push('-map', o.cover ? '2:v:0' : `0:${source.artwork.index}`, '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
  const encoder = {m4b: 'aac', m4a: 'aac', mp3: 'libmp3lame', flac: 'flac', ogg: 'libvorbis', opus: 'libopus', wav: 'pcm_s16le'}[o.format];
  args.push('-c:a', copy ? 'copy' : encoder);
  if (!copy && !['flac', 'wav'].includes(o.format)) args.push('-b:a', o.bitrate || (o.format === 'mp3' ? '192k' : '96k'));
  if (['m4b', 'm4a'].includes(o.format)) args.push('-f', 'mp4');
  if (o.format === 'wav') args.push('-rf64', 'auto');
  args.push('-progress','pipe:1',o.output);
  o.onProgress?.(10);
  await new Promise<void>((resolve,reject)=>{
    const process=spawn(o.ffmpeg,args,{windowsHide:true});let error='';let pending='';let last=10;
    process.stderr.on('data',chunk=>{error=(error+chunk).slice(-8000);});
    process.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split('\n');pending=lines.pop()||'';for(const line of lines){const match=/^out_time_us=(\d+)/.exec(line);if(match){const n=Math.min(89,Math.max(10,Math.floor(Number(match[1])/1e6/source.durationSeconds*89)));if(n>last){last=n;o.onProgress?.(n);}}}});
    process.on('error',reject);process.on('close',code=>code===0?resolve():reject(new Error(error || 'FFmpeg export failed')));
  });
  if (['m4b','m4a'].includes(o.format)) preserveMp4Metadata(source.rawFormatName.includes('mov') ? o.source : undefined,o.output,tags,o.cover===null);
  if (o.format === 'wav') wavCues(o.output, o.chapters, inspect(o.ffprobe, o.output).sampleRate);
  if (o.format === 'wav') writeWavMetadata(o.output,tags);
  o.onProgress?.(90);
  const result = inspect(o.ffprobe, o.output);
  if (Math.abs(result.durationSeconds - source.durationSeconds) > 0.15) throw new Error('Output duration does not cover the complete source');
  if (result.chapters.length !== o.chapters.length || result.chapters.some((c: any, i: number) => {
    const expected = o.chapters[i];
    const expectedEnd = expected.end ? seconds(expected.end) : (o.chapters[i + 1] ? seconds(o.chapters[i + 1].start) - 0.001 : source.durationSeconds);
    const endMismatch = !tagged && o.format !== 'wav' && Math.abs(seconds(c.end) - expectedEnd) > 0.025;
    return c.title !== expected.title || Math.abs(seconds(c.start) - seconds(expected.start)) > 0.025 || endMismatch;
  })) throw new Error('Chapter read-back verification failed');
  if (o.cue !== false) {
    const clean = (s: string) => s.replace(/["\r\n]/g, ' ');
    fs.writeFileSync(o.output + '.cue', `FILE "${clean(path.basename(o.output))}" ${o.format === 'mp3' ? 'MP3' : 'WAVE'}\n` + o.chapters.map((c, i) => {
      const frames = Math.round(seconds(c.start) * 75);
      return `  TRACK ${String(i + 1).padStart(2, '0')} AUDIO\n    TITLE "${clean(c.title)}"\n    INDEX 01 ${String(Math.floor(frames / 4500)).padStart(2, '0')}:${String(Math.floor(frames / 75) % 60).padStart(2, '0')}:${String(frames % 75).padStart(2, '0')}\n`;
    }).join(''));
  }
  o.onProgress?.(100);
  const warnings: string[] = !coverSupported && (source.artwork || o.cover) ? ['Artwork cannot be embedded by this exporter; original artwork remains in the project.'] : [];
  const readTags=Object.fromEntries(Object.entries(result.tags).map(([k,v])=>[k.toLowerCase(),v]));
  const represented = (key: string, value: string) => {
    if (readTags[key] === value) return true;
    if (key === 'description' && (tagged || o.format === 'wav')) return readTags.desc === value;
    if (key === 'subtitle' && o.format === 'wav') return readTags.tit3 === value;
    return false;
  };
  const missing=Object.entries(tags).filter(([k,v])=>v && !/^chapter\d+/i.test(k) && !['handler_name','vendor_id','language'].includes(k) && !represented(k.toLowerCase(),v)).map(([k])=>k);
  if(missing.length) warnings.push('Metadata not represented exactly in this container: '+missing.join(', '));
  return { filename: path.basename(o.output), fullPath: o.output, format: o.format, duration: result.durationSeconds, sizeBytes: fs.statSync(o.output).size, codec: result.codec, bitrate: copy ? 'Original' : o.bitrate || 'Default', chaptersCount: result.chapters.length, mode: copy ? 'copy' : 'convert', warnings, verifiedTags: result.tags };
}
