import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookInformation } from '../src/components/BookInformation';
import { BookCover } from '../src/components/BookCover';
import { PersonalRating } from '../src/components/PersonalRating';
import type { AudiobookMetadata } from '../src/types';

const metadata: AudiobookMetadata = {
  title: 'Earth Unaware', author: 'Orson Scott Card', narrator: 'Stefan Rudnicki',
  genres: [], language: 'eng', abridged: false, explicit: false, publishedYear: '2012',
};

test('book information uses saved metadata and renders complete credits and year', () => {
  const html = renderToStaticMarkup(<BookInformation metadata={metadata} fallbackTitle="Folder name" />);
  assert.match(html, /Earth Unaware/);
  assert.match(html, /Orson Scott Card/);
  assert.match(html, /Stefan Rudnicki/);
  assert.match(html, /2012/);
  assert.equal((html.match(/>\|</g) ?? []).length, 1);
  assert.doesNotMatch(html, /Folder name/);
});

test('missing credits and publication year do not create separators or placeholders', () => {
  for (const missing of [{ author: '' }, { narrator: '' }, { author: '', narrator: '' }]) {
    const html = renderToStaticMarkup(<BookInformation metadata={{ ...metadata, ...missing, publishedYear: ' ' }} fallbackTitle="Fallback" />);
    assert.doesNotMatch(html, />\|<|2012|Unknown|N\/A/);
  }
  const html = renderToStaticMarkup(<BookInformation metadata={{ ...metadata, title: ' ' }} fallbackTitle="Folder title" />);
  assert.match(html, /Folder title/);
});

test('long title and name lists wrap and preserve full names', () => {
  const title = 'A very long audiobook title '.repeat(12);
  const html = renderToStaticMarkup(<BookInformation metadata={{ ...metadata, title, authors: ['First Author', 'Last, First'], narrators: ['First Narrator', 'Second Narrator'] }} fallbackTitle="Fallback" />);
  assert.match(html, /break-words/);
  assert.ok(html.includes(title.trim()));
  assert.match(html, /First Author, Last, First/);
  assert.match(html, /First Narrator, Second Narrator/);
  assert.doesNotMatch(html, /truncate|line-clamp/);
});

test('cover uses supplied saved artwork with preserved proportions or the existing book icon', () => {
  const first = renderToStaticMarkup(<BookCover url="data:image/png;base64,first" title="Book A" />);
  const changed = renderToStaticMarkup(<BookCover url="data:image/png;base64,changed" title="Book A" />);
  const missing = renderToStaticMarkup(<BookCover title="Book B" />);
  assert.match(first, /data:image\/png;base64,first/);
  assert.match(first, /object-contain/);
  assert.match(changed, /data:image\/png;base64,changed/);
  assert.doesNotMatch(changed, /base64,first/);
  assert.match(missing, /No cover artwork/);
  assert.doesNotMatch(missing, /<img/);
});

test('personal rating exposes half-star keyboard semantics and distinguishes zero from unrated', () => {
  const rated = renderToStaticMarkup(<PersonalRating bookId="a" value={7} onChange={async () => {}} />);
  const zero = renderToStaticMarkup(<PersonalRating bookId="b" value={0} onChange={async () => {}} />);
  const unrated = renderToStaticMarkup(<PersonalRating bookId="c" value={null} onChange={async () => {}} />);
  assert.match(rated, /role="slider"/);
  assert.match(rated, /tabindex="0"/);
  assert.match(rated, /aria-valuenow="3.5"/);
  assert.match(rated, /aria-valuetext="3.5 out of 5 stars"/);
  assert.match(rated, /width:50%/);
  assert.match(zero, /aria-valuetext="0 out of 5 stars"/);
  assert.match(unrated, /aria-valuetext="Unrated"/);
  assert.equal((unrated.match(/width:0%/g) ?? []).length, 5);
});
