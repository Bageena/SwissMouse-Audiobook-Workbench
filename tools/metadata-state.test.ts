import test from 'node:test';
import assert from 'node:assert/strict';
import { recordMetadataEdit, mergeDetectedMetadata, retainMetadataOverrides } from './metadata-state';
import type { AudiobookJob, AudiobookMetadata } from '../src/types';
test('explicit empty fields, false values and removed covers survive discarded scan state', () => {
  const detected = { title: 'Detected', author: 'Author', narrator: 'Narrator', genres: ['Genre'], explicit: true, cover: { source: 'local', url: 'old' } } as AudiobookMetadata;
  const job = { metadata: detected, libraryScan: { detectedMetadata: detected } } as AudiobookJob;
  const edited = { ...detected, title: 'Edited', narrator: '', genres: [], explicit: false, cover: null };
  recordMetadataEdit(job, edited); job.metadata = edited;
  retainMetadataOverrides(job); job.libraryScan = undefined;
  const refreshed = mergeDetectedMetadata(job, { ...detected, title: 'New scan' });
  assert.deepEqual(refreshed, edited);
  assert.equal(job.metadataRevision, 1);
});
test('confirmed audio membership does not freeze untouched detected metadata', () => {
  const before = { title: 'Title', author: 'Old author' } as AudiobookMetadata;
  const job = { sourceMembership: 'confirmed', metadata: before, libraryScan: { detectedMetadata: before } } as AudiobookJob;
  assert.equal(mergeDetectedMetadata(job, { ...before, author: 'Correct author' }).author, 'Correct author');
});
