import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { selectFile, visibleSelection, fileKind, type BrowserEntry } from '../src/utils/bookFiles';
import { AddFiles } from '../src/components/AddFiles';
import { FileBrowser } from '../src/components/FileBrowser';
import { registerBookFilesRoutes, recoverBookFilesOperations } from './book-files-routes';
import { ProcessingOrder } from '../src/components/ProcessingOrder';
import { checkedPath, copyEntry, rollbackCopies, validFileName, remapSourceReferences, type OwnedCopy } from './book-file-operations';
import { metadataFromTags } from './audiobook-metadata';
import type { AudiobookJob, WorkbenchConfig } from '../src/types';
import { recycleEntry } from './book-file-operations';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const entry = (name: string): BrowserEntry => ({ path: `/books/${name}`, relativePath: name, name, type: 'file', audio: true });
test('Windows recycling preserves the disposable fixture in the operating-system Recycle Bin', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'book-files-recycle-'));
  const file = path.join(root, "apostrophe's file.txt"); await fs.writeFile(file, 'Disposable SwissMouse recycle test');
  try {
    await recycleEntry(file); await assert.rejects(fs.stat(file));
    const script = "$items=@((New-Object -ComObject Shell.Application).NameSpace(10).Items() | Where-Object { $_.ExtendedProperty('System.Recycle.DeletedFrom') -eq $env:SWISSMOUSE_RECYCLE_TEST_ROOT } | ForEach-Object { @{name=$_.Name;path=$_.Path} }); ConvertTo-Json -InputObject $items -Compress";
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { windowsHide: true, env: { ...process.env, SWISSMOUSE_RECYCLE_TEST_ROOT: root } });
    const items = JSON.parse(stdout.trim()); assert.equal(items.length, 1); assert.match(items[0].name, /apostrophe/);
    assert.equal(await fs.readFile(items[0].path, 'utf8'), 'Disposable SwissMouse recycle test', 'recoverable bytes physically exist in Recycle Bin');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('selection follows paths through ranges, sorting, filtering, and windowing', () => {
  const files = Array.from({ length: 10000 }, (_, index) => entry(`${index}.mp3`));
  let selected = selectFile(files, new Set(), files[5].path, undefined, false, false);
  selected = selectFile(files, selected, files[500].path, files[5].path, true, false);
  assert.equal(selected.size, 2);
  selected = selectFile(files, selected, files[508].path, files[500].path, true, true);
  assert.equal(selected.size, 10);
  const filtered = [...files].reverse().filter(file => file.path === files[5].path);
  assert.deepEqual(visibleSelection(filtered, selected).map(file => file.path), [files[5].path]);
  assert.equal(selected.size, 10, 'hidden selections persist but cannot become command targets');
  assert.equal(fileKind(entry('movie.mkv')), 'video'); assert.equal(fileKind(entry('book.epub')), 'document');
});
const sample = (root: string): AudiobookJob => ({ id: 'book', name: 'Book', createdAt: new Date().toISOString(), status: 'draft', sourceFolderPath: root,
  source: { kind: 'external', mode: 'folder', path: root }, metadata: metadataFromTags({}, 'Book'), metadataDraft: { ...metadataFromTags({}, 'Manual Title'), author: 'Manual Author' },
  parts: [{ id: 'part', name: 'one.mp3', sourceRelativePath: 'one.mp3', sizeBytes: 5, durationSeconds: 2, bitrate: 128, order: 1 }], sourceMembership: 'confirmed',
  chapters: [{ id: 'chapter', title: 'Manual chapter', start: '00:00:00.250' }], candidates: [], logs: [], totalDurationSeconds: 2, totalSizeBytes: 5 });
test('Add Files initializes by contents and every view renders a bounded window', () => {
  const job = sample('/books');
  assert.match(renderToStaticMarkup(<AddFiles job={job} onChanged={async () => {}} />), /aria-expanded="false"/);
  assert.match(renderToStaticMarkup(<AddFiles job={{ ...job, parts: [] }} onChanged={async () => {}} />), /aria-expanded="true"/);
  assert.match(renderToStaticMarkup(<ProcessingOrder job={job} readiness={{ status: 'Ready', issues: [], durationSeconds: 24, durationComplete: true }} busy={false} onOrder={() => {}} onRemove={() => {}} />), /00:00:24\.000/);
  job.parts[0].chapterGroup = { id: 'opening', title: 'Opening scene' };
  const groupedMarkup = renderToStaticMarkup(<ProcessingOrder job={job} readiness={{ status: 'Ready', issues: [], durationSeconds: 24, durationComplete: true }} busy={false} onOrder={() => {}} onRemove={() => {}} onGroup={() => {}} />);
  assert.match(groupedMarkup, /Opening scene/);
  assert.match(groupedMarkup, /Select one.mp3 for grouping/);
  assert.match(groupedMarkup, /Chapter group name/);
  assert.match(groupedMarkup, /Ungroup selected/);
  for (const view of ['details', 'list', 'small', 'large'] as const) {
    const markup = renderToStaticMarkup(<FileBrowser entries={Array.from({ length: 10000 }, (_, index) => entry(`${index}.mp3`))} view={view} selected={new Set()} details={{}} busy={false} canEdit={true} onSelect={() => {}} onOpen={() => {}} onAdd={() => {}} onContext={() => {}} onVisible={() => {}} onEdit={async () => true} onKeyCommand={() => {}} />);
    assert.ok((markup.match(/role="row"/g) || []).length < 150, `${view} mounts only the window`);
  }
});

test('startup quarantines interrupted owned copies and repairs only successfully recycled membership', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'book-files-recovery-'));
  try {
    const source = path.join(root, 'source'); await fs.mkdir(source); const job = sample(source);
    const file = path.join(source, 'one.mp3'); await fs.writeFile(file, 'original');
    const owned: OwnedCopy[] = [], target = path.join(source, 'copy.mp3'); await copyEntry(file, target, owned);
    await fs.writeFile(path.join(root, 'book-files-interrupted.json'), JSON.stringify({ action: 'copy', jobId: job.id, committed: false, files: [file], moves: [{ from: file, to: target }], owned }));
    const messages: string[] = [];
    await recoverBookFilesOperations(root, [], [job], message => messages.push(message));
    assert.equal(await fs.readFile(file, 'utf8'), 'original'); await assert.rejects(fs.stat(target));
    assert.ok(messages.some(message => /owned copies moved/.test(message)));
    await fs.rename(file, path.join(root, 'recycled.mp3'));
    await fs.writeFile(path.join(root, 'book-files-deleted.json'), JSON.stringify({ action: 'delete', jobId: job.id, committed: true, files: [file], moves: [], owned: [] }));
    await recoverBookFilesOperations(root, [], [job], () => {}, (item, removed) => { item.parts = item.parts.filter(part => !removed.includes(part.name)); });
    assert.equal(job.parts.length, 0); assert.equal(await fs.readFile(path.join(root, 'recycled.mp3'), 'utf8'), 'original');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('exclusive copies preserve source bytes, reject collisions, and retain changed rollback files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'book-files-copy-'));
  try {
    const source = path.join(root, 'source'); await fs.mkdir(source); await fs.writeFile(path.join(source, 'audio.mp3'), 'encoded audio');
    const owned: OwnedCopy[] = []; const target = path.join(root, 'copy'); await copyEntry(source, target, owned);
    assert.equal(await fs.readFile(path.join(target, 'audio.mp3'), 'utf8'), 'encoded audio'); await assert.rejects(copyEntry(source, target), /exist/i);
    await fs.writeFile(path.join(target, 'audio.mp3'), 'externally changed'); await rollbackCopies(owned);
    assert.equal(await fs.readFile(path.join(target, 'audio.mp3'), 'utf8'), 'externally changed'); assert.equal(await fs.readFile(path.join(source, 'audio.mp3'), 'utf8'), 'encoded audio');
    for (const name of ['../escape', 'CON.mp3', 'bad:name', 'trailing.', '.swissmouse-work']) assert.throws(() => validFileName(name));
    await assert.rejects(checkedPath(source, [root]), /working files/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('folder remapping preserves part identities, exclusions, drafts, and chapters', () => {
  const root = path.resolve('fixture'); const job = sample(root);
  job.parts[0].name = job.parts[0].sourceRelativePath = 'Disc/one.mp3'; job.excludedSourceFiles = ['Disc/skip.mp3'];
  job.metadataDraft!.title = path.join(root, 'Disc', 'one.mp3');
  job.sourcePathIdentity = { 'Disc/one.mp3': path.join(root, 'Disc', 'one.mp3') };
  job.sourceFileStamps = { 'Disc/one.mp3': { sizeBytes: 5, modifiedMs: 42 } }; const before = structuredClone(job);
  remapSourceReferences(job, root, [{ from: path.join(root, 'Disc'), to: path.join(root, 'Renamed') }]);
  assert.equal(job.parts[0].sourceRelativePath, 'Renamed/one.mp3'); assert.equal(job.parts[0].id, 'part'); assert.deepEqual(job.excludedSourceFiles, ['Renamed/skip.mp3']);
  assert.deepEqual(job.metadataDraft, before.metadataDraft); assert.deepEqual(job.chapters, before.chapters); assert.equal(job.sourceFileStamps['Renamed/one.mp3'].modifiedMs, 42);
  assert.equal(job.sourcePathIdentity['Renamed/one.mp3'], before.sourcePathIdentity!['Disc/one.mp3']);
});
test('routes validate plans, undo renames, recover copy/cut failures, protect ownership, and commit new-book moves', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'book-files-api-'));
  const source = path.join(root, 'source'), inbox = path.join(root, 'inbox'), library = path.join(root, 'library');
  await Promise.all([source, inbox, library].map(folder => fs.mkdir(folder)));
  await fs.writeFile(path.join(source, 'one.mp3'), 'first encoded audio'); await fs.writeFile(path.join(source, 'two.mp3'), 'second encoded audio');
  const jobs = [sample(source)]; jobs[0].parts[0].sizeBytes = (await fs.stat(path.join(source, 'one.mp3'))).size;
  let locked = false, failPersist = false, failRecycle = false, probes = 0;
  const app = express(); app.use(express.json());
  const media = { tags: { title: 'Embedded', artist: 'File Author', composer: 'Narrator', date: '1999' }, durationSeconds: 2, bitrate: 128, format: 'mp3', codec: 'mp3', sampleRate: 44100, channels: 1 };
  const remove = (job: AudiobookJob, files: string[]) => { job.parts = job.parts.filter(part => !files.includes(part.sourceRelativePath || part.name)); job.excludedSourceFiles = [...new Set([...(job.excludedSourceFiles || []), ...files])]; job.sourceMembership = 'confirmed'; };
  const routes = registerBookFilesRoutes(app, { jobs: () => jobs, config: () => ({ inbox_folder: inbox, library_folder: library, library_template: '%Author%/%Book Title%' } as WorkbenchConfig), appRoot: root,
    root: job => job.sourceFolderPath, excluded: () => [path.join(root, '.swissmouse-work')], busy: () => locked, lock: (_id, state) => { locked = state; },
    persist: () => { if (failPersist) throw new Error('Injected persistence failure'); }, invalidate: job => { job.sourceFilesChanged = true; }, totals: () => {}, remove,
    read: async () => { probes++; return media; }, ffmpeg: () => '', ffprobe: () => '', log: () => {},
    select: async paths => ({ root: source, files: await Promise.all(paths.map(async file => ({ relativePath: path.basename(file), fileName: path.basename(file), folderName: 'source', sizeBytes: (await fs.stat(file)).size, durationSeconds: 2 }))) }),
    recycle: async file => { if (failRecycle) throw new Error('Injected recycle failure'); await fs.rename(file, path.join(root, 'recycled-' + path.basename(file))); },
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as any, base = `http://127.0.0.1:${address.port}/api/jobs/book/book-files`;
  const req = async (suffix = '', body?: unknown, expected = 200) => {
    const response = await fetch(base + suffix, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data: any = await response.json(); assert.equal(response.status, expected, JSON.stringify(data)); return data;
  };
  const operation = async (payload: any) => { const plan = await req('/operation', payload); return req('/operation', { ...payload, commit: true, token: plan.token }); };
  try {
    let tree = await req();
    for (let attempt=0;tree.indexing && attempt<80;attempt++) { await new Promise(resolve=>setTimeout(resolve,25)); tree=await req(); }
    assert.equal(tree.indexing,false); assert.equal(probes, 0, 'listing never probes audio'); assert.equal(tree.readiness.status, 'Ready');
    const observed = tree.entries.find((entry: any) => entry.name === 'one.mp3');
    await fs.utimes(path.join(source, 'one.mp3'), new Date(), new Date(observed.modifiedMs + 1000));
    await req('/edit', { directory: source, file: path.join(source, 'one.mp3'), field: 'name', value: 'stale.mp3', stamp: observed.stamp }, 400);
    const info = await req('/details', { directory: source, files: [path.join(source, 'one.mp3')] }); assert.equal(info[path.join(source, 'one.mp3')].author, 'File Author');
    await req('/mkdir', { directory: source, name: 'Created Folder' }); assert.ok((await fs.stat(path.join(source, 'Created Folder'))).isDirectory());
    const beforeFolders = structuredClone(jobs[0]), probesBeforeFolders = probes;
    let folders = await req('/folders?refresh=true');
    for (let attempt=0;folders.indexing && attempt<80;attempt++) { await new Promise(resolve=>setTimeout(resolve,25)); folders=await req('/folders'); }
    assert.deepEqual(folders.entries.map((entry: any) => entry.name), ['Created Folder']);
    assert.deepEqual(jobs[0], beforeFolders, 'folder navigation preserves the complete project');
    assert.equal(probes, probesBeforeFolders, 'folder navigation does not probe media');
    assert.equal(locked, false, 'folder navigation does not lock the project');
    await req('/folders?directory='+encodeURIComponent(path.join(root,'.swissmouse-work')), undefined, 400);
    await req('/mkdir', { directory: source, name: 'CON' }, 400);
    await fs.writeFile(path.join(source, 'Created Folder', 'note.txt'), 'folder contents');
    await operation({ action: 'rename-folder', directory: source, files: [path.join(source, 'Created Folder')], name: 'Renamed Folder' });
    assert.equal(await fs.readFile(path.join(source, 'Renamed Folder', 'note.txt'), 'utf8'), 'folder contents');
    await req('/edit', { directory: source, file: path.join(source, 'one.mp3'), field: 'name', value: '../escape.mp3' }, 400);
    await req('/edit', { directory: source, file: path.join(source, 'one.mp3'), field: 'name', value: 'two.mp3' }, 400);
    failPersist = true; await req('/edit', { directory: source, file: path.join(source, 'one.mp3'), field: 'name', value: 'rollback.mp3' }, 400);
    failPersist = false; assert.equal(await fs.readFile(path.join(source, 'one.mp3'), 'utf8'), 'first encoded audio');
    await req('/edit', { directory: source, file: path.join(source, 'one.mp3'), field: 'name', value: 'renamed.mp3' });
    assert.equal(jobs[0].parts[0].name, 'renamed.mp3'); await req('/undo', {}); assert.equal(jobs[0].parts[0].name, 'one.mp3');
    await fs.mkdir(path.join(source, 'copies')); await operation({ action: 'copy', directory: source, files: [path.join(source, 'one.mp3')], destination: path.join(source, 'copies') });
    assert.equal(await fs.readFile(path.join(source, 'copies', 'one.mp3'), 'utf8'), 'first encoded audio'); assert.equal(jobs[0].parts.length, 1, 'copy does not attach');
    await fs.mkdir(path.join(source, 'moved')); failRecycle = true;
    const cut = await operation({ action: 'cut', directory: source, files: [path.join(source, 'one.mp3')], destination: path.join(source, 'moved') });
    assert.match(cut.warning, /originals remain/); assert.equal(jobs[0].parts[0].name, 'moved/one.mp3'); assert.equal(await fs.readFile(path.join(source, 'one.mp3'), 'utf8'), 'first encoded audio'); failRecycle = false;
    const stale = await req('/operation', { action: 'delete', directory: source, files: [path.join(source, 'two.mp3')] }); await fs.appendFile(path.join(source, 'two.mp3'), ' changed');
    await req('/operation', { action: 'delete', directory: source, files: [path.join(source, 'two.mp3')], commit: true, token: stale.token }, 400);
    const other = sample(source); other.id = 'other'; other.parts[0].name = other.parts[0].sourceRelativePath = 'two.mp3'; jobs.push(other);
    await req('/operation', { action: 'delete', directory: source, files: [path.join(source, 'two.mp3')] }, 400);
    const create = { directory: source, files: [path.join(source, 'two.mp3')], title: 'New Book', author: 'New Author', destinationType: 'inbox' };
    const plan = await req('/create', create); assert.equal(jobs.length, 2); assert.equal(other.parts.length, 1); assert.equal(plan.transfers[0].name, 'Book');
    await req('/create', { ...create, destination: plan.destination, token: plan.token, commit: true });
    assert.equal(jobs.length, 3); assert.equal(other.parts.length, 0); assert.equal(jobs[2].parts.length, 1); assert.equal(jobs[2].sourceMembership, 'confirmed');
    assert.equal(await fs.readFile(path.join(plan.destination, 'two.mp3'), 'utf8'), 'second encoded audio changed'); await assert.rejects(fs.stat(path.join(source, 'two.mp3')));
    assert.equal(jobs[0].metadataDraft!.title, 'Manual Title'); assert.equal(jobs[0].chapters[0].title, 'Manual chapter');
    await operation({ action: 'delete', directory: path.join(source, 'moved'), files: [path.join(source, 'moved', 'one.mp3')] }); assert.equal(jobs[0].parts.length, 0);
    tree = await req(); assert.equal(tree.readiness.status, 'Empty');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await routes.close(); await fs.rm(root, { recursive: true, force: true }); }
});
