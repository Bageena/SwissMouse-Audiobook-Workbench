import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanChapterTitle, cleanChapterTitles, undoChapterTitleCleanup } from '../src/utils/chapterTitles';
import type { ChapterEntry } from '../src/types';

for (const [input, expected] of [
  ['  the fellowship   of the ring  ', 'The Fellowship of the Ring'],
  ['chapter  one', 'Chapter One'],
  ['the lion, the witch and the wardrobe', 'The Lion, the Witch and the Wardrobe'],
  ['a tale : the end of it', 'A Tale: The End of It'],
  ['  chapter XII ( 1984 ) ! ', 'Chapter XII (1984)!'],
  ['Chapter II: DNA and the FBI', 'Chapter II: DNA and the FBI'],
  ["the king’s well-being and O’Neill’s iPhone", "The King’s Well-Being and O’Neill’s iPhone"],
  ['THE FELLOWSHIP OF THE RING', 'The Fellowship of the Ring'],
  ['what we are and why we were', 'What We Are and Why We Were'],
  ['as if we knew because you came', 'As If We Knew Because You Came'],
  ['the road through the woods', 'The Road through the Woods'],
  ['to go on', 'To Go On'],
  ['chapter 123: an AI story', 'Chapter 123: An AI Story'],
  ['NASA’s mission and the FBI’s files', 'NASA’s Mission and the FBI’s Files'],
  ['\t \n', ''],
]) test(`title cleanup: ${JSON.stringify(input)}`, () => {
  assert.equal(cleanChapterTitle(input), expected);
  assert.equal(cleanChapterTitle(expected), expected, 'idempotent');
});

test('cleanup and undo preserve order, timestamps, numbering, placeholders, and later edits', () => {
  const chapters: ChapterEntry[] = [
    { id: 'a', title: ' the  beginning ', start: '00:00:01.200', end: '00:01:00.000', transcriptWordIndex: 9 },
    { id: 'b', title: 'the  middle', start: '', isMissing: true, chapterNumber: 3, titleManuallyEdited: true },
    { id: 'c', title: 'The End', start: '00:10:00.000' },
  ];
  const result = cleanChapterTitles(chapters);
  assert.equal(chapters[0].title, ' the  beginning ', 'input remains unchanged');
  assert.deepEqual(result.chapters.map(({ title, titleManuallyEdited, ...rest }) => rest), chapters.map(({ title, titleManuallyEdited, ...rest }) => rest));
  assert.equal(result.chapters[2], chapters[2]);
  assert.deepEqual(undoChapterTitleCleanup(result.chapters, result.undo), chapters.map(chapter => chapter.id === 'a' ? { ...chapter, titleManuallyEdited: undefined } : chapter));
  const later = [{ ...result.chapters[1], title: 'My new title' }, { ...result.chapters[0], start: '00:00:02.000' }];
  const restored = undoChapterTitleCleanup(later, result.undo);
  assert.equal(restored[0].title, 'My new title');
  assert.equal(restored[1].title, chapters[0].title);
  assert.equal(restored[1].start, '00:00:02.000');
});
