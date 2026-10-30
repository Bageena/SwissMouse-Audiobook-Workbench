import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createPreferencesRegistry } from '../packages/sdk/preferences';
import { createRequirementRegistry } from '../packages/sdk/dependencies';
import { preferencesRegistry } from '../src/preferences/legacy';
import { requirementsRegistry } from '../src/preferences/requirements';
import { activateAudiobookPreferences } from '../src/modules/audiobooks/preferences';

test('Core declares no audiobook settings or speech requirements; module removal preserves opaque saved values',()=>{
  assert.ok(preferencesRegistry.list().every(section=>section.owner==='core'));
  assert.deepEqual(requirementsRegistry.consumers(),[]);assert.deepEqual(Object.keys(requirementsRegistry.details),[]);
  const saved={faster_transcription:true,whisper_profile:'turbo',quick_tags:['Keep'],unknown_module_setting:{enabled:false}};const before=JSON.stringify(saved);
  const remove=activateAudiobookPreferences();
  assert.ok(preferencesRegistry.list().some(s=>s.id==='audiobooks.processing'));assert.ok(requirementsRegistry.details.python);
  assert.deepEqual(requirementsRegistry.resolve(['audiobooks.file_import']),['ffprobe']);
  remove();remove();assert.ok(preferencesRegistry.list().every(s=>s.owner==='core'));assert.equal(requirementsRegistry.details.python,undefined);
  assert.throws(()=>requirementsRegistry.resolve(['audiobooks.file_import']),/unavailable/);assert.equal(JSON.stringify(saved),before);
  const reinstall=activateAudiobookPreferences();try{assert.ok(requirementsRegistry.details.python);remove();assert.ok(requirementsRegistry.details.python);}finally{reinstall();}
});

test('preference groups register atomically and stale cleanup cannot remove later activation',()=>{
  const registry=createPreferencesRegistry();
  const section={owner:'notes',id:'notes.editor',category:'notes',title:'Editor',description:'Defaults'};
  const remove=registry.activate('notes',[section]);
  assert.throws(()=>registry.activate('notes',[{...section,id:'notes.other'},section]),/already registered/);
  assert.deepEqual(registry.list().map(s=>s.id),['notes.editor']);remove();
  const later=registry.activate('notes',[section]);remove();assert.equal(registry.list().length,1);later();
  assert.throws(()=>registry.activate('notes',[{...section,owner:'other'}]),/owner/);
});

test('shared tools keep consumer metadata when one module leaves and invalid registrations leave no partial state',()=>{
  const registry=createRequirementRegistry();const detail={description:'Reads a managed file',website:'https://example.com/',license:'MIT',licenseUrl:'https://example.com/license',usedBy:'First'};
  const a=registry.activate('first',{reader:detail},{'first.read':['reader']});
  const b=registry.activate('second',{reader:{...detail,usedBy:'Second'}},{'second.read':['reader']});
  a();assert.equal(registry.details.reader.usedBy,'Second');assert.deepEqual(registry.resolve(['second.read']),['reader']);
  assert.throws(()=>registry.activate('bad',{reader:{...detail,license:'Different'}},{'bad.read':['reader']}),/Conflicting/);
  assert.throws(()=>registry.activate('bad',{reader:detail},{'bad.read':['missing']}),/undeclared/);
  assert.deepEqual(registry.consumers(),['second']);b();assert.deepEqual(Object.keys(registry.details),[]);
});

test('neutral registries and module declarations build without private host, audiobook runtime or React implementation imports',async()=>{
  for(const entry of ['src/preferences/registry.ts','src/preferences/requirements.ts','packages/audiobooks/src/preferences.ts','packages/audiobooks/src/requirement-details.ts','packages/audiobooks/src/feature-dependencies.ts']){
    const bundle=await build({entryPoints:[entry],bundle:true,platform:'browser',format:'esm',write:false,metafile:true});
    for(const input of Object.keys(bundle.metafile!.inputs)){
      assert.ok(!input.includes('node_modules/')&&!input.endsWith('src/types.ts'),input);
      if(entry.startsWith('src/preferences/'))assert.ok(!input.includes('packages/audiobooks/'),input);
      else assert.ok(input.startsWith('packages/audiobooks/src/')||input.startsWith('packages/sdk/'),input);
    }
  }
});
