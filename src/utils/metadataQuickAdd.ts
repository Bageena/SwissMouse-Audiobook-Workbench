import type { AudiobookMetadata } from '../types';

// Goodreads-inspired browse categories. Keep quick-add choices in one place.
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

export const selectedCategory = (metadata: AudiobookMetadata, value: string) =>
  metadata.genres.some(item => item.toLowerCase() === value.toLowerCase())
  || (metadata.tags || []).some(item => item.toLowerCase() === value.toLowerCase());

export function quickAddCategory(metadata: AudiobookMetadata, value: string): AudiobookMetadata {
  const category = value.trim();
  if (!category || selectedCategory(metadata, category)) return metadata;
  const genres = metadata.genres.filter(item => item.trim() && item.toLowerCase() !== 'audiobook');
  if (!genres.length) return { ...metadata, genres: [category] };
  return { ...metadata, tags: alphabetical([...(metadata.tags || []), category]) };
}
