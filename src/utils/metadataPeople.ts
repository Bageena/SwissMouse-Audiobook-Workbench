import type { AudiobookMetadata } from '../types';

export function metadataPeople(metadata: AudiobookMetadata, field: 'author' | 'narrator'): string[] {
  const text = metadata[field] || '';
  const people = metadata[field === 'author' ? 'authors' : 'narrators'];
  // Old records and text-only bulk edits remain compatible. Arrays are trusted
  // only while they describe the same displayed value.
  return people && people.join(', ') === text ? [...people] : text.split(',').map(value => value.trim()).filter(Boolean);
}
