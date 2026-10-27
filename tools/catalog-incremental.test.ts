import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CatalogService } from './catalog-service';
import { CatalogStore } from './catalog-store';
import { DurableProjectStore } from './durable-project-store';
import { projectCatalogRecord } from './catalog-projection';
import type { AudiobookJob } from '../src/types';
const job=(id:string)=>({id,name:`Book ${id}`,parts:[],logs:[],createdAt:'2026-10-19',metadata:{title:`Book ${id}`,author:'Writer',genres:[]}} as unknown as AudiobookJob);

test('catalog resumes durable changes without enumerating the legacy collection and rebuild preserves collections and identity', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'catalog-feed-')),file=path.join(root,'catalog.sqlite');
  const projects=new DurableProjectStore(path.join(root,'jobs.json')),jobs=projects.load();
  const start=()=>new CatalogService(file,()=>{throw new Error('Must not enumerate legacy projects');},item=>projectCatalogRecord(item,'library'),()=>{},path.resolve('dist/catalog-worker.cjs'),projects);
  let service:CatalogService|undefined;
  try {
    jobs.push(...Array.from({length:250},(_,i)=>job(String(i)))); projects.save(jobs);
    service=start(); await service.ready(); const first=await service.call('query',{limit:25}); assert.equal(first.total,250);
    await service.call('saveCollection',{id:'shelf',name:'Saved shelf',ids:['249']});
    const checkpoint=await service.call('checkpoint'); assert.equal(checkpoint,projects.version());
    await service.close(); service=undefined;
    projects.get('249')!.personalRating=5; projects.save(jobs);
    let projected=0;
    service=new CatalogService(file,()=>{throw new Error('No full reads');},item=>{projected++;return projectCatalogRecord(item,'library');},()=>{},path.resolve('dist/catalog-worker.cjs'),projects);
    await service.ready(); assert.equal(projected,1); assert.equal((await service.call('query',{query:'Book 249'})).items[0].personalRating,5);
    await service.close(); service=undefined;
    fs.unlinkSync(file); service=start(); await service.ready();
    assert.equal((await service.call('query',{collectionId:'shelf'})).items[0].personalRating,5);
    assert.equal((await service.call('query',{limit:25})).items[0].resourceId,first.items[0].resourceId);
  } finally { if(service) await service.close(); projects.close(); fs.rmSync(root,{recursive:true,force:true}); }
});
test('duplicate candidates are maintained independently of read queries and honor durable decisions', () => {
  const store=new CatalogStore(':memory:');
  try {
    const a=job('a'),b=job('b'); b.metadata!.title=a.metadata!.title; a.metadata!.narrator=b.metadata!.narrator='Reader';
    store.upsertProjects([a,b].map(item=>projectCatalogRecord(item,'library')),1);
    assert.equal(store.matches().total,0); store.maintainMatches(); assert.equal(store.matches().total,1);
    a.matchDecisions={b:'ignore'} as any; store.upsertProjects([projectCatalogRecord(a,'library')],1); store.maintainMatches();
    assert.equal(store.matches().total,0); assert.equal(store.matches({reviewed:true}).total,1);
  } finally { store.close(); }
});

test('an interrupted feed resumes after its last committed batch and serves the existing index first', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'catalog-resume-')),file=path.join(root,'catalog.sqlite');
  const projects=new DurableProjectStore(path.join(root,'jobs.json')),jobs=projects.load();
  let service:CatalogService|undefined;
  try {
    jobs.push(...Array.from({length:250},(_,i)=>job(String(i)))); projects.save(jobs);
    const index=new CatalogStore(file),changes=projects.changes(0,100);
    index.applyChanges(changes.map(change=>({...projectCatalogRecord(projects.get(change.id)!,'library'),stateVersion:change.version})),[],changes.at(-1)!.version);
    index.close(); let projected=0;
    service=new CatalogService(file,()=>{throw new Error('No full reads');},item=>{projected++;return projectCatalogRecord(item,'library');},()=>{},path.resolve('dist/catalog-worker.cjs'),projects);
    assert.ok((await service.call('query',{limit:25})).total>=100,'committed summaries can be read before ready');
    await service.ready(); assert.equal(projected,150); assert.equal((await service.call('query',{limit:25})).total,250);
  } finally { if(service) await service.close(); projects.close(); fs.rmSync(root,{recursive:true,force:true}); }
});

test('priority edits survive an older in-flight projection, and deletion archives its file resources', () => {
  const store=new CatalogStore(':memory:');
  try {
    const original=job('a'); original.sourceFolderPath=process.cwd(); original.parts=[{id:'part',name:'a.m4b',sizeBytes:2} as any];
    const old={...projectCatalogRecord(original,'library'),stateVersion:1};
    original.metadata!.title='Edited'; const updated={...projectCatalogRecord(original,'library'),stateVersion:2};
    store.applyChanges([updated],[],0); store.applyChanges([old],[],1);
    assert.equal(store.query().items[0].metadata.title,'Edited'); assert.equal(store.checkpoint(),1);
    const file=store.resources({kind:'core.file'}).items[0].id;
    store.applyChanges([],['a'],3); assert.equal(store.query().total,0); assert.equal(store.getResource(file)!.archived,true);
    store.applyChanges([old],[],1); assert.equal(store.query().total,0,'stale observations cannot resurrect deleted resources');
  } finally { store.close(); }
});
