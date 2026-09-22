import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChapterEntry } from '../src/types';
import { applyChapterNumberFormat, applyDefaultChapterEnds, getSessionChapterNumberFormat, insertMissingChapterPlaceholders, isIncompleteChapter, prepareChapters, validateChapterEntries } from '../src/utils/chapters';
import { planChapterExport } from '../src/utils/chapterExport';

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

test('number modes rename all automatic chapters, preserve prose/manual titles and timestamps', () => {
  const source = [
    { ...chapter(1, '00:00:00.000'), title: 'Chapter One', end: '00:00:09.999' },
    { id: 'legacy', start: '00:00:10.000', title: 'Chapter II' },
    { ...chapter(3, '00:00:20.000'), title: 'The Return' },
    { ...chapter(4, '00:00:30.000'), titleManuallyEdited: true },
    { id: 'prose', start: '00:00:40.000', title: 'Chapter Sunset' },
  ];
  for (const [mode, titles] of [
    ['numerical', ['Chapter 1', 'Chapter 2']], ['roman', ['Chapter I', 'Chapter II']], ['written', ['Chapter One', 'Chapter Two']],
  ] as const) {
    const result = applyChapterNumberFormat(source, mode);
    assert.deepEqual(result.slice(0, 2).map(c => c.title), titles);
    assert.deepEqual(result.slice(2), source.slice(2));
    assert.deepEqual(result.map(c => [c.start, c.end]), source.map(c => [c.start, c.end]));
  }
  assert.equal(getSessionChapterNumberFormat('no-browser-storage'), 'numerical');
});

test('number format accepts detected spacing and punctuation without renaming prose', () => {
  const chapters = ['Chapter Twenty Three', 'CHAPTER: 23', 'Chapter One Hundred and Twelve', 'Chapter Twenty\u2011Three', 'Chapter One More Thing']
    .map((title, index) => ({ id: String(index), start: '00:00:00.000', title }));
  assert.deepEqual(applyChapterNumberFormat(chapters, 'numerical').map(c => c.title),
    ['Chapter 23', 'Chapter 23', 'Chapter 112', 'Chapter 23', 'Chapter One More Thing']);
});

test('export plan closes gaps, trims the tail, and remaps markers without mutating source entries', () => {
  const source = [
    { ...chapter(1, '00:00:00.000'), end: '00:00:02.000' },
    { ...chapter(2, '00:00:03.000'), end: '00:00:04.000' },
    { ...chapter(3, '00:00:05.000'), end: '00:00:08.000' },
  ];
  const plan = planChapterExport(source, 9);
  assert.equal(plan.durationSeconds, 6);
  assert.equal(plan.removedSeconds, 3);
  assert.deepEqual(plan.chapters.map(c => c.start), ['00:00:00.000', '00:00:02.000', '00:00:03.000']);
  assert.equal(source[1].start, '00:00:03.000');
  assert.throws(() => planChapterExport([{ ...source[0], end: '00:00:03.500' }, source[1]], 9), /overlapping/i);
});

test('automatic 1ms separators preserve the full recording and copy path', () => {
  const source = prepareChapters([chapter(1, '00:00:00.000'), chapter(2, '00:00:03.000')], 9);
  const plan = planChapterExport(source, 9);
  assert.equal(plan.trimmed, false);
  assert.equal(plan.durationSeconds, 9);
  assert.equal(plan.chapters, source);
});
