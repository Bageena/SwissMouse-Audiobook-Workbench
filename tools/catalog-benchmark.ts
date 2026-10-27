/** Opt-in synthetic benchmark. No media is opened, scanned, or created. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { CatalogStore } from './catalog-store';
import { projectCatalogRecord } from './catalog-projection';
import type { AudiobookJob } from '../src/types';

const count = Number(process.argv[2] || 500000);
if (!Number.isSafeInteger(count) || count < 1000 || count > 1000000) throw new Error('Use a record count between 1000 and 1000000.');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'swissmouse-catalog-benchmark-'));
const store = new CatalogStore(path.join(root,'catalog.sqlite'));
const started = performance.now();
try {
  const generation = store.beginSync();
  for (let start=0;start<count;start+=200) {
    store.upsertProjects(Array.from({ length:Math.min(200,count-start) },(_,offset) => {
      const i = start+offset;
      return projectCatalogRecord({ id:`benchmark-${i}`,name:`Book ${i}`,createdAt:'2026-10-18T00:00:00.000Z',status:'draft',logs:[],
        sourceFolderPath:path.join(root,'synthetic',String(i)),parts:[{ id:'source',name:'audio.m4b',sizeBytes:50000000 }],
        metadata:{ title:`Book ${i}`,author:`Author ${i%1000}`,narrator:`Narrator ${i%200}`,series:`Series ${i%500}`,seriesSequence:String(i%20),genres:['Fiction'],tags:['Benchmark'],language:'eng',abridged:false,explicit:false },
      } as AudiobookJob,'library');
    }),generation);
    if ((start+200)%50000===0) console.log(JSON.stringify({ indexed:start+200,seconds:Math.round((performance.now()-started)/1000) }));
  }
  store.endSync(generation);
  const importMs=performance.now()-started;
  const timed = (run:()=>unknown) => { const start=performance.now();const value=run();return { ms:Number((performance.now()-start).toFixed(2)),value }; };
  const first=timed(()=>store.query({root:'library',limit:50}));
  const search=timed(()=>store.query({query:`Book ${count-1}`,limit:50}));
  const deep=timed(()=>store.query({offset:count-50,limit:50}));
  const cursor=timed(()=>store.query({limit:50,cursor:(first.value as any).nextCursor,root:'library'}));
  const selection=timed(()=>store.selection({root:'library'}));
  const members=timed(()=>store.selectionMembers({token:(selection.value as any).token,ids:[`benchmark-${count-1}`]}));
  const files=timed(()=>store.resources({kind:'core.file',limit:50}));
  assert.equal((first.value as any).total,count);assert.equal((files.value as any).total,count);
  assert.equal((search.value as any).items[0].id,`benchmark-${count-1}`);assert.deepEqual(members.value,[`benchmark-${count-1}`]);
  assert.equal((cursor.value as any).items[0].name,'Book 50');
  const rssMiB=Number((process.memoryUsage().rss/1048576).toFixed(1));
  const payloadBytes=Buffer.byteLength(JSON.stringify(first.value));
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  console.log(JSON.stringify({node:process.version,platform:process.platform,sqlite:store.db.prepare('select sqlite_version() as version').get()!.version,books:count,files:count,resources:count*3,importMs:Math.round(importMs),firstPageMs:first.ms,searchMs:search.ms,deepOffsetMs:deep.ms,cursorPageMs:cursor.ms,selectAllMs:selection.ms,selectionMembershipMs:members.ms,filePageMs:files.ms,pageBytes:payloadBytes,rssMiB,databaseMiB:Number((fs.statSync(store.file).size/1048576).toFixed(1))}));
} finally {
  store.close();
  assert.ok(root.startsWith(os.tmpdir()+path.sep) && path.basename(root).startsWith('swissmouse-catalog-benchmark-'));
  fs.rmSync(root,{recursive:true,force:true});
}
