import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Step3Metadata } from '../src/components/Step3Metadata';
import { DesktopWorkspace } from '../src/components/DesktopWorkspace';
import type { AudiobookJob, AudiobookMetadata } from '../src/types';

const metadata: AudiobookMetadata = {
  title: 'Saved Title', subtitle: 'Saved Subtitle', author: 'Author', narrator: 'Narrator',
  series: 'Series', seriesSequence: '2', genres: ['Fantasy'], tags: ['Existing Tag'],
  description: 'Saved summary', publisher: 'Publisher', publishedYear: '2025',
  language: 'eng', abridged: true, isbn: '123', asin: 'B123',
  copyright: 'Rights holder', explicit: true,
};
const job = { id: 'layout-fixture', name: 'Saved Title', status: 'draft', metadata, chapters: [], parts: [], exports: [] } as unknown as AudiobookJob;
const props = {
  job, quickTags: ['Fantasy', 'New Tag'], onAddQuickTag: async () => {},
  onSaveMetadata: async () => {}, onUpdateJson: async () => [], onMoveExportFolder: async () => '',
  onPersistDraft: async () => {}, onNextStep: () => {},
};

test('metadata sections expose independent window controls and retain explicit form ownership', () => {
  const html = renderToStaticMarkup(<DesktopWorkspace page="metadata-test"><Step3Metadata {...props} mode="review" /></DesktopWorkspace>);
  for (const title of ['Cover art', 'Book title and contributors', 'Series &amp; Taxonomy', 'Description', 'Publication', 'Identifiers']) {
    assert.ok(html.includes(`aria-label="Window options for ${title}"`), title);
  }
  for (const control of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    assert.match(control[0], /form="metadata-fields"/);
  }
});

for (const mode of ['import', 'file-review', 'review'] as const) {
  test(`${mode} uses the shared full-width metadata layout and Quick Tags`, () => {
    const html = renderToStaticMarkup(<Step3Metadata {...props} mode={mode} />);
    const pos = (value: string) => { const index = html.indexOf(value); assert.ok(index >= 0, `${value} missing`); return index; };
    assert.ok(pos('Cover art') < pos('Book title and contributors'));
    assert.ok(pos('Publication') < pos('Identifiers'));
    assert.ok(pos('Copyright Notice') < pos('Identifiers'));
    assert.ok(pos('Content Advisory') < pos('Saved summary'));
    assert.ok(!html.includes('>Book Details</h3>'));
    assert.ok(html.includes('aria-label="Collections"'));
    assert.ok(html.includes('aria-label="Additional Series"'));
    assert.ok(html.includes('workspace-columns'));
    assert.ok(html.includes('metadata-cover-column'));
    assert.ok(html.includes('Quick Add (2 choices)'));
    assert.ok(html.includes('Add a tag...'));
    assert.ok(html.includes('Saved summary'));
    assert.ok(html.includes('value="2025"'));
  });
}

test('Review Metadata reuses the unified Book Files panel while keeping processing actions', () => {
  const review = renderToStaticMarkup(<Step3Metadata {...props} mode="review" onRerunMetadata={async () => {}} />);
  const files = renderToStaticMarkup(<Step3Metadata {...props} mode="file-review" />);
  for (const html of [review, files]) {
    assert.match(html, /metadata-unified workspace-panel/);
    assert.match(html, /workspace-panel-header workspace-toolbar/);
    assert.match(html, /aria-label="Collapse metadata"/);
    assert.doesNotMatch(html, /aria-label="More metadata actions"/);
    assert.match(html, /Rebuild exmetadata.json/);
    for (const name of ['cover art', 'book title and contributors', 'series and taxonomy', 'book details']) {
      assert.ok(html.includes(`Resize ${name} height`), `Missing shared resize handle: ${name}`);
    }
  }
  assert.match(review, /Continue to export/);
  assert.doesNotMatch(review, /Save and close|Organize Library folder/);
  assert.match(files, /Save and close/);
});
