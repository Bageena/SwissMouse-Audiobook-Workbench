import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DirectoryIndex } from './directory-index';

test('folder-only navigation pages include empty directories and exclude files and working folders', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'directory-folders-')),folder=path.join(root,'files'); fs.mkdirSync(folder);
  const index=new DirectoryIndex(path.join(root,'directories.sqlite'));
  try {
    for (let i=0;i<115;i++) fs.mkdirSync(path.join(folder,`Disc ${i}`));
    fs.mkdirSync(path.join(folder,'.swissmouse-work'));
    const excluded=path.join(folder,'Private work'); fs.mkdirSync(excluded);
    fs.writeFileSync(path.join(folder,'audio.mp3'),'audio');
    await index.refresh(folder);
    const first=index.query(folder,{filter:'folder',limit:100},[excluded]);
    assert.equal(first.total,115); assert.equal(first.entries.length,100);
    assert.ok(first.entries.every(entry=>entry.type==='folder' && entry.name.startsWith('Disc ')));
    const last=index.query(folder,{filter:'folder',limit:100,cursor:first.nextCursor},[excluded]);
    assert.equal(last.entries.length,15); assert.equal(last.entries.at(-1)!.name,'Disc 114');
    assert.equal(new Set([...first.entries,...last.entries].map(entry=>entry.path)).size,115);
    assert.throws(()=>index.query(folder,{cursor:first.nextCursor}),/query changed/);
    assert.equal(index.query(folder,{filter:'audio'},[excluded]).total,116,'ordinary media filters still include folders');
  } finally { await index.close(); fs.rmSync(root,{recursive:true,force:true}); }
});

test('directory queries filter and sort the whole index before bounded forward and backward pages', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'directory-index-')), folder=path.join(root,'files'); fs.mkdirSync(folder);
  const index=new DirectoryIndex(path.join(root,'directories.sqlite'));
  try {
    for(let i=0;i<1200;i++) fs.writeFileSync(path.join(folder,`Track ${i}.mp3`),'x'.repeat(i+1));
    await index.refresh(folder);
    const first=index.query(folder,{limit:100}),second=index.query(folder,{limit:100,cursor:first.nextCursor});
    assert.equal(first.total,1200); assert.equal(first.entries.length,100); assert.equal(second.entries[0].name,'Track 100.mp3');
    const back=index.query(folder,{limit:100,cursor:second.previousCursor,before:true}); assert.deepEqual(back.entries,first.entries);
    assert.equal(index.query(folder,{query:'Track 1199'}).entries[0].name,'Track 1199.mp3');
    assert.equal(index.query(folder,{sort:'size',limit:25}).entries[0].name,'Track 1199.mp3');
    index.remember(folder,path.join(folder,'Track 1199.mp3'),{title:'Distant metadata match',writable:[]});
    assert.equal(index.query(folder,{query:'Distant metadata'}).entries[0].name,'Track 1199.mp3');
    await index.refresh(folder); assert.equal(index.query(folder,{query:'Distant metadata'}).total,1,'unchanged metadata survives reconciliation');
    fs.unlinkSync(path.join(folder,'Track 1199.mp3')); await index.refresh(folder);
    assert.equal(index.query(folder,{query:'Distant metadata'}).total,0);
  } finally { await index.close(); fs.rmSync(root,{recursive:true,force:true}); }
});
test('unavailable directories retain observations, back off retries, and allow an explicit refresh', async t => {
  let now=Date.now(); t.mock.method(Date,'now',()=>now);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'directory-offline-')), folder=path.join(root,'files'); fs.mkdirSync(folder); fs.writeFileSync(path.join(folder,'book.mp3'),'audio');
  const file=path.join(root,'directories.sqlite'); let index=new DirectoryIndex(file);
  try {
    await index.refresh(folder); await index.close(); index=new DirectoryIndex(file);
    fs.renameSync(folder,folder+'-offline'); await index.refresh(folder);
    const state=()=>index.db.prepare('SELECT generation FROM directory_state WHERE directory=?').get(folder)!.generation;
    const failedGeneration=state();
    for (let i=0;i<3;i++) {
      const page=index.query(folder); assert.equal(page.total,1); assert.equal(page.entries[0].name,'book.mp3'); assert.ok(page.error);
      assert.equal(page.indexing,false); assert.equal(state(),failedGeneration,'cached reads must not restart the failed scan');
    }
    now+=60000;
    assert.equal(index.query(folder).indexing,true,'automatic retry resumes after backoff');
    await index.refresh(folder); assert.equal(Number(state()),Number(failedGeneration)+1);
    fs.renameSync(folder+'-offline',folder);
    assert.equal(index.query(folder,{refresh:true}).indexing,true,'manual refresh bypasses backoff');
    await index.refresh(folder); assert.equal(index.query(folder).error,null); assert.equal(index.query(folder).total,1);
  } finally { await index.close(); fs.rmSync(root,{recursive:true,force:true}); }
});

test('a restart resumes an interrupted directory observation without waiting for the retry delay', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'directory-resume-')),folder=path.join(root,'files'); fs.mkdirSync(folder);
  const file=path.join(folder,'book.mp3'); fs.writeFileSync(file,'audio');
  const database=path.join(root,'directories.sqlite'); let index=new DirectoryIndex(database);
  try {
    await index.refresh(folder); index.remember(folder,file,{title:'Saved title',writable:[]});
    index.db.prepare('UPDATE directory_state SET complete=0,error=NULL WHERE directory=?').run(folder);
    await index.close(); index=new DirectoryIndex(database);
    fs.writeFileSync(path.join(folder,'new.mp3'),'new audio');
    const existing=index.query(folder); assert.equal(existing.total,1); assert.equal(existing.indexing,true);
    await index.refresh(folder);
    assert.equal(index.query(folder).total,2); assert.equal(index.query(folder,{query:'Saved title'}).total,1);
  } finally { await index.close(); fs.rmSync(root,{recursive:true,force:true}); }
});
