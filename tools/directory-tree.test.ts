import test from 'node:test';
import assert from 'node:assert/strict';
import { containsDirectory, directoryKey, directoryTrail, filesystemRoot } from '../src/utils/directoryTree';

test('folder navigation reveals Windows drive and UNC ancestors without crossing sibling prefixes', () => {
  assert.equal(directoryKey('D:\\Books\\'), directoryKey('d:/books'));
  assert.equal(containsDirectory('D:\\Books', 'd:\\Bookshelf'), false);
  assert.deepEqual(directoryTrail('D:\\', 'D:\\Books\\Disc 2'), ['D:\\', 'D:\\Books', 'D:\\Books\\Disc 2']);
  assert.deepEqual(directoryTrail('D:\\Books', 'd:\\Books\\Disc 2'), ['D:\\Books', 'D:\\Books\\Disc 2']);
  assert.equal(filesystemRoot('D:\\Books\\Disc 2'), 'D:\\');
  assert.equal(filesystemRoot('\\\\server\\share\\Books'), '\\\\server\\share');
  assert.deepEqual(directoryTrail('\\\\server\\share', '\\\\server\\share\\Books\\Disc 1'), ['\\\\server\\share', '\\\\server\\share\\Books', '\\\\server\\share\\Books\\Disc 1']);
  assert.equal(containsDirectory('\\\\server\\share', '\\\\server\\share-other'), false);
});

test('portable folder navigation preserves POSIX case and root boundaries', () => {
  assert.equal(containsDirectory('/Books', '/books'), false);
  assert.deepEqual(directoryTrail('/', '/Books/Disc 1'), ['/', '/Books', '/Books/Disc 1']);
  assert.deepEqual(directoryTrail('/Books', '/Elsewhere'), []);
  assert.equal(filesystemRoot('/Books/Disc 1'), '/');
});
