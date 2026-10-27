import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectStore } from './project-store';
import type { AudiobookJob } from '../src/types';

const projects = (title: string) => [{ id: 'one', name: title, parts: [], metadataDraft: { title } }] as AudiobookJob[];
test('atomic project saves retain the prior complete store on replacement failure', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-store-'));
  try {
    const file = path.join(root, 'jobs.json'), store = new ProjectStore(file);
    store.load(); store.save(projects('original'));
    const rename = fs.renameSync;
    const stub = t.mock.method(fs, 'renameSync', (from, to) => { if (String(to) === file) throw new Error('disk unavailable'); rename(from, to); });
    assert.throws(() => store.save(projects('new')), /disk unavailable/);
    stub.mock.restore();
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), projects('original'));
    assert.deepEqual(store.snapshot(), projects('original'));
    assert.ok(!fs.readdirSync(root).some(name => name.endsWith('.tmp')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('corrupt project stores recover a validated backup and preserve damaged bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-recovery-'));
  try {
    const file = path.join(root, 'jobs.json'), warnings: string[] = [], store = new ProjectStore(file, value => warnings.push(value));
    store.load(); store.save(projects('old')); store.save(projects('new'));
    fs.writeFileSync(file, '{broken');
    assert.deepEqual(new ProjectStore(file, value => warnings.push(value)).load(), projects('old'));
    const retained = fs.readdirSync(root).find(name => name.includes('.corrupt-'))!;
    assert.equal(fs.readFileSync(path.join(root, retained), 'utf8'), '{broken');
    assert.equal(warnings.length, 1);
    fs.writeFileSync(file, '{broken'); fs.unlinkSync(file + '.bak');
    assert.throws(() => new ProjectStore(file).load(), /No valid backup/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('large payloads migrate losslessly and ordinary saves do not rewrite them', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-assets-'));
  try {
    const file = path.join(root, 'jobs.json'), store = new ProjectStore(file);
    const jobs = projects('original');
    jobs[0].metadataDraft!.description = 'large cover or text '.repeat(10000);
    jobs[0].transcriptWords = Array.from({ length: 1200 }, (_, i) => ({ word: 'word', start: i + .123456, end: i + .654321 })) as any;
    const original = structuredClone(jobs);
    fs.writeFileSync(file, JSON.stringify(jobs));
    assert.deepEqual(store.load(), jobs);
    store.save(jobs);
    assert.ok(fs.statSync(file).size < 2000);
    assert.deepEqual(new ProjectStore(file).load(), original);
    const written: string[] = [], write = fs.writeFileSync;
    const stub = t.mock.method(fs, 'writeFileSync', (...args: any[]) => { written.push(String(args[1])); return (write as any)(...args); });
    jobs[0].name = 'updated';
    store.save(jobs);
    stub.mock.restore();
    assert.ok(written.every(text => text.length < 2000), 'only the small manifests should be written');
    jobs[0].transcriptWords![0].start = .987654321;
    store.save(jobs);
    assert.equal(new ProjectStore(file).load()[0].transcriptWords![0].start, .987654321);
    fs.writeFileSync(file, '{broken');
    assert.equal(new ProjectStore(file).load()[0].transcriptWords![0].start, .123456);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('failed asset publication preserves the previous manifest and recoverable snapshot', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-assets-failure-'));
  try {
    const file = path.join(root, 'jobs.json'), store = new ProjectStore(file);
    store.load(); store.save(projects('original'));
    const next = projects('next'); next[0].metadataDraft!.description = 'x'.repeat(20000);
    const rename = fs.renameSync;
    const stub = t.mock.method(fs, 'renameSync', (from, to) => {
      if (String(to).includes('.assets')) throw new Error('asset disk unavailable');
      return rename(from, to);
    });
    assert.throws(() => store.save(next), /asset disk unavailable/);
    stub.mock.restore();
    assert.deepEqual(store.snapshot(), projects('original'));
    assert.deepEqual(new ProjectStore(file).load(), projects('original'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
