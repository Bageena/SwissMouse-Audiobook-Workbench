import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AudiobookMetadata } from '../src/types';
import { alphabetical, QUICK_ADD_CATEGORIES, cleanQuickTags, quickAddCategory } from '../src/utils/metadataQuickAdd';
import { audiobookshelfMetadata } from '../src/utils/audiobookshelfMetadata';

const empty: AudiobookMetadata = {
  title: 'Example', author: 'A Writer', narrator: 'A Reader', genres: ['Audiobook'],
  language: 'eng', abridged: false, explicit: false,
};

test('quick add choices are unique, alphabetical, and exclude Audiobook', () => {
  assert.equal(QUICK_ADD_CATEGORIES.length, 50);
  assert.deepEqual([...QUICK_ADD_CATEGORIES], alphabetical(QUICK_ADD_CATEGORIES));
  assert.equal(new Set(QUICK_ADD_CATEGORIES).size, QUICK_ADD_CATEGORIES.length);
  assert.equal(QUICK_ADD_CATEGORIES.includes('Audiobook' as never), false);
});

test('Quick Tags normalize whitespace and case without changing the first display value', () => {
  assert.deepEqual(cleanQuickTags(['Cosmic Horror', ' cosmic   horror ', 'FANTASY', 'fantasy', '']), ['Cosmic Horror', 'FANTASY']);
  const metadata = quickAddCategory(empty, ' Cosmic  Horror ', 'tags');
  assert.equal(quickAddCategory(metadata, 'cosmic horror', 'tags'), metadata);
  assert.deepEqual(metadata.tags, ['Cosmic Horror']);
});

test('active field accepts multiple quick add genres and tags without duplicates', () => {
  let metadata = empty;
  for (const value of ['Science Fiction', 'Adventure', 'Fantasy']) metadata = quickAddCategory(metadata, value, 'genres');
  for (const value of ['Space Opera', 'Time Travel', 'Aliens']) metadata = quickAddCategory(metadata, value, 'tags');
  assert.deepEqual(metadata.genres, ['Adventure', 'Fantasy', 'Science Fiction']);
  assert.deepEqual(metadata.tags, ['Aliens', 'Space Opera', 'Time Travel']);
  assert.equal(quickAddCategory(metadata, 'fantasy', 'genres'), metadata);
  assert.equal(quickAddCategory(metadata, 'ALIENS', 'tags'), metadata);
  assert.deepEqual(audiobookshelfMetadata(metadata).genres, metadata.genres);
  assert.deepEqual(audiobookshelfMetadata(metadata).tags, metadata.tags);
});

test('quick add moves an already selected category to the active field', () => {
  let metadata = quickAddCategory(empty, 'Fantasy', 'tags');
  metadata = quickAddCategory(metadata, 'fantasy', 'genres');
  assert.deepEqual(metadata.genres, ['fantasy']);
  assert.deepEqual(metadata.tags, []);
  metadata = quickAddCategory(metadata, 'Fantasy', 'tags');
  assert.deepEqual(metadata.genres, []);
  assert.deepEqual(metadata.tags, ['Fantasy']);
});

test('Audiobookshelf sidecar uses its book fields and numeric chapter times', () => {
  const sidecar = audiobookshelfMetadata({ ...empty, genres: ['History'], tags: ['Memoir'], series: 'Stories', seriesSequence: '2', releaseDate: '2024-01-02' }, [
    { id: 'one', start: '00:00:01.250', end: '00:01:02.500', title: 'Opening' },
  ]);
  assert.deepEqual(sidecar.authors, ['A Writer']);
  assert.deepEqual(sidecar.narrators, ['A Reader']);
  assert.deepEqual(sidecar.series, ['Stories #2']);
  assert.deepEqual(sidecar.chapters, [{ id: 0, start: 1.25, end: 62.5, title: 'Opening' }]);
  assert.equal(sidecar.publishedDate, '2024-01-02');
});
