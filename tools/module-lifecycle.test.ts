import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {registerModuleLifecycleRoute} from './module-lifecycle';
test('removal reports an active scan without entering the mutation queue',async t=>{
  const app=express();let queued=false,settled=false;
  registerModuleLifecycleRoute(app,{busy:()=> 'the library scan',settle:async()=>{settled=true;return{historyPending:false,publicationPending:false};}});
  app.use(()=>{queued=true;});const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const result=await fetch('http://127.0.0.1:'+(server.address() as {port:number}).port+'/api/module-lifecycle/prepare-removal',{method:'POST',signal:AbortSignal.timeout(2000)});
  assert.equal(result.status,409);assert.match((await result.json()).error,/library scan/);assert.equal(queued,false);assert.equal(settled,false);
});
test('idle removal reports unsaved publication and history state to the host',async t=>{
  const app=express();registerModuleLifecycleRoute(app,{busy:()=>undefined,settle:async()=>({historyPending:true,publicationPending:true})});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const result=await fetch('http://127.0.0.1:'+(server.address() as {port:number}).port+'/api/module-lifecycle/prepare-removal',{method:'POST'});
  assert.equal(result.status,200);assert.deepEqual(await result.json(),{historyPending:true,publicationPending:true});
});
