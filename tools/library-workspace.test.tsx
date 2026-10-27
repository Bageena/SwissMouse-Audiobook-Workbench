import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyLibraryFilters, matchesLibraryFilters, loadCollections, loadSavedSearches, loadLibraryBrowse, writeStored } from '../src/utils/libraryWorkspace';
import { LibraryNavigation } from '../src/components/LibraryNavigation';
import { ActivityPanel } from '../src/components/ActivityPanel';
import type { LibraryBook } from '../src/types';

const book = { id: 'one', name: 'Source folder', formats: ['M4B'], metadata: { title: 'A Book', author: 'René Author', authors: ['Another Creator'], narrator: 'Reader', narrators: ['Other Voice'], series: 'A Series', genres: ['Fantasy'], tags: ['Research'], description: 'A synopsis' } } as LibraryBook;
test('combined library filters search aliases, tags, and formats across the catalog before paging', () => {
  const filters = { creator: 'another', narrator: 'other voice', series: 'series', tag: 'research', format: 'm4b' };
  assert.equal(matchesLibraryFilters(book, filters, 'synopsis'), true);
  for (const key of Object.keys(filters) as (keyof typeof filters)[]) assert.equal(matchesLibraryFilters(book, { ...filters, [key]: 'absent' }), false, key);
  assert.equal(matchesLibraryFilters(book, emptyLibraryFilters, 'Ｒｅｓｅａｒｃｈ'), true);
  assert.equal(matchesLibraryFilters(book, { ...emptyLibraryFilters, format: 'mp3' }), false);
  const catalog = Array.from({ length: 2000 }, (_, i) => ({ ...book, id: String(i), metadata: { ...book.metadata, title: `Book ${i}` } }));
  assert.deepEqual(catalog.filter(item => matchesLibraryFilters(item, emptyLibraryFilters, 'Book 1999')).slice(0, 25).map(item => item.id), ['1999']);
});

test('workspace storage validates damaged preferences and preserves collection identity lists', () => {
  const previous = ['localStorage', 'sessionStorage'].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  try {
    for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(globalThis, key, { configurable: true, value: storage });
    values.set('swissmouse-collections', JSON.stringify([{ id: 'collection', name: 'Reading', bookIds: ['one', 'one', 'missing', 7] }, { name: 'Invalid' }]));
    assert.deepEqual(loadCollections(), [{ id: 'collection', name: 'Reading', bookIds: ['one', 'missing'] }]);
    values.set('swissmouse-saved-searches', JSON.stringify([{ id: 'search', name: 'Research', root: 'inbox', collectionId: 'collection', filters: { tag: 'Research', creator: 4 }, availability: 'broken' }]));
    assert.equal(loadSavedSearches()[0].filters.creator, '');
    assert.equal(loadSavedSearches()[0].filters.tag, 'Research');
    assert.equal(loadSavedSearches()[0].collectionId, 'collection');
    assert.equal(loadSavedSearches()[0].availability, 'available');
    values.set('swissmouse-library-workspace', JSON.stringify({ root: 'elsewhere', selected: ['one', 'one', 1], page: -4, scrollTop: -2, filters: { format: 'm4b' } }));
    assert.deepEqual(loadLibraryBrowse().selected, ['one']);
    assert.equal(loadLibraryBrowse().page, 0);
    assert.equal(loadLibraryBrowse().scrollTop, 0);
    assert.equal(loadLibraryBrowse().root, undefined);
    assert.equal(writeStored('example', { value: 2 }), true);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Blocked'); } });
    assert.deepEqual(loadCollections(), []);
    assert.equal(writeStored('example', {}), false);
  } finally { ['localStorage', 'sessionStorage'].forEach((key, i) => { if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!); else Reflect.deleteProperty(globalThis, key); }); }
});

test('sidebar discloses real locations, collections, and saved searches without adding media workflows', () => {
  const props = { collapsed: false, onCollapse() {}, root: 'inbox', onRoot() {}, collections: [{ id: 'c', name: 'Read later', bookIds: ['one'] }], collectionId: '', onCollection() {}, onCreateCollection() {}, onDeleteCollection() {}, saved: [{ id: 's', name: 'My search', root: 'inbox' as const, query: '', filters: emptyLibraryFilters, availability: 'all' as const, sort: 'title', descending: false }], onSearch() {}, onDeleteSearch() {} };
  const html = renderToStaticMarkup(<LibraryNavigation {...props} />);
  for (const text of ['Inbox', 'Library', 'Workbench projects', 'Read later', 'My search', 'Create collection']) assert.ok(html.includes(text));
  assert.ok(!renderToStaticMarkup(<LibraryNavigation {...props} collapsed />).includes('Create collection'));
});

test('activity stays out of the workspace until opened and presents existing operations', () => {
  const props = { open: false, onClose() {}, job: null, scanning: true, scanWarning: '', building: false, validating: false, exportMessage: '', exportError: null, logs: [], onLogs() {}, onReview() {} };
  assert.equal(renderToStaticMarkup(<ActivityPanel {...props} />), '');
  const html = renderToStaticMarkup(<ActivityPanel {...props} open />);
  for (const text of ['Scanning media folders', 'Audio processing', 'Import / export', 'Final check', 'Technical logs']) assert.ok(html.includes(text));
  assert.ok(!html.includes('Cancel active processing'), 'no cancel control without a server-advertised cancellable operation');
});
