import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LIBRARY_TEMPLATE, libraryRelativePath, validateLibraryTemplate } from '../src/utils/libraryPath';

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
