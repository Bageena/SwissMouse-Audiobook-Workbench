import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChapterEntry } from '../src/types';
import { transformChapterTitles, type BulkTitleOperation } from '../src/utils/chapterBulkEdit';
import { undoChapterTitleCleanup } from '../src/utils/chapterTitles';

const chapters: ChapterEntry[] = [
  { id: 'a', start: '00:00:00.000', end: '00:01:00.000', title: 'Chapter 1: Jerusalem', headingType: 'numbered_chapter', chapterNumber: 1 },
  { id: 'b', start: '00:01:00.000', end: '00:02:00.000', title: 'chapter 2: Susan', headingType: 'numbered_chapter', chapterNumber: 2 },
  { id: 'c', start: '00:02:00.000', end: '00:03:00.000', title: 'Afterword', headingType: 'afterword' },
];
const replace = (extra: Partial<Extract<BulkTitleOperation, { kind: 'replace' }>> = {}): BulkTitleOperation =>
  ({ kind: 'replace', find: 'Chapter', replacement: 'Part', matchCase: false, wholeWord: false, regex: false, ...extra });
const all = { kind: 'all' } as const;

test('preview and apply count only changed titles and preserve every other chapter field', () => {
  const result = transformChapterTitles(chapters, replace(), all);
  assert.equal(result.error, null);
  assert.equal(result.changes.length, 2);
  assert.deepEqual(result.chapters.map(chapter => chapter.title), ['Part 1: Jerusalem', 'Part 2: Susan', 'Afterword']);
  result.chapters.forEach((chapter, index) => {
    const { title, titleManuallyEdited, ...rest } = chapter;
    const { title: originalTitle, titleManuallyEdited: originalFlag, ...originalRest } = chapters[index];
    assert.deepEqual(rest, originalRest);
    assert.equal(titleManuallyEdited, index < 2 ? true : originalFlag);
    assert.equal(chapters[index].title, originalTitle);
  });
  undoChapterTitleCleanup(result.chapters, result.changes).forEach((chapter, index) => {
    const { titleManuallyEdited: _flag, ...rest } = chapter;
    assert.deepEqual(rest, chapters[index]);
    assert.equal(chapter.titleManuallyEdited, chapters[index].titleManuallyEdited);
  });
});

test('selected scope, case sensitivity, whole words, and no matches', () => {
  const scope = { kind: 'selected', ids: new Set(['b']) } as const;
  assert.deepEqual(transformChapterTitles(chapters, replace(), scope).changes.map(change => change.id), ['b']);
  assert.deepEqual(transformChapterTitles(chapters, replace({ matchCase: true }), all).changes.map(change => change.id), ['a']);
  assert.equal(transformChapterTitles(chapters, replace({ find: 'Chap', wholeWord: true }), all).changes.length, 0);
  assert.equal(transformChapterTitles(chapters, replace({ find: 'missing' }), all).changes.length, 0);
  assert.equal(transformChapterTitles(chapters, replace(), { kind: 'selected', ids: new Set() }).changes.length, 0);
});

test('valid regex supports capture groups and invalid regex returns an error without changes', () => {
  const valid = transformChapterTitles(chapters, replace({ find: 'Chapter (\\d+)', replacement: 'Part $1', regex: true }), all);
  assert.equal(valid.changes.length, 2);
  assert.equal(valid.chapters[0].title, 'Part 1: Jerusalem');
  const invalid = transformChapterTitles(chapters, replace({ find: '[', regex: true }), all);
  assert.match(invalid.error || '', /Invalid regular expression/);
  assert.equal(invalid.chapters, chapters);
  assert.equal(invalid.changes.length, 0);
});

test('prepend, append, remove, and capitalization transformations', () => {
  assert.equal(transformChapterTitles(chapters, { kind: 'prepend', text: 'Part II: ' }, all).chapters[0].title, 'Part II: Chapter 1: Jerusalem');
  assert.equal(transformChapterTitles(chapters, { kind: 'append', text: ' - Remastered' }, all).chapters[0].title, 'Chapter 1: Jerusalem - Remastered');
  assert.equal(transformChapterTitles(chapters, { kind: 'remove', find: 'Chapter ', matchCase: false, wholeWord: false, regex: false }, all).chapters[0].title, '1: Jerusalem');
  assert.equal(transformChapterTitles(chapters, { kind: 'capitalization', style: 'title' }, all).chapters[1].title, 'Chapter 2: Susan');
  assert.equal(transformChapterTitles(chapters, { kind: 'capitalization', style: 'sentence' }, all).chapters[0].title, 'Chapter 1: jerusalem');
  assert.equal(transformChapterTitles(chapters, { kind: 'capitalization', style: 'upper' }, all).chapters[0].title, 'CHAPTER 1: JERUSALEM');
  assert.equal(transformChapterTitles(chapters, { kind: 'capitalization', style: 'lower' }, all).chapters[0].title, 'chapter 1: jerusalem');
});

test('undo skips titles manually changed after bulk apply', () => {
  const result = transformChapterTitles(chapters, replace(), all);
  const subsequentlyEdited = result.chapters.map(chapter => chapter.id === 'a' ? { ...chapter, title: 'Custom' } : chapter);
  const undone = undoChapterTitleCleanup(subsequentlyEdited, result.changes);
  assert.equal(undone[0].title, 'Custom');
  assert.equal(undone[1].title, chapters[1].title);
});
