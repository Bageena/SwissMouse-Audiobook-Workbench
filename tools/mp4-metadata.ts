import fs from 'node:fs';
// Preserve iTunes metadata atoms that FFmpeg does not understand (including freeform tags).
// The export muxer leaves moov last, so replacing it does not move any audio offsets.
function atoms(buffer: Buffer, start = 0) {
  const result: {type: string; data: Buffer; offset: number}[] = [];
  for (let pos = start; pos + 8 <= buffer.length;) {
    const size = buffer.readUInt32BE(pos);
    if (size < 8 || pos + size > buffer.length) throw new Error('Invalid MP4 metadata atom');
    result.push({type: buffer.toString('latin1',pos+4,pos+8),data:buffer.subarray(pos,pos+size),offset:pos}); pos += size;
  }
  return result;
}
function moov(file: string) {
  const fd = fs.openSync(file,'r');
  try {
    const length = fs.statSync(file).size;
    for (let offset = 0; offset + 8 <= length;) {
      const header = Buffer.alloc(16); fs.readSync(fd,header,0,Math.min(16,length-offset),offset);
      let size = header.readUInt32BE(0); if (size === 1) size = Number(header.readBigUInt64BE(8)); if (!size) size = length-offset;
      if (size < 8 || offset + size > length) throw new Error('Invalid MP4 atom size');
      if (header.toString('ascii',4,8) === 'moov') { if (size > 128e6) throw new Error('MP4 metadata exceeds 128 MB'); const data=Buffer.alloc(size); fs.readSync(fd,data,0,size,offset); return {data,offset,size,length}; }
      offset += size;
    }
  } finally {fs.closeSync(fd);}
  throw new Error('MP4 has no moov atom');
}
function child(data: Buffer, type: string, start=8) {return atoms(data,start).find(a=>a.type===type)?.data;}
function ilst(data: Buffer) {const udta=child(data,'udta'); const meta=udta && child(udta,'meta'); return meta && child(meta,'ilst',12);}
function replace(data: Buffer, type: string, replacement: Buffer, start=8) {
  const parts=atoms(data,start).map(a=>a.type===type ? replacement : a.data);
  const result=Buffer.concat([data.subarray(0,start),...parts]); result.writeUInt32BE(result.length); return result;
}
function identity(data: Buffer) {
  const type=data.toString('latin1',4,8);
  return type==='----' ? type+atoms(data,8).filter(a=>['mean','name'].includes(a.type)).map(a=>a.data.toString('hex')).join(':') : type;
}
export function preserveMp4Metadata(source: string | undefined, output: string, tags: Record<string,string>, removeCover: boolean) {
  const original=source ? ilst(moov(source).data) : undefined;
  const target=moov(output); const generated=ilst(target.data); if (!generated) throw new Error('Cannot preserve original MP4 metadata: output metadata container missing');
  const entries=atoms(generated,8);const clearedFreeform=new Set<string>();
  const tagAtoms: Record<string,string>={title:'©nam',artist:'©ART',album:'©alb',composer:'©wrt',genre:'©gen',date:'©day',comment:'©cmt',description:'desc',copyright:'cprt'};
  const removed=new Set(Object.entries(tags).filter(([,v])=>!v).map(([t])=>tagAtoms[t]).filter(Boolean)); if(removeCover) removed.add('covr');
  const atom=(type:string,payload:Buffer)=>{const b=Buffer.alloc(8);b.writeUInt32BE(payload.length+8);b.write(type,4,4,'latin1');return Buffer.concat([b,payload]);};
  for(const [key,value] of Object.entries(tags)) {
    if(tagAtoms[key] || ['major_brand','minor_version','compatible_brands','encoder','handler_name','vendor_id','language'].includes(key)) continue;
    const prefix=Buffer.alloc(4);
    const header=Buffer.alloc(8);header.writeUInt32BE(1);
    const data=atom('----',Buffer.concat([atom('mean',Buffer.concat([prefix,Buffer.from('com.apple.iTunes')])),atom('name',Buffer.concat([prefix,Buffer.from(key)])),atom('data',Buffer.concat([header,Buffer.from(value)]))]));
    const id=identity(data);const idx=entries.findIndex(e=>identity(e.data)===id);if(idx>=0) entries.splice(idx,1);
    if(value) entries.push({type:'----',data,offset:0}); else clearedFreeform.add(id);
  }
  const keys=new Set(entries.map(a=>identity(a.data)));
  for(const entry of original ? atoms(original,8) : []) if(!entry.type.startsWith('\0') && !keys.has(identity(entry.data)) && !clearedFreeform.has(identity(entry.data)) && !removed.has(entry.type)) entries.push(entry);
  const merged=Buffer.concat([generated.subarray(0,8),...entries.map(a=>a.data)]); merged.writeUInt32BE(merged.length);
  const udta=child(target.data,'udta')!; const meta=child(udta,'meta')!;
  const updated=replace(target.data,'udta',replace(udta,'meta',replace(meta,'ilst',merged,12)));
  if(target.offset+target.size!==target.length) throw new Error('Cannot safely preserve metadata: moov is not last');
  const fd=fs.openSync(output,'r+'); try {fs.writeSync(fd,updated,0,updated.length,target.offset); fs.ftruncateSync(fd,target.offset+updated.length);} finally {fs.closeSync(fd);}
}
