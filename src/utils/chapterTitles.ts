import type { ChapterEntry } from '../types';

// English MLA-style title case, not a grammatical parser. Ambiguous particles
// and prepositions remain editable; distinctive existing mixed case is kept.
const minor = new Set('a an the and but or nor for so yet at by in of on to up as per via with from into onto upon over off out about above across after against along among around before behind below beneath beside between beyond during except inside near outside past through throughout toward towards under underneath until within without'.split(' '));
const acronyms = new Set('AI API BBC CIA CPU DNA EU FBI GPU NASA NATO RNA SQL TV UK UN USA USB USSR'.split(' '));
const roman = /^(?=[MDCLXVI]+$)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

export function cleanChapterTitle(input: string): string {
  const text = input.trim().replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:!?\)\]\}])/gu, '$1')
    .replace(/([\(\[\{])\s+/gu, '$1')
    .replace(/\s*([\u2013\u2014])\s*/gu, ' $1 ');
  const words = [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)];
  const hasLowercase = /\p{Ll}/u.test(text);
  let index = 0;
  return text.replace(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu, (word, offset: number) => {
    const position = index++;
    const lower = word.toLowerCase();
    const stem = word.replace(/['’]s$/i, '');
    const previous = words[position - 1];
    const between = text.slice(previous ? previous.index! + previous[0].length : 0, offset);
    const boundary = position === 0 || position === words.length - 1 || /[:.!?\u2013\u2014]/u.test(between);
    // Uppercase Roman numbers, known acronyms, and uppercase islands in
    // otherwise mixed/lowercase titles are useful intentional spelling.
    if (roman.test(word) || acronyms.has(stem) || (hasLowercase && /^[A-Z]{2,6}$/.test(stem) && !minor.has(lower))) return word;
    if (!boundary && minor.has(lower)) return lower;
    if (/\p{Ll}.*\p{Lu}|\p{Lu}['’]\p{Lu}/u.test(word)) return word; // McDonald, iPhone, O'Neill
    return lower.replace(/^\p{L}/u, letter => letter.toUpperCase());
  });
}

export type TitleCleanupUndo = { id: string; before: string; after: string; manuallyEdited?: boolean }[];
export function cleanChapterTitles(chapters: ChapterEntry[]) {
  const undo: TitleCleanupUndo = [];
  const cleaned = chapters.map(chapter => {
    const title = cleanChapterTitle(chapter.title);
    if (title === chapter.title) return chapter;
    undo.push({ id: chapter.id, before: chapter.title, after: title, manuallyEdited: chapter.titleManuallyEdited });
    return { ...chapter, title, titleManuallyEdited: true };
  });
  return { chapters: cleaned, undo };
}

// Restore only this action's titles; subsequent edits, deletion and movement
// of rows, timestamps, and added chapters survive undo.
export function undoChapterTitleCleanup(chapters: ChapterEntry[], undo: TitleCleanupUndo) {
  const byId = new Map(undo.map(entry => [entry.id, entry]));
  return chapters.map(chapter => {
    const prior = byId.get(chapter.id);
    return prior && chapter.title === prior.after
      ? { ...chapter, title: prior.before, titleManuallyEdited: prior.manuallyEdited }
      : chapter;
  });
}
