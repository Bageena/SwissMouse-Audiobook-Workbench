import fs from 'node:fs';

export function appendRiffChunk(file: string, type: string, data: Buffer) {
  const header=Buffer.alloc(8); header.write(type); header.writeUInt32LE(data.length,4);
  fs.appendFileSync(file,Buffer.concat([header,data,...(data.length%2?[Buffer.alloc(1)]:[])]));
  const size=fs.statSync(file).size;
  const fd=fs.openSync(file,'r+');
  try {
    const magic=Buffer.alloc(4);fs.readSync(fd,magic,0,4,0);
    if(magic.toString()==='RF64') {const value=Buffer.alloc(8);value.writeBigUInt64LE(BigInt(size-8));fs.writeSync(fd,value,0,8,20);}
    else {const value=Buffer.alloc(4);value.writeUInt32LE(size-8);fs.writeSync(fd,value,0,4,4);}
  } finally {fs.closeSync(fd);}
}

// RIFF INFO lacks narrator, series and identifiers. A standard ID3v2.4 chunk
// supplies these fields to FFprobe and audiobook readers supporting WAV ID3.
export function writeWavMetadata(file:string,tags:Record<string,string>) {
  const syncsafe=(size:number)=>Buffer.from([(size>>>21)&127,(size>>>14)&127,(size>>>7)&127,size&127]);
  const frames:Buffer[]=[];
  const frame=(name:string,data:Buffer)=>frames.push(Buffer.concat([Buffer.from(name),syncsafe(data.length),Buffer.alloc(2),data]));
  const standard:Record<string,string>={title:'TIT2',album:'TALB',artist:'TPE1',album_artist:'TPE2',composer:'TCOM',genre:'TCON',date:'TDRC',publisher:'TPUB',copyright:'TCOP',language:'TLAN',subtitle:'TIT3'};
  for(const [key,value] of Object.entries(tags)) {
    if(!value || /^chapter\d+/i.test(key)) continue;
    if(key==='comment') frame('COMM',Buffer.concat([Buffer.from([3]),Buffer.from('eng\0'),Buffer.from(value)]));
    else if(standard[key]) frame(standard[key],Buffer.concat([Buffer.from([3]),Buffer.from(value)]));
    else frame('TXXX',Buffer.concat([Buffer.from([3]),Buffer.from(key+'\0'+value)]));
  }
  const body=Buffer.concat(frames);
  appendRiffChunk(file,'id3 ',Buffer.concat([Buffer.from('ID3'),Buffer.from([4,0,0]),syncsafe(body.length),body]));
}
