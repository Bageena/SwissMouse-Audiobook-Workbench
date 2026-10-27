import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extendedMetadata, readExtendedMetadata } from '../src/utils/extendedMetadata';
import { writeMetadataSidecars } from './metadata-sidecars';
import { scanRoot, identifyBook } from './library-filesystem';
import { audiobookTags } from './audiobook-metadata';
import { CatalogStore } from './catalog-store';
import { projectCatalogRecord } from './catalog-projection';
import type { AudiobookMetadata, AudiobookJob } from '../src/types';
const metadata:AudiobookMetadata = {title:'Book',author:'Writer',narrator:'Reader',genres:['Fiction'],language:'eng',abridged:false,explicit:false,collections:[{id:'c',name:'Planets'}],additionalSeries:[{id:'s',name:'Another series',sequence:'2'}]};

test('extended format separates internal memberships and round-trips standard metadata',()=>{
 const data=extendedMetadata(metadata,[],'resource');
 assert.deepEqual(readExtendedMetadata(data).collections,metadata.collections);
 assert.equal(data.fileTags.title,'Book'); assert.ok(!('collections' in data.fileTags));
 assert.ok(!('additionalSeries' in data.metadata));
 const tags=audiobookTags(metadata,undefined,{},'mp3');
 assert.ok(!JSON.stringify(tags).includes('Planets'));assert.ok(!JSON.stringify(tags).includes('Another series'));
 assert.throws(()=>readExtendedMetadata({...data,schemaVersion:99}),/Unsupported/);
});

test('rebuild writes extended data, leaves legacy bytes untouched by default, and gates compatibility writes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sm-sidecars-'));
 try {
  const legacy='{"title":"User original","custom":"keep me"}'; fs.writeFileSync(path.join(root,'metadata.json'),legacy);
  const options={assertOwnership:()=>{},associate:()=>{}};
  assert.deepEqual(writeMetadataSidecars(metadata,[],[root],options),[path.join(root,'exmetadata.json')]);
  assert.equal(fs.readFileSync(path.join(root,'metadata.json'),'utf8'),legacy);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'exmetadata.json'),'utf8')).internal.collections[0].name,'Planets');
  writeMetadataSidecars(metadata,[],[root],{...options,audiobookshelf:true});
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'metadata.json'),'utf8')).title,'Book');
  const saved=fs.readFileSync(path.join(root,'metadata.json'),'utf8');
  writeMetadataSidecars({...metadata,title:'Next'},[],[root],options);
  assert.equal(fs.readFileSync(path.join(root,'metadata.json'),'utf8'),saved);
  assert.throws(()=>writeMetadataSidecars(metadata,[],[root],{...options,assertOwnership:()=>{throw new Error('shared folder');}}),/shared folder/);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('scanner reads extended first per field, preserves explicit empty values, tracks both sidecars, and warns on invalid extended data',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sm-precedence-'));const folder=path.join(root,'Book');fs.mkdirSync(folder);
 try {
  fs.writeFileSync(path.join(folder,'book.mp3'),'audio');
  fs.writeFileSync(path.join(folder,'metadata.json'),JSON.stringify({title:'Legacy',publisher:'Legacy Publisher',author:'Legacy Writer'}));
  const data=extendedMetadata({...metadata,author:'',narrators:['Reader, Jr.','Other Reader'],cover:null});delete (data.metadata as any).publisher;
  fs.writeFileSync(path.join(folder,'exmetadata.json'),JSON.stringify(data));
  const [book]=await scanRoot(root,new Set(['mp3']));
  assert.equal(book.associatedFiles?.filter(file=>file.kind==='metadata').length,2);
  let result=await identifyBook(book,async()=>({album:'Embedded',artist:'Embedded Writer',publisher:'Embedded Publisher'}));
  assert.equal(result.metadata.title,'Book');assert.equal(result.metadata.author,'');assert.equal(result.metadata.publisher,'Legacy Publisher');
  assert.deepEqual(result.metadata.additionalSeries,metadata.additionalSeries);
  assert.deepEqual(result.metadata.narrators,['Reader, Jr.','Other Reader']);
  fs.writeFileSync(path.join(folder,'exmetadata.json'),'{broken');
  result=await identifyBook(book,async()=>({album:'Embedded'}));
  assert.equal(result.metadata.title,'Legacy');assert.match(result.warning,/exmetadata.json/);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('independent membership suggestions include author context, five recent choices, and global typed matches',()=>{
 const store=new CatalogStore(':memory:');
 try {
  const records=Array.from({length:8},(_,index)=>projectCatalogRecord({id:`p${index}`,name:`Book ${index}`,status:'draft',createdAt:`2026-10-${String(index+10).padStart(2,'0')}T00:00:00Z`,parts:[],logs:[],metadata:{...metadata,author:index===0?'Our Author':'Other Author',series:`Main ${index}`,collections:[{id:`c${index}`,name:index===0?'Planets':`Collection ${index}`}],additionalSeries:[{id:`s${index}`,name:`Extra ${index}`,addedAt:`2026-10-${String(index+10).padStart(2,'0')}T00:00:00Z`}]}} as AudiobookJob));
  const generation=store.beginSync();store.upsertProjects(records,generation);store.endSync(generation);
  const unrelated=store.membershipSuggestions({kind:'collections',author:'Nobody'});
  assert.equal(unrelated.quick.length,5);assert.ok(!unrelated.quick.some(item=>item.name==='Planets'));
  assert.equal(store.membershipSuggestions({kind:'collections',query:'Plan',author:'Nobody'}).matches[0].name,'Planets');
  assert.ok(store.membershipSuggestions({kind:'collections',author:'Our Author'}).quick.some(item=>item.name==='Planets'));
  const series=store.membershipSuggestions({kind:'additionalSeries',author:'Our Author'});
  assert.ok(series.quick.some(item=>item.name==='Main 0'));assert.ok(series.quick.some(item=>item.name==='Extra 0'));
  assert.ok(!series.matches.some(item=>item.name==='Planets'));
  assert.equal(store.query({collectionId:'c0'}).total,1);
  const recentBefore=store.membershipSuggestions({kind:'collections',author:'Nobody'}).quick;
  records[0].book.metadata.title='Updated title';store.upsertProjects([records[0]],generation);
  assert.deepEqual(store.membershipSuggestions({kind:'collections',author:'Nobody'}).quick,recentBefore,'ordinary metadata saves do not change collection recency');
  records[0].book.metadata.collections=[];store.upsertProjects([records[0]],generation);
  assert.equal(store.query({collectionId:'c0'}).total,0);
 } finally {store.close();}
});
