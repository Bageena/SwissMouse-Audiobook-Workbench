import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DurableProjectStore } from './durable-project-store';
import type { AudiobookJob } from '../src/types';

const job = (id: string) => ({ id, name: id, parts: [], metadataDraft: { title: id }, personalRating: 4, sourceMembership: 'confirmed', matchDecisions: { other: 'ignore' } } as unknown as AudiobookJob);
function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-project-')), file = path.join(root, 'jobs.json');
  const stores: DurableProjectStore[] = [];
  t.after(() => { stores.forEach(store => store.close()); fs.rmSync(root, { recursive: true, force: true }); });
  return { file, open() { const store = new DurableProjectStore(file); stores.push(store); return store; } };
}
test('migrates legacy state once, saves only touched rows, and leaves legacy bytes intact', t => {
  const { file, open } = fixture(t), original = JSON.stringify(Array.from({ length: 1000 }, (_, i) => job(String(i))));
  fs.writeFileSync(file, original);
  const store = open(), jobs = store.load(), version = store.version();
  assert.equal(jobs.length, 1000);
  const one = store.get('500')!; one.metadataDraft!.title = 'changed'; store.save(jobs);
  assert.deepEqual(store.changes(version).map(row => row.id), ['500']);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  const reopened = open(); reopened.load();
  assert.equal(reopened.get('500')!.metadataDraft!.title, 'changed');
  assert.equal(reopened.get('500')!.personalRating, 4);
  assert.equal(reopened.get('500')!.sourceMembership, 'confirmed');
  assert.deepEqual(reopened.get('500')!.matchDecisions, { other: 'ignore' });
});
test('lazy arrays preserve splice, insertion, nested changes and deleted tombstones', t => {
  const { open } = fixture(t), store = open(), jobs = store.load();
  const a = job('a'); jobs.push(a, job('b'), job('c')); store.save(jobs);
  a.name = 'in-flight mutation'; store.save(jobs); assert.equal(store.get('a')!.name, a.name);
  const version = store.version(); jobs.splice(0, 1); store.save(jobs);
  assert.deepEqual(jobs.map(item => item.id), ['b', 'c']);
  assert.equal(store.get('a'), undefined);
  assert.deepEqual(store.changes(version).filter(row => row.deleted).map(row => row.id), ['a']);
  jobs[0].parts.push({ id: 'p', name: 'x', order: 1 } as any); store.save(jobs);
  const reopened = open(); reopened.load(); assert.equal(reopened.get('b')!.parts[0].name, 'x');
});
test('large assets are not loaded until accessed, and failure rolls back live references', t => {
  const { open } = fixture(t), store = open(), jobs = store.load();
  const a = job('a'); a.transcriptWords = Array.from({ length: 1200 }, (_, i) => ({ word: 'word', start: i, end: i + 1 }));
  jobs.push(a); store.save(jobs);
  const reopened = open(), current = reopened.load(), read = fs.readFileSync;
  let assetReads = 0;
  const stub = t.mock.method(fs, 'readFileSync', (...args: any[]) => { if (String(args[0]).includes('.assets')) assetReads++; return (read as any)(...args); });
  const saved = reopened.get('a')!; assert.equal(saved.name, 'a'); assert.equal(assetReads, 0);
  saved.personalRating = 2; reopened.save(current); assert.equal(assetReads, 0);
  assert.equal(saved.transcriptWords!.length, 1200); assert.equal(assetReads, 1); stub.mock.restore();
  saved.metadataDraft!.title = 'unsaved'; reopened.rollback(); assert.equal(saved.metadataDraft!.title, 'a');
});
test('normal array edits preserve object identity after eviction and save only the edited project', t => {
  const {open}=fixture(t),store=open(),jobs=store.load();
  jobs.push(...Array.from({length:100},(_,i)=>job(String(i))));store.save(jobs);
  const reopened=open(),loaded=reopened.load(),one=reopened.get('0')!;
  one.parts=[{id:'c',name:'C'},{id:'a',name:'A'},{id:'b',name:'B'}] as any;
  const retained=one.parts[0];
  one.parts.sort((a,b)=>a.name.localeCompare(b.name));
  one.parts=one.parts.filter(part=>part.id!=='b');
  for(const item of loaded) void item.metadataDraft;
  retained.durationSeconds=123;
  assert.deepEqual(one.parts.map(part=>part.id),['a','c']);assert.equal(one.parts[1].durationSeconds,123);
  const version=reopened.version();reopened.save(loaded);assert.deepEqual(reopened.changes(version).map(row=>row.id),['0']);
  const again=open();again.load();assert.equal(again.get('0')!.parts[1].durationSeconds,123);
});
