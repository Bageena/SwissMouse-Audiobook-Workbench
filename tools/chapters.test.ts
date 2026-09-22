import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChapterEntry } from '../src/types';
import { applyDefaultChapterEnds, insertMissingChapterPlaceholders, isIncompleteChapter, prepareChapters, validateChapterEntries } from '../src/utils/chapters';

const chapter = (number: number, start: string): ChapterEntry => ({
  id: `chapter-${number}`,
  start,
  title: `Chapter ${number}`,
  headingType: 'numbered_chapter',
  chapterNumber: number,
});

test('Chapter 15 to Chapter 17 inserts incomplete Chapter 16 in sequence', () => {
  const result = insertMissingChapterPlaceholders([chapter(15, '01:00:00.000'), chapter(17, '02:00:00.000')]);
  assert.deepEqual(result.map(item => item.title), ['Chapter 15', 'Chapter 16', 'Chapter 17']);
  assert.equal(result[1].start, '');
  assert.equal(result[1].isMissing, true);
  assert.equal(isIncompleteChapter(result[1]), true); // The editor uses this state for its red error row.
  assert.match(validateChapterEntries(result, 10800)!, /missing start timestamp/i);
});

test('Chapter 21 to Chapter 24 inserts Chapters 22 and 23', () => {
  const result = insertMissingChapterPlaceholders([chapter(21, '01:00:00.000'), chapter(24, '02:00:00.000')]);
  assert.deepEqual(result.map(item => item.chapterNumber), [21, 22, 23, 24]);
});

test('placeholder titles honor Roman and written number formats', () => {
  const source = [chapter(15, '01:00:00.000'), chapter(17, '02:00:00.000')];
  assert.equal(insertMissingChapterPlaceholders(source, 'roman')[1].title, 'Chapter XVI');
  assert.equal(insertMissingChapterPlaceholders(source, 'written')[1].title, 'Chapter Sixteen');
});

test('non-numbered headings do not imply missing chapters', () => {
  const epilogue: ChapterEntry = { id: 'epilogue', start: '02:00:00.000', title: 'Epilogue', headingType: 'back_matter' };
  assert.equal(insertMissingChapterPlaceholders([chapter(15, '01:00:00.000'), epilogue]).length, 2);
});

test('default ends use one millisecond before next start and audio duration for last chapter', () => {
  const result = prepareChapters([chapter(1, '00:00:00.000'), chapter(2, '00:10:00.000')], 1200);
  assert.equal(result[0].end, '00:09:59.999');
  assert.equal(result[1].end, '00:20:00.000');
  assert.equal(validateChapterEntries(result, 1200), null);
});

test('assigning a placeholder start clears its error after defaults are recalculated', () => {
  const initial = prepareChapters([chapter(15, '01:00:00.000'), chapter(17, '02:00:00.000')], 10800);
  const assigned = applyDefaultChapterEnds(initial.map(item => item.isMissing
    ? { ...item, start: '01:30:00.000', isMissing: false, startManuallyEdited: true }
    : item), 10800);
  assert.equal(validateChapterEntries(assigned, 10800), null);
  assert.equal(isIncompleteChapter(assigned[1]), false);
  assert.equal(assigned[0].end, '01:29:59.999');
  assert.equal(assigned[1].end, '01:59:59.999');
});

test('manual end shortening remains independent and overlapping ends are rejected', () => {
  const defaults = prepareChapters([chapter(1, '00:00:00.000'), chapter(2, '00:10:00.000')], 1200);
  const shortened = applyDefaultChapterEnds(defaults.map((item, index) => index === 0
    ? { ...item, end: '00:09:30.000', endManuallyEdited: true }
    : item), 1200);
  assert.equal(shortened[0].end, '00:09:30.000');
  assert.equal(shortened[1].start, '00:10:00.000');
  assert.equal(validateChapterEntries(shortened, 1200), null);
  const overlapping = shortened.map((item, index) => index === 0 ? { ...item, end: '00:10:00.000' } : item);
  assert.match(validateChapterEntries(overlapping, 1200)!, /must be before/i);
});

test('automatic recalculation preserves manual starts and ends', () => {
  const chapters = [
    { ...chapter(1, '00:00:05.000'), startManuallyEdited: true, end: '00:08:00.000', endManuallyEdited: true },
    chapter(2, '00:10:00.000'),
  ];
  const result = applyDefaultChapterEnds(chapters, 1200);
  assert.equal(result[0].start, '00:00:05.000');
  assert.equal(result[0].end, '00:08:00.000');
});
