import type { AudiobookJob, ChapterEntry } from '../types';
import { initialDetectedChapters } from './chapterSuggestions';

export interface ChapterActivity { key: string; message: string; at: number; }
/** Ignore recalculated default ends; report explicit user edits and membership/order changes. */
export function chapterActivity(before: ChapterEntry[], after: ChapterEntry[], at = Date.now()): ChapterActivity[] {
  const previous = new Map(before.map(chapter => [chapter.id, chapter]));
  const next = new Set(after.map(chapter => chapter.id));
  const events: ChapterActivity[] = [];
  for (const chapter of after) {
    const old = previous.get(chapter.id);
    const name = chapter.title || 'Untitled chapter';
    if (!old) { events.push({ key: `${chapter.id}:add`, message: `Added ${name} at ${chapter.start}`, at }); continue; }
    if (old.title !== chapter.title) events.push({ key: `${chapter.id}:title`, message: `Renamed chapter to ${name}`, at });
    if (old.start !== chapter.start) events.push({ key: `${chapter.id}:start`, message: `${name}: set start to ${chapter.start}`, at });
    if (old.end !== chapter.end && chapter.endManuallyEdited) events.push({ key: `${chapter.id}:end`, message: `${name}: set end to ${chapter.end}`, at });
  }
  for (const chapter of before) if (!next.has(chapter.id)) events.push({ key: `${chapter.id}:remove`, message: `Removed ${chapter.title || 'untitled chapter'}`, at });
  const sharedBefore = before.filter(chapter => next.has(chapter.id)).map(chapter => chapter.id);
  const sharedAfter = after.filter(chapter => previous.has(chapter.id)).map(chapter => chapter.id);
  if (sharedBefore.some((id, index) => id !== sharedAfter[index])) events.push({ key: 'order', message: 'Reordered chapters', at });
  return events;
}
export function appendChapterActivity(feed: ChapterActivity[], events: ChapterActivity[]): ChapterActivity[] {
  const result = [...feed];
  for (const event of events) {
    const last = result[result.length - 1];
    // Coalesce typing in one field instead of recording every keystroke.
    if (last?.key === event.key && event.at - last.at < 2000) result[result.length - 1] = event;
    else result.push(event);
  }
  return result.slice(-50);
}
/** A saved review is never treated as the original detection result. */
export function defaultReviewChapters(job: AudiobookJob): ChapterEntry[] | undefined {
  if (job.chapterReviewBaseline?.length) return job.chapterReviewBaseline.map(chapter => ({ ...chapter }));
  if ((!job.chapterSource || job.chapterSource === 'whisperx') && job.candidates.length) {
    return initialDetectedChapters(job.candidates);
  }
  if (job.chapterSource === 'existing_chapters' && job.existingChapters?.length) return job.existingChapters.map(chapter => ({ ...chapter }));
  return undefined;
}
