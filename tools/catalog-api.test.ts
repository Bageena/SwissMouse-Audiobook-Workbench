import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { isReadOnlyCatalogRequest } from './catalog-routes';

test('only read-only catalog POSTs bypass project mutation locks', () => {
  for (const route of ['library/query', 'matches', 'suggestions', 'membership-suggestions', 'selections/page', 'selections/members']) {
    assert.equal(isReadOnlyCatalogRequest('POST', '/catalog/' + route), true);
    assert.equal(isReadOnlyCatalogRequest('POST', '/catalog/' + route + '/'), true);
  }
  for (const route of ['/catalog/collections', '/catalog/selections', '/catalog/library/query/extra', '/jobs/book/book-files/verify-audio'])
    assert.equal(isReadOnlyCatalogRequest('POST', route), false);
  assert.equal(isReadOnlyCatalogRequest('DELETE', '/catalog/library/query'), false);
});

test('live catalog worker migrates legacy books, pages queries, and retains durable IDs after edits', async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(),'catalog-api-test-'));
  const port = 42000+Math.floor(Math.random()*1000), base=`http://127.0.0.1:${port}`;
  const legacy = Array.from({length:1200},(_,i)=>({id:`book-${i}`,name:`Book ${i}`,createdAt:'2026-10-18T00:00:00.000Z',status:'draft',parts:[],chapters:[],candidates:[],logs:[],metadata:{title:`Book ${i}`,author:'Author',narrator:'Reader',genres:[],language:'eng',abridged:false,explicit:false},metadataDraft:{title:`Unfinished ${i}`},personalRating:7}));
  fs.writeFileSync(path.join(root,'jobs.json'),JSON.stringify(legacy));
  const tracer = path.join(root, 'hold-query.cjs');
  fs.writeFileSync(tracer, `
    const { Worker } = require('node:worker_threads');
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...rest) {
      if (message.method === 'query' && message.args?.[0]?.query === '__held_read_only_query__') {
        console.log('HELD_CATALOG_QUERY');
        setTimeout(() => send.call(this, message, ...rest), 1000); return;
      }
      return send.call(this, message, ...rest);
    };
  `);
  let output=''; const child=spawn(process.execPath,['--require',tracer,path.resolve('dist/server.cjs')],{env:{...process.env,APP_ROOT:root,NODE_ENV:'production',PORT:String(port)},stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const request=async(route:string,body?:unknown)=>{const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-SwissMouse-Catalog':'1'},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.ok(response.ok,`${route}: ${JSON.stringify(data)}`);return data;};
  try {
    let ready=false,lastResponse=''; for(let i=0;i<150;i++){try{const response=await fetch(base+'/api/catalog/status');if(response.ok && !(await response.json()).indexing){ready=true;break;}lastResponse=`${response.status}: ${await response.text()}`;}catch(error){lastResponse=String(error);}await new Promise(resolve=>setTimeout(resolve,100));}
    assert.ok(ready,`${lastResponse}\n${output}`);
    const pendingQuery = request('/api/catalog/library/query', {query:'__held_read_only_query__'});
    for (let i=0; i<100 && !output.includes('HELD_CATALOG_QUERY'); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.match(output, /HELD_CATALOG_QUERY/);
    assert.equal((await request('/api/operations/status')).busy, null, 'pending catalog searches are not file operations');
    const check = await fetch(base+'/api/jobs/book-1199/book-files/verify-audio', {method:'POST'});
    assert.equal(check.status, 400, 'audio verification reaches source validation instead of a false busy lock');
    assert.match((await check.json()).error, /Add local audio first/);
    await pendingQuery;
    const page=await request('/api/catalog/library/query',{root:'workbench',limit:25});
    assert.equal(page.total,1200);assert.equal(page.items.length,25);assert.equal(page.items[2].name,'Book 2');
    assert.ok(!JSON.stringify(page).includes('Unfinished'),'drafts are not catalog payloads');
    const late=await request('/api/catalog/library/query',{query:'Book 1199',limit:25});assert.equal(late.items[0].id,'book-1199');
    const id=late.items[0].resourceId,recording=late.items[0].recordingId;
    assert.equal((await request('/api/resources/'+id)).kind,'core.work');assert.notEqual(id,recording);
    const selection=await request('/api/catalog/selections',{query:'Book 1199'});
    await request('/api/library/metadata',{changes:[{id:'book-1199',fields:{title:'Renamed work'}}]});
    const renamed=await request('/api/catalog/library/query',{query:'Renamed work'});assert.equal(renamed.items[0].resourceId,id);
    assert.deepEqual((await request('/api/catalog/selections/page',{token:selection.token})).ids,['book-1199']);
    const project=await request('/api/jobs/book-1199');assert.equal(project.personalRating,7);assert.equal(project.metadataDraft.title,'Renamed work');
    await request('/api/catalog/collections',{id:'planets',name:'Planets',ids:['book-1199']});
    let membershipProject=await request('/api/jobs/book-1199');
    assert.deepEqual(membershipProject.metadata.collections,[{id:'planets',name:'Planets'}]);
    assert.equal(membershipProject.metadataDraft.title,'Renamed work','collection changes preserve drafts');
    let suggestions=await request('/api/catalog/membership-suggestions',{kind:'collections',query:'Plan',jobId:'book-1199',author:'Author'});
    assert.equal(suggestions.matches[0].name,'Planets');assert.equal(suggestions.selected[0].id,'planets');
    await request('/api/catalog/collections',{id:'planets',ids:['book-1199'],removeMembers:true});
    membershipProject=await request('/api/jobs/book-1199');assert.deepEqual(membershipProject.metadata.collections,[]);
    const contract=await request('/api/catalog/contract');assert.equal(contract.version,1);assert.ok(contract.theme.tokens.includes('--sm-surface'));assert.equal(contract.maxPageSize,500);
    assert.equal((await request('/api/library?limit=50')).length,50);
    assert.equal((await fetch(base+'/api/resources/not-a-resource')).status,404);
    assert.equal((await fetch(base+'/api/catalog/library/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:501})})).status,400);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'jobs.json'),'utf8')),legacy,'original legacy migration source remains intact');
    assert.equal(fs.existsSync(path.join(root,'jobs.json.sqlite')),true,'per-project durable state is present');
  } finally {
    const stopped=new Promise(resolve=>child.once('exit',resolve));if(child.exitCode===null){child.kill();await stopped;}
    assert.ok(root.startsWith(process.cwd()+path.sep));fs.rmSync(root,{recursive:true,force:true});
  }
});
