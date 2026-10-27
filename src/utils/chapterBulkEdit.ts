import type { ChapterEntry } from '../types';
import { cleanChapterTitle, type TitleCleanupUndo } from './chapterTitles';

export type BulkTitleOperation =
  | { kind: 'replace'; find: string; replacement?: string; matchCase: boolean; wholeWord: boolean; regex: boolean }
  | { kind: 'remove'; find: string; replacement?: string; matchCase: boolean; wholeWord: boolean; regex: boolean }
  | { kind: 'prepend'; text: string }
  | { kind: 'append'; text: string }
  | { kind: 'capitalization'; style: 'title' | 'sentence' | 'upper' | 'lower' };

export type BulkTitleScope = { kind: 'all' } | { kind: 'selected'; ids: ReadonlySet<string> };

export function validateBulkTitleOperation(operation: BulkTitleOperation): string | null {
  if (operation.kind === 'prepend' || operation.kind === 'append') return operation.text ? null : 'Enter text to add.';
  if (operation.kind === 'capitalization') return null;
  if (!operation.find) return 'Enter text to find.';
  if (operation.regex) {
    try { new RegExp(operation.find, operation.matchCase ? 'gu' : 'giu'); }
    catch (error) { return `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`; }
  }
  return null;
}

function changeTitle(title: string, operation: BulkTitleOperation): string {
  if (operation.kind === 'prepend') return operation.text + title;
  if (operation.kind === 'append') return title + operation.text;
  if (operation.kind === 'capitalization') {
    if (operation.style === 'title') return cleanChapterTitle(title);
    if (operation.style === 'upper') return title.toLocaleUpperCase();
    if (operation.style === 'lower') return title.toLocaleLowerCase();
    return title.toLocaleLowerCase().replace(/^([^\p{L}]*)(\p{L})/u, (_, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase());
  }
  const source = operation.regex ? operation.find : operation.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = operation.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])` : source;
  const expression = new RegExp(pattern, operation.matchCase ? 'gu' : 'giu');
  if (operation.kind === 'remove') return title.replace(expression, '');
  return operation.regex
    ? title.replace(expression, operation.replacement || '')
    : title.replace(expression, () => operation.replacement || '');
}

export function transformChapterTitles(chapters: ChapterEntry[], operation: BulkTitleOperation, scope: BulkTitleScope) {
  const error = validateBulkTitleOperation(operation);
  if (error) return { chapters, changes: [] as TitleCleanupUndo, error };
  const changes: TitleCleanupUndo = [];
  const updated = chapters.map(chapter => {
    if (scope.kind === 'selected' && !scope.ids.has(chapter.id)) return chapter;
    const title = changeTitle(chapter.title, operation);
    if (title === chapter.title) return chapter;
    changes.push({ id: chapter.id, before: chapter.title, after: title, manuallyEdited: chapter.titleManuallyEdited });
    return { ...chapter, title, titleManuallyEdited: true };
  });
  return { chapters: updated, changes, error: null };
}
