import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LIBRARY_TEMPLATE, finalOutputRoot, libraryLocationPreview, libraryRelativePath, validateLibraryTemplate } from '../src/utils/libraryPath';
import { audiobookTags } from './audiobook-metadata';
import { extendedMetadata } from '../src/utils/extendedMetadata';

const book = { title: 'Hitchhikers Guide to the Galaxy', subtitle: 'A novel', author: 'Douglas Adams', narrator: 'Douglas Adams', series: "Hitchhiker's Guide to the Galaxy", seriesSequence: '1', genres: [], language: 'eng', abridged: false, explicit: false };

test('default folder pattern follows the requested example and omits subtitle', () => {
  assert.deepEqual(libraryRelativePath(DEFAULT_LIBRARY_TEMPLATE, book), ['Douglas Adams', "Hitchhiker's Guide to the Galaxy", '001 Hitchhikers Guide to the Galaxy [Douglas Adams]']);
});

test('missing optional fields leave a useful book folder', () => {
  assert.deepEqual(libraryRelativePath(DEFAULT_LIBRARY_TEMPLATE, { ...book, narrator: '', series: '', seriesSequence: '' }), ['Douglas Adams', 'Hitchhikers Guide to the Galaxy']);
});

test('custom fields work and unsafe path components are rejected', () => {
  assert.deepEqual(libraryRelativePath('%Author%/%Book Title% - %Subtitle%', { ...book, title: 'CON', author: 'A/B' }), ['A B', '_CON - A novel']);
  assert.match(validateLibraryTemplate('../%Book Title%') || '', /relative/);
  assert.match(validateLibraryTemplate('%Unknown%') || '', /listed/);
});

test('year, publisher, and edition tokens preserve optional path segments', () => {
  const template = '%Author%/%Year%/%Publisher%/%Book Title% [%Edition%]';
  assert.deepEqual(libraryRelativePath(template, { ...book, publishedYear: '1979', publisher: 'Pan Books', edition: 'Unabridged' }),
    ['Douglas Adams', '1979', 'Pan Books', 'Hitchhikers Guide to the Galaxy [Unabridged]']);
  assert.deepEqual(libraryRelativePath(template, book), ['Douglas Adams', 'Hitchhikers Guide to the Galaxy']);
});

test('preview fills known metadata and preserves missing placeholders without creating their folders', () => {
  const metadata = { ...book, series: '', narrator: '', seriesSequence: '' };
  assert.equal(libraryLocationPreview('D:/Inbox', DEFAULT_LIBRARY_TEMPLATE, metadata),
    'Inbox\\Douglas Adams/%Series%/%Series Number% Hitchhikers Guide to the Galaxy [%Narrator%]');
  assert.deepEqual(libraryRelativePath(DEFAULT_LIBRARY_TEMPLATE, metadata), ['Douglas Adams', 'Hitchhikers Guide to the Galaxy']);
});

test('final exports avoid managed workspaces and retain explicit destinations', () => {
  assert.equal(finalOutputRoot('D:/Inbox/.swissmouse-work', 'M:/Library'), 'M:/Library');
  assert.equal(finalOutputRoot('D:\\Inbox\\.swissmouse-work', 'M:/Library'), 'M:/Library');
  assert.equal(finalOutputRoot('D:/Custom', 'M:/Library'), 'D:/Custom');
  assert.equal(finalOutputRoot(undefined, 'M:/Library'), 'M:/Library');
});

test('filesystem narrator credits abbreviate casts without changing tags or sidecars', () => {
  for (const [names, expected] of [
    [[], ''], [['Reader, Junior'], 'Reader, Junior'], [['One', 'Two'], 'Cast'],
    [['One', 'Two', 'Three'], 'Cast'], [['One', 'Two', 'Three', 'Four'], 'Full Cast'],
    [['One', ' one ', ''], 'One'],
  ] as [string[], string][]) {
    const metadata = { ...book, narrator: names.join(', '), narrators: names };
    assert.equal(libraryRelativePath('%Narrator%/%Book Title%', metadata)[0], expected || book.title);
    assert.equal(libraryLocationPreview('Library', '%Narrator%', metadata), `Library\\${expected || '%Narrator%'}`);
    assert.equal(audiobookTags(metadata, undefined, {}, 'm4b').composer, metadata.narrator);
    assert.deepEqual(extendedMetadata(metadata).metadata.narrators, names);
  }
  assert.equal(libraryRelativePath('%Narrator%', { ...book, narrator: 'One; Two; Three; Four' })[0], 'Full Cast');
});
