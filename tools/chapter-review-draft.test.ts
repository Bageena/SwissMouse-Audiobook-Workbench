import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterReviewChanged } from '../src/utils/chapterReviewDraft';
import { applyChapterNumberFormat } from '../src/utils/chapters';
import type { ChapterEntry } from '../src/types';

test('chapter titles reformatted in the editor remain pending until saved', () => {
  const saved: ChapterEntry[] = [
    { id: 'one', title: 'chapter three', start: '00:00:00.000', end: '00:00:01.999' },
    { id: 'two', title: 'CHAPTER XIII', start: '00:00:02.000', end: '00:00:03.000' },
  ];
  const displayed = applyChapterNumberFormat(saved, 'numerical');
  assert.deepEqual(displayed.map(chapter => chapter.title), ['Chapter 3', 'Chapter 13']);
  assert.equal(chapterReviewChanged(displayed, saved), true);
  assert.equal(chapterReviewChanged(displayed.map(chapter => ({ ...chapter, transcriptWordIndex: 5 })), displayed), false);
  assert.equal(chapterReviewChanged([displayed[1], displayed[0]], displayed), true);
  assert.equal(chapterReviewChanged([{ ...displayed[0], title: 'Chapter Thirteen', titleManuallyEdited: true }, displayed[1]], displayed), true);
});
