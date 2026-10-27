import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { existingChapterList } from './existing-chapters';

test('chapter sidecars require exclusive ownership or exact names and exact audio references', () => {
  const root = fs.mkdtempSync(path.resolve('.cache/existing-chapters-'));
  const file = path.join(root, 'Book.mp3'); fs.writeFileSync(file, 'fixture');
  const source = {file, durationSeconds: 60, chapters: []};
  const cue = (name: string) => `FILE "${name}" MP3\n TRACK 01 AUDIO\n TITLE "Opening"\n INDEX 01 00:00:00\n TRACK 02 AUDIO\n TITLE "Chapter One"\n INDEX 01 00:30:37\n`;
  const generic = path.join(root, 'chapters.cue');
  try {
    fs.writeFileSync(generic, cue('Book.mp3'));
    assert.equal(existingChapterList([source], ['mp3']).chapters[1].start, '00:00:30.493');
    fs.writeFileSync(path.join(root, 'Other.mp3'), 'unrelated book');
    assert.equal(existingChapterList([source], ['mp3']).chapters.length, 0, 'generic CUE in shared folder is ambiguous');
    fs.renameSync(generic, path.join(root, 'Book.mp3.cue'));
    assert.equal(existingChapterList([source], ['mp3']).chapters.length, 2, 'exact source filename and FILE reference prove ownership');
    fs.writeFileSync(path.join(root, 'Book.mp3.cue'), cue('Other.mp3'));
    assert.equal(existingChapterList([source], ['mp3']).chapters.length, 0, 'matching sidecar name cannot override a different FILE reference');
    fs.writeFileSync(path.join(root, 'Book.mp3.cue'), cue('Book.mp3').replace('00:30:37','01:30:00'));
    assert.equal(existingChapterList([source], ['mp3']).chapters.length, 0, 'out of range sidecar is rejected');
    fs.writeFileSync(path.join(root, 'Book.mp3.cue'), cue('Book.mp3'));
    fs.writeFileSync(path.join(root, 'Book.cue'), cue('Book.mp3'));
    assert.equal(existingChapterList([source], ['mp3']).chapters.length, 0, 'multiple eligible sidecars require user correction');
  } finally { fs.rmSync(root, {recursive:true,force:true}); }
});

test('embedded chapters take precedence and multipart offsets follow processing order', () => {
  const source = (file: string, durationSeconds: number) => ({file,durationSeconds,chapters:[{id:'one',start:'00:00:00.000',title:file}]});
  const result = existingChapterList([source('Part Two.mp3', 12.5), source('Part One.mp3', 10)], ['mp3']);
  assert.deepEqual(result.chapters.map(chapter => chapter.start), ['00:00:00.000','00:00:12.500']);
  assert.equal(result.source, 'Embedded chapters');
});
