import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AudiobookMetadata } from '../src/types';
import { alphabetical, QUICK_ADD_CATEGORIES, quickAddCategory } from '../src/utils/metadataQuickAdd';
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

test('first quick add fills genre, later choices fill sorted tags without duplicates', () => {
  let metadata = quickAddCategory(empty, 'Science Fiction');
  for (const value of ['Space Opera', 'Time Travel', 'Aliens', 'Aliens']) metadata = quickAddCategory(metadata, value);
  assert.deepEqual(metadata.genres, ['Science Fiction']);
  assert.deepEqual(metadata.tags, ['Aliens', 'Space Opera', 'Time Travel']);
  assert.equal(quickAddCategory(metadata, 'science fiction'), metadata);
  assert.deepEqual(audiobookshelfMetadata(metadata).genres, ['Science Fiction']);
  assert.deepEqual(audiobookshelfMetadata(metadata).tags, ['Aliens', 'Space Opera', 'Time Travel']);
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
