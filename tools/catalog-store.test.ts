import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CatalogStore, resourceId } from './catalog-store';
import { projectCatalogRecord } from './catalog-projection';
import type { AudiobookJob } from '../src/types';

function job(id: string, title = id): AudiobookJob {
  return { id,name:title,status:'draft',createdAt:'2026-10-18T00:00:00.000Z',parts:[],logs:[],metadata:{ title,author:'René Author',narrator:'Reader',genres:['Fantasy'],tags:['Research'],language:'eng',abridged:false,explicit:false } } as AudiobookJob;
}
test('catalog persists independent identities and never changes legacy IDs or media', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'catalog-identities-'));
  const file = path.join(root,'catalog.sqlite'); let store = new CatalogStore(file);
  try {
    const source = job('legacy-one','Original title'); source.sourceFolderPath = root;
    source.parts = [{ id:'part-one',name:'one.mp3',sizeBytes:12 } as any];
    const original = structuredClone(source), generation = store.beginSync();
    store.upsertProjects([projectCatalogRecord(source,'library')],generation); store.endSync(generation);
    const before = store.query().items[0], fileId = store.resources({ kind:'core.file' }).items[0].id;
    assert.equal(before.id,source.id); assert.equal(before.resourceId,resourceId('audiobooks:work',source.id));
    assert.notEqual(before.recordingId,before.resourceId); assert.deepEqual(source,original);
    source.metadata!.title = 'Renamed'; source.parts[0].name = 'moved.mp3';
    store.upsertProjects([projectCatalogRecord(source,'library')],generation);
    const after = store.query().items[0]; assert.equal(after.resourceId,before.resourceId);
    assert.equal(store.resources({kind:'core.file'}).items[0].id,fileId);
    assert.equal((store.getResource(fileId)!.file as any).path,path.join(root,'moved.mp3'));
    store.close(); store = new CatalogStore(file);
    assert.equal(store.query().items[0].resourceId,before.resourceId);
    assert.equal(fs.existsSync(path.join(root,'moved.mp3')),false,'catalog never creates or modifies source media');
  } finally { store.close(); assert.ok(root.startsWith(os.tmpdir()+path.sep)); fs.rmSync(root,{recursive:true,force:true}); }
});
test('full-catalog substring filters and stable natural ordering precede paging', () => {
  const store = new CatalogStore(':memory:');
  try {
    const generation = store.beginSync();
    for (let start=0;start<1200;start+=200) store.upsertProjects(Array.from({length:200},(_,offset)=>projectCatalogRecord(job(`id-${start+offset}`,`Book ${start+offset}`),'library')),generation);
    assert.equal(store.query({root:'library',limit:25}).total,1200);
    assert.deepEqual(store.query({limit:3}).items.map(book=>book.name),['Book 0','Book 1','Book 2']);
    assert.equal(store.query({query:'Ｂｏｏｋ １１９９',filters:{creator:'rene',tag:'research'}}).items[0].id,'id-1199');
    assert.equal(store.query({query:'ook 1199'}).total,1);
    assert.equal(store.query({query:'1'}).total,471,'one-character search retains substring semantics');
    assert.equal(store.query({filters:{creator:'missing'}}).total,0);
    const rare = job('id-1199','Book 1199'); rare.sourceFormat='ogg';
    store.upsertProjects([projectCatalogRecord(rare,'library')],generation);
    assert.deepEqual(store.suggestions({field:'format'}),['ogg'],'format choices include unloaded results');
    const first = store.query({limit:500}), second = store.query({limit:500,cursor:first.nextCursor});
    assert.equal(second.items[0].name,'Book 500'); assert.equal(new Set([...first.items,...second.items].map(book=>book.id)).size,1000);
    assert.equal(store.query({limit:1,offset:1199}).items[0].id,'id-1199');
    const descending = store.query({limit:2,descending:true});
    assert.equal(descending.items[0].id,'id-1199');
    assert.equal(store.query({limit:2,descending:true,cursor:descending.nextCursor}).items[0].id,'id-1197');
    assert.throws(()=>store.query({sort:'title; DROP TABLE library' as any}),/Unknown/);
    assert.throws(()=>store.query({limit:501}),/integer/);
    store.upsertProjects([projectCatalogRecord(job('id-new'))],generation);
    assert.throws(()=>store.query({cursor:first.nextCursor}),/Catalog changed/);
  } finally {store.close();}
});
test('grouping is explicit and collections and frozen selections survive catalog edits', () => {
  const store = new CatalogStore(':memory:');
  try {
    const a = job('a','Same title'),b = job('b','Same title');
    const generation = store.beginSync(); store.upsertProjects([a,b].map(item=>projectCatalogRecord(item,'library')),generation);
    assert.equal(store.query().total,2,'title matching must not merge works');
    const selection = store.selection({root:'library'});
    a.metadata!.title = 'Changed'; store.upsertProjects([projectCatalogRecord(a,'library'),projectCatalogRecord(job('c'),'library')],generation);
    assert.deepEqual(store.selectionPage({token:selection.token}).ids,['a','b']);
    store.saveCollection({id:'dark-tower',name:'Connected works',selection:selection.token,exclude:['b']});
    assert.deepEqual(store.query({collectionId:'dark-tower'}).items.map(book=>book.id),['a']);
    store.saveCollection({id:'dark-tower',name:'Old browser copy',ids:['b'],importOnly:true});
    assert.equal(store.collections()[0].name,'Connected works'); assert.equal(store.collections()[0].count,1);
    b.logicalBookId = 'a'; store.upsertProjects([projectCatalogRecord(b,'library')],generation);
    const grouped = store.query({collectionId:'dark-tower'}).items[0]; assert.equal(grouped.representations!.length,2);
    assert.equal(store.getResource(resourceId('audiobooks:recording','b'))!.relations.some((r:any)=>r.toId===grouped.resourceId),true);
    assert.equal(store.getResource(resourceId('audiobooks:work','b'))!.id,resourceId('audiobooks:work','b'));
    assert.deepEqual(store.selectionMembers({token:selection.token,ids:['a','b','c']}),['a','b']);
    store.saveCollection({id:'dark-tower',removeMembers:true,selection:selection.token});
    assert.equal(store.query({collectionId:'dark-tower'}).total,0,'removing a selection updates durable membership');
    store.saveCollection({id:'dark-tower',remove:true}); assert.equal(store.query().total,2,'removing collection preserves content');
  } finally {store.close();}
});

test('file availability is observed at indexing and recovered outputs keep their original work identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'catalog-availability-')),store = new CatalogStore(':memory:');
  try {
    const source = path.join(root,'source.mp3'), output = path.join(root,'Final.m4b'); fs.writeFileSync(source,'original');
    const item = job('availability'); item.sourceFolderPath=root; item.parts=[{id:'source',name:'source.mp3'} as any];
    const project = projectCatalogRecord(item,'inbox');
    project.observation={sourcePaths:[source],invalidSource:false,libraryRoot:root,m4bCandidates:[output]};
    const generation=store.beginSync(); store.upsertProjects([project],generation);
    const workId=store.query().items[0].resourceId;
    fs.unlinkSync(source);
    assert.equal(store.query().items[0].sourceMissing,false,'queries use the last observation, without disk probes');
    store.upsertProjects([project],generation,true);
    assert.equal(store.query({availability:'missing'}).total,1);
    fs.writeFileSync(output,'finalized media'); store.upsertProjects([project],generation,true);
    const recovered=store.query({root:'library',availability:'available'}).items[0];
    assert.equal(recovered.resourceId,workId); assert.equal(recovered.originalSourceMissing,true); assert.equal(recovered.availableM4bPath,output);
    assert.equal(fs.readFileSync(output,'utf8'),'finalized media');
  } finally { store.close(); assert.ok(root.startsWith(os.tmpdir()+path.sep)); fs.rmSync(root,{recursive:true,force:true}); }
});

test('relation pages are bounded and removed files retain archived identities', () => {
  const store=new CatalogStore(':memory:');
  try {
    const item=job('large-recording');item.sourceFolderPath=path.resolve('synthetic');item.parts=Array.from({length:610},(_,i)=>({id:`part-${i}`,name:`${i}.mp3`} as any));
    const generation=store.beginSync();store.upsertProjects([projectCatalogRecord(item)],generation);
    const id=resourceId('audiobooks:recording',item.id),detail=store.getResource(id)!;
    assert.equal(detail.relations.length,50);assert.equal(detail.relationPage.total,611);
    const second=store.relations({id,cursor:detail.relationPage.nextCursor,limit:500});assert.equal(second.items.length,500);
    const removed=resourceId('audiobooks:file',`${item.id}:part:part-609`);item.parts.pop();
    store.upsertProjects([projectCatalogRecord(item)],generation);
    assert.equal(store.getResource(removed)!.archived,true);assert.equal(store.resources({kind:'core.file'}).total,609);
  } finally { store.close(); }
});
test('interrupted imports retain older records until a successful finalization', () => {
  const store = new CatalogStore(':memory:');
  try {
    let generation = store.beginSync(); store.upsertProjects([job('a'),job('b')].map(item=>projectCatalogRecord(item)),generation); store.endSync(generation);
    generation=store.beginSync();store.upsertProjects([projectCatalogRecord(job('a'))],generation);
    assert.equal(store.query().total,2);
    store.endSync(generation);assert.equal(store.query().total,1);
    assert.equal(store.getResource(resourceId('audiobooks:work','b'))!.archived,true);
    generation=store.beginSync();store.upsertProjects([job('a'),job('b')].map(item=>projectCatalogRecord(item)),generation);store.endSync(generation);
    assert.equal(store.query().total,2,'a restored project becomes visible under its original ID');
  } finally {store.close();}
});
