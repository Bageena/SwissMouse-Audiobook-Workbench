import type { ChapterEntry } from '../types';

// Ignore editor-only transcript lookup data while comparing the chapter list
// that will actually be saved and exported.
export function chapterReviewChanged(draft: ChapterEntry[], saved: ChapterEntry[]): boolean {
  if (draft.length !== saved.length) return true;
  return draft.some((chapter, index) => {
    const previous = saved[index];
    return chapter.id !== previous.id || chapter.title !== previous.title ||
      chapter.start !== previous.start || chapter.end !== previous.end ||
      chapter.isMissing !== previous.isMissing ||
      chapter.titleManuallyEdited !== previous.titleManuallyEdited ||
      chapter.startManuallyEdited !== previous.startManuallyEdited ||
      chapter.endManuallyEdited !== previous.endManuallyEdited ||
      chapter.manuallyInserted !== previous.manuallyInserted;
  });
}
