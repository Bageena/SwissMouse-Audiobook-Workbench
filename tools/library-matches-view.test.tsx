import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LibraryManager } from '../src/components/LibraryManager';
import type { LibraryBook } from '../src/types';

test('duplicate count is pending before the first check, even while the review panel is collapsed', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  try {
    const book = {
      id: 'matched-book', name: 'Earth Afire', status: 'draft', rootType: 'library', createdAt: '2026-10-12',
      metadata: { title: 'Earth Afire', author: 'Orson Scott Card', narrator: '', genres: [], language: 'eng', abridged: false, explicit: false },
      matchKinds: ['book'],
    } as LibraryBook;
    const html = renderToStaticMarkup(<LibraryManager books={[book]}
      onOpen={() => {}} onSave={async () => {}} onWriteAudioMetadata={async () => ({ written: [], failures: [] })}
      onUpdateJson={async () => ({ written: [], failures: [] })} onMoveFolders={async () => ({ moved: [], failures: [], cancelled: false })}
      onRelink={async () => null} onMoveToLibrary={async () => undefined}
      onOpenFolder={async () => {}} onRefresh={async () => {}} onDelete={async () => {}} onDeleteMany={async () => {}} />);
    assert.match(html, /aria-expanded="false" aria-busy="true"/);
    assert.match(html, /Potential Duplicates \(Checking…\)/);
    assert.doesNotMatch(html, /Potential Duplicates \(0\)|No matches in this view/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
