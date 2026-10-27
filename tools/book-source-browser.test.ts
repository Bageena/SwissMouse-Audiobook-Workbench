import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBookFolder, listBookDirectory, listBookTree, moveBookFiles, rebaseBookMembership, resolveBookAudio } from './book-source-browser';
import type { AudiobookJob } from '../src/types';
import { sourceOrderCompare } from '../src/utils/sourceStructure';

test('book source browser lists nested files and safely organizes them inside one root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-source-tree-'));
  try {
    fs.mkdirSync(path.join(root, 'Disc 1')); fs.mkdirSync(path.join(root, 'Disc 2'));
    fs.mkdirSync(path.join(root, '.swissmouse-work'));
    fs.writeFileSync(path.join(root, 'Disc 1', 'Track 2.mp3'), 'source');
    fs.writeFileSync(path.join(root, 'Disc 2', 'Track 10.mp3'), 'source');
    fs.writeFileSync(path.join(root, 'cover.jpg'), 'cover');
    fs.writeFileSync(path.join(root, 'metadata.json'), '{}');
    fs.writeFileSync(path.join(root, '.swissmouse-work', 'analysis.wav'), 'working');
    assert.equal(resolveBookAudio(root, 'Disc 1/Track 2.mp3', new Set(['mp3'])), path.join(root, 'Disc 1', 'Track 2.mp3'));
    assert.throws(() => resolveBookAudio(root, '../outside.mp3', new Set(['mp3'])), /inside this book/);
    assert.throws(() => resolveBookAudio(root, '.swissmouse-work/analysis.wav', new Set(['wav'])), /workspace/);
    assert.throws(() => resolveBookAudio(root, 'metadata.json', new Set(['mp3'])), /audio file/);
    const before = listBookTree(root, new Set(['mp3']));
    assert.equal(before.filter(entry => entry.audio).length, 2);
    assert.equal(before.filter(entry => entry.type === 'folder').length, 2);
    assert.ok(before.some(entry => entry.relativePath === 'Disc 1/Track 2.mp3'));
    assert.ok(!before.some(entry => entry.relativePath.includes('.swissmouse-work')));
    assert.equal(createBookFolder(root, 'Disc 1', 'Chapters 01-10'), 'Disc 1/Chapters 01-10');
    const moved = moveBookFiles(root, ['Disc 2/Track 10.mp3'], 'Disc 1/Chapters 01-10');
    assert.equal(moved[0].relativePath, 'Disc 1/Chapters 01-10/Track 10.mp3');
    assert.ok(fs.existsSync(path.join(root, moved[0].relativePath)));
    assert.throws(() => moveBookFiles(root, ['cover.jpg'], '../outside'), /inside this book/);
    assert.throws(() => moveBookFiles(root, ['metadata.json'], '.swissmouse-work'), /workspace/);
    assert.equal(fs.readFileSync(path.join(root, 'cover.jpg'), 'utf8'), 'cover');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('source order uses disc and track metadata then natural folder/file numbers', () => {
  const paths = ['Disc 10/Track 2.mp3', 'Disc 2/Track 10.mp3', 'Disc 2/Track 2.mp3'].map(relativePath => ({ relativePath }));
  assert.deepEqual(paths.sort(sourceOrderCompare).map(item => item.relativePath), ['Disc 2/Track 2.mp3', 'Disc 2/Track 10.mp3', 'Disc 10/Track 2.mp3']);
  const metadata = [{ relativePath: 'A.mp3', discNumber: 2, trackNumber: 1 }, { relativePath: 'B.mp3', discNumber: 1, trackNumber: 10 }, { relativePath: 'C.mp3', discNumber: 1, trackNumber: 2 }];
  assert.deepEqual(metadata.sort(sourceOrderCompare).map(item => item.relativePath), ['C.mp3', 'B.mp3', 'A.mp3']);
  assert.deepEqual(['Track 10.mp3', 'Track 2.mp3'].map(relativePath => ({ relativePath })).sort(sourceOrderCompare).map(item => item.relativePath), ['Track 2.mp3', 'Track 10.mp3']);
});

test('directory navigation is shallow, lists folders first and stops at the filesystem root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-directory-'));
  try {
    fs.mkdirSync(path.join(root, 'Nested')); fs.mkdirSync(path.join(root, '.swissmouse-work'));
    fs.writeFileSync(path.join(root, 'Nested', 'inside.mp3'), 'audio');
    fs.writeFileSync(path.join(root, 'track.mp3'), 'audio');
    fs.writeFileSync(path.join(root, 'notes.txt'), 'notes');
    const listing = listBookDirectory(root, new Set(['mp3']));
    assert.equal(listing.directory, root);
    assert.equal(listing.parent, path.dirname(root));
    assert.deepEqual(listing.entries.map(entry => entry.name), ['Nested', 'notes.txt', 'track.mp3']);
    assert.equal(listing.entries.filter(entry => entry.audio).length, 1);
    assert.equal(listBookDirectory(path.join(root, 'Nested'), new Set(['mp3'])).parent, root);
    assert.throws(() => listBookDirectory(path.join(root, '.swissmouse-work'), new Set(['mp3'])), /processing/);
    assert.throws(() => listBookDirectory(root, new Set(['mp3']), [root]), /processing/);
    assert.throws(() => listBookDirectory('relative-folder', new Set(['mp3'])), /absolute/);
    assert.equal(listBookDirectory(path.parse(root).root, new Set(['mp3'])).parent, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('attaching outside a book rebases membership without changing physical or logical source paths', () => {
  const root = path.resolve('fixture'), source = path.join(root, 'Book');
  const observation = { relativePath: '01.mp3', storedName: '01.mp3', fileName: '01.mp3' };
  const job = { source: { kind: 'inbox', mode: 'folder', path: source }, sourceFolderPath: source,
    parts: [{ id: 'keep-id', name: '01.mp3', sourceRelativePath: '01.mp3', order: 1 }],
    discoveredFiles: [observation], sourceInventory: [observation], excludedSourceFiles: ['02.mp3'], explicitlyAddedSourceFiles: ['01.mp3'],
    sourcePathIdentity: { '01.mp3': 'original-logical-identity' }, sourceFileStamps: { '01.mp3': { sizeBytes: 123 } },
    chapters: [{ title: 'Manual chapter' }], metadataDraft: { title: 'Unfinished draft' } } as unknown as AudiobookJob;
  const result = rebaseBookMembership(job, source, [path.join(root, 'Extras', '03.mp3')]);
  assert.equal(result, root); assert.equal(job.sourceFolderPath, root); assert.equal(job.source!.path, source);
  assert.equal(path.resolve(root, job.parts[0].name), path.join(source, '01.mp3'));
  assert.equal(job.parts[0].id, 'keep-id'); assert.equal(job.parts[0].order, 1);
  assert.equal(job.discoveredFiles![0].relativePath, 'Book/01.mp3', 'shared inventory objects are rebased once');
  assert.equal(job.discoveredFiles![0].storedName, 'Book/01.mp3');
  assert.deepEqual(job.excludedSourceFiles, ['Book/02.mp3']);
  assert.deepEqual(job.explicitlyAddedSourceFiles, ['Book/01.mp3']);
  assert.equal(job.sourcePathIdentity!['Book/01.mp3'], 'original-logical-identity');
  assert.equal(job.sourceFileStamps!['Book/01.mp3'].sizeBytes, 123);
  assert.equal(job.metadataDraft!.title, 'Unfinished draft'); assert.equal(job.chapters[0].title, 'Manual chapter');
});
