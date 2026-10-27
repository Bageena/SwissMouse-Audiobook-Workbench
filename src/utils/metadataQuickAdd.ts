import type { AudiobookMetadata } from '../types';

// Initial choices for a new installation. User changes live in config.json.
export const QUICK_ADD_CATEGORIES = [
  'Adventure', 'Aliens', 'Art', 'Autobiography', 'Biography', 'Business',
  'Children', 'Classics', 'Contemporary', 'Crime', 'Dark Fantasy', 'Detective',
  'Dystopian', 'Education', 'Epic Fantasy', 'Essays', 'Fairy Tales', 'Family',
  'Fantasy', 'Fiction', 'Food', 'Graphic Novels', 'Health', 'Historical Fiction',
  'History', 'Horror', 'Humor', 'Literary Fiction', 'Magic', 'Memoir',
  'Middle Grade', 'Military', 'Mystery', 'Mythology', 'Non-Fiction', 'Paranormal',
  'Philosophy', 'Poetry', 'Politics', 'Psychology', 'Religion', 'Romance',
  'Science', 'Science Fiction', 'Self-Help', 'Space Opera', 'Suspense',
  'Thriller', 'Time Travel', 'Young Adult',
] as const;

export const alphabetical = (values: readonly string[]) =>
  [...values].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

export const normalizeQuickTag = (value: string) => value.trim().replace(/\s+/g, ' ');
export const quickTagKey = (value: string) => normalizeQuickTag(value).toLocaleLowerCase();
export function cleanQuickTags(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.map(normalizeQuickTag).filter(value => {
    const key = quickTagKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type QuickAddTarget = 'genres' | 'tags';

export function quickAddCategory(metadata: AudiobookMetadata, value: string, target: QuickAddTarget): AudiobookMetadata {
  const category = normalizeQuickTag(value);
  if (!category) return metadata;
  const matches = (item: string) => quickTagKey(item) === quickTagKey(category);
  if (target === 'genres') {
    if (metadata.genres.some(matches)) return metadata;
    return {
      ...metadata,
      genres: alphabetical([...metadata.genres.filter(item => item.trim() && !matches(item) && item.trim().toLowerCase() !== 'audiobook'), category]),
      tags: (metadata.tags || []).filter(item => !matches(item)),
    };
  }
  if ((metadata.tags || []).some(matches)) return metadata;
  return {
    ...metadata,
    genres: metadata.genres.filter(item => !matches(item)),
    tags: alphabetical([...(metadata.tags || []), category]),
  };
}
