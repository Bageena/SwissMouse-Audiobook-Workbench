import type { ChapterEntry, HeadingType } from '../types';

export type ChapterNumberFormat = 'numerical' | 'roman' | 'written';
export const CHAPTER_TIMESTAMP_EPSILON_MS = 1;

export function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      cells.push(cell.trim()); cell = '';
    } else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

const SMALL = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

export function formatTimestampMs(ms: number): string {
  const value = Math.max(0, Math.round(ms));
  return `${Math.floor(value / 3600000).toString().padStart(2, '0')}:${(Math.floor(value / 60000) % 60).toString().padStart(2, '0')}:${(Math.floor(value / 1000) % 60).toString().padStart(2, '0')}.${(value % 1000).toString().padStart(3, '0')}`;
}

export function parseChapterTimestamp(value: string | undefined): number | null {
  const match = value?.trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) return null;
  const [, hours, minutes, seconds, milliseconds] = match;
  if (+minutes >= 60 || +seconds >= 60) return null;
  return (+hours * 3600 + +minutes * 60 + +seconds) * 1000 + +milliseconds;
}

export function isIncompleteChapter(chapter: ChapterEntry): boolean {
  return !!chapter.isMissing || parseChapterTimestamp(chapter.start) === null;
}

function roman(value: number): string {
  const symbols: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let result = '';
  for (const [amount, symbol] of symbols) while (value >= amount) { result += symbol; value -= amount; }
  return result;
}

function written(value: number): string {
  if (value < 20) return SMALL[value];
  if (value < 100) return TENS[Math.floor(value / 10)] + (value % 10 ? `-${SMALL[value % 10]}` : '');
  if (value < 1000) return `${SMALL[Math.floor(value / 100)]} Hundred${value % 100 ? ` ${written(value % 100)}` : ''}`;
  return String(value);
}

export function formatChapterTitle(value: number, format: ChapterNumberFormat): string {
  return `Chapter ${format === 'roman' ? roman(value) : format === 'written' ? written(value) : value}`;
}

export function inferChapterNumberFormat(chapters: ChapterEntry[]): ChapterNumberFormat {
  for (const chapter of chapters) {
    const suffix = /^chapter\s+(.+)$/i.exec(chapter.title.trim())?.[1];
    if (!suffix) continue;
    if (/^\d+$/.test(suffix)) return 'numerical';
    if (/^[MDCLXVI]+$/i.test(suffix)) return 'roman';
    if (/^[a-z]+(?:[ -][a-z]+)*$/i.test(suffix)) return 'written';
  }
  return 'numerical';
}

function numberedChapter(chapter: ChapterEntry): chapter is ChapterEntry & { chapterNumber: number; headingType: HeadingType } {
  return chapter.headingType === 'numbered_chapter' && Number.isInteger(chapter.chapterNumber) && chapter.chapterNumber! > 0;
}

export function insertMissingChapterPlaceholders(chapters: ChapterEntry[], format = inferChapterNumberFormat(chapters)): ChapterEntry[] {
  const result: ChapterEntry[] = [];
  for (let index = 0; index < chapters.length; index++) {
    const current = chapters[index];
    result.push(current);
    const next = chapters[index + 1];
    if (!next || !numberedChapter(current) || !numberedChapter(next)) continue;
    const gap = next.chapterNumber - current.chapterNumber;
    if (gap <= 1 || gap > 100) continue;
    for (let number = current.chapterNumber + 1; number < next.chapterNumber; number++) {
      result.push({
        id: `missing-chapter-${number}-${current.id}-${next.id}`,
        start: '',
        end: '',
        title: formatChapterTitle(number, format),
        headingType: 'numbered_chapter',
        chapterNumber: number,
        isMissing: true,
        notes: 'Missing timestamp',
      });
    }
  }
  return result;
}

export function applyDefaultChapterEnds(chapters: ChapterEntry[], durationSeconds?: number): ChapterEntry[] {
  const durationMs = Number.isFinite(durationSeconds) ? Math.round(durationSeconds! * 1000) : null;
  return chapters.map((chapter, index) => {
    if (chapter.isMissing || parseChapterTimestamp(chapter.start) === null || chapter.endManuallyEdited) return chapter;
    let boundary: number | null = null;
    for (let nextIndex = index + 1; nextIndex < chapters.length; nextIndex++) {
      boundary = parseChapterTimestamp(chapters[nextIndex].start);
      if (boundary !== null) break;
    }
    const defaultEnd = boundary !== null ? boundary - CHAPTER_TIMESTAMP_EPSILON_MS : durationMs;
    return { ...chapter, end: defaultEnd !== null ? formatTimestampMs(defaultEnd) : '' };
  });
}

export function prepareChapters(chapters: ChapterEntry[], durationSeconds?: number, format?: ChapterNumberFormat): ChapterEntry[] {
  return applyDefaultChapterEnds(insertMissingChapterPlaceholders(chapters, format), durationSeconds);
}

export function validateChapterEntries(chapters: ChapterEntry[], durationSeconds?: number): string | null {
  if (!chapters.length) return 'Chapter list is empty.';
  const missingIndex = chapters.findIndex(isIncompleteChapter);
  if (missingIndex >= 0) return `Row ${missingIndex + 1} (${chapters[missingIndex].title}): missing start timestamp.`;
  const durationMs = Number.isFinite(durationSeconds) ? Math.round(durationSeconds! * 1000) : null;
  for (let index = 0; index < chapters.length; index++) {
    const chapter = chapters[index];
    if (!chapter.title.trim()) return `Row ${index + 1}: Title cannot be blank.`;
    const start = parseChapterTimestamp(chapter.start);
    const end = parseChapterTimestamp(chapter.end);
    if (start === null) return `Row ${index + 1} (${chapter.title}): invalid Start Timestamp. Use HH:MM:SS.mmm.`;
    if (end === null) return `Row ${index + 1} (${chapter.title}): invalid End Timestamp. Use HH:MM:SS.mmm.`;
    if (end <= start) return `Row ${index + 1} (${chapter.title}): End Timestamp must be after Start Timestamp.`;
    if (durationMs !== null && (start >= durationMs || end > durationMs)) return `Row ${index + 1} (${chapter.title}): timestamps exceed the audio duration.`;
    if (index > 0) {
      const previousStart = parseChapterTimestamp(chapters[index - 1].start);
      if (previousStart !== null && start <= previousStart) return `Row ${index + 1} (${chapter.title}): Start Timestamp must be after the previous chapter start.`;
    }
    for (let nextIndex = index + 1; nextIndex < chapters.length; nextIndex++) {
      const nextStart = parseChapterTimestamp(chapters[nextIndex].start);
      if (nextStart === null) continue;
      if (end >= nextStart) return `Row ${index + 1} (${chapter.title}): End Timestamp must be before ${chapters[nextIndex].title}'s start.`;
      break;
    }
  }
  return null;
}
