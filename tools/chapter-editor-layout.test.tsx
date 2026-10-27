import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AudiobookJob, ChapterEntry } from '../src/types';
import { Step2ChapterReview } from '../src/components/Step2ChapterReview';
import { BulkChapterEditor } from '../src/components/BulkChapterEditor';

const chapters: ChapterEntry[] = [{ id: 'a', start: '00:00:00.000', end: '00:01:00.000', title: 'Chapter 1' }];
const job = { id: 'chapter-layout', name: 'Example', status: 'merged', chapters, candidates: [], transcriptWords: [], parts: [], totalDurationSeconds: 60 } as unknown as AudiobookJob;

test('chapter toolbar and row actions have distinct locations', () => {
  const html = renderToStaticMarkup(<Step2ChapterReview job={job} onSaveChapters={async () => {}} onDraftChange={() => {}} onNextStep={() => {}} />);
  const table = html.slice(html.indexOf('<table role="table" aria-label="Chapters to export"'));
  const headerTools = html.slice(html.indexOf('aria-label="Chapter tools"'), html.indexOf('<table role="table" aria-label="Chapters to export"'));
  for (const label of ['Remove selected chapter', 'Move selected chapter up', 'Move selected chapter down']) {
    assert.ok(headerTools.includes(`aria-label="${label}"`));
    assert.ok(!table.includes(`aria-label="${label}"`));
  }
  assert.ok(table.includes('btn-play-chapter-'));
  assert.ok(!headerTools.includes('Play selected chapter'));
  assert.ok(table.indexOf('Drag to reorder') < table.indexOf('aria-label="Play Chapter 1"'));
  assert.ok(table.indexOf('aria-label="Play Chapter 1"') < table.indexOf('aria-label="Edit Chapter 1"'));
  assert.ok(!table.includes('lucide-trash-2'));
  assert.ok(table.indexOf('Drag to reorder') < table.indexOf('aria-label="Edit Chapter 1"'));
  assert.ok(table.indexOf('aria-label="Edit Chapter 1"') < table.indexOf('aria-label="Start of Chapter 1"'));
  assert.ok(table.indexOf('aria-label="Start of Chapter 1"') < table.indexOf('aria-label="End of Chapter 1"'));
  assert.ok(table.indexOf('aria-label="End of Chapter 1"') < table.indexOf('aria-label="Title of chapter 1"'));
  assert.ok(html.includes('Auto Clean Titles'));
  assert.ok(html.includes('Chapter edit activity'));
  assert.match(html, /Chapter Editor/);
  assert.doesNotMatch(html, /Chapters to export \(/);
  assert.ok(html.includes('Reset to default chapters'));
  assert.ok(!html.includes('Unsaved chapter changes'));
  assert.ok(html.indexOf('Playback position') < html.indexOf('aria-label="Audio player controls"'));
  assert.ok(html.includes('Bulk Edit'));
  assert.ok(html.includes('Chapter number format'));
  assert.ok(html.includes('Add Chapter'));
  assert.ok(html.includes('Select Chapter 1 for bulk editing'));
  assert.ok(html.indexOf('Add Chapter') < html.indexOf('Chapter number format'));
  assert.ok(html.includes('<audio'));
  assert.ok(html.includes('/api/jobs/chapter-layout/audio-preview'));
  assert.ok(!html.includes('Load Local MP3 for Real Audio'));
  assert.ok(!html.includes('Preview audio: use'));
  assert.ok(!html.includes('Paste CSV'));
  assert.ok(!html.includes('Download CSV'));
});

test('bulk editor shows scoped preview controls and keeps a disabled apply until input is entered', () => {
  const html = renderToStaticMarkup(<BulkChapterEditor chapters={chapters} selectedIds={new Set()} onApply={() => {}} onClose={() => {}} />);
  for (const label of ['Bulk Chapter Editor', 'Find', 'Replace with', 'Match case', 'Whole word', 'Regular expression', 'All chapters', 'Selected chapters (0)', 'Preview', 'Apply 0 Changes']) assert.ok(html.includes(label), label);
  assert.match(html, /disabled=""[^>]*>Apply 0 Changes/);
});

test('opening raw detected chapters is clean and pending edits disappear after saving', () => {
  const raw = [{id:'a',title:'chapter one',start:'00:00:00.000'},{id:'b',title:'chapter two',start:'00:00:30.000'}];
  const sourceJob = {...job,chapters:raw};
  const render = (chapters: ChapterEntry[], draftChapters?: ChapterEntry[]) => renderToStaticMarkup(<Step2ChapterReview job={{...sourceJob,chapters}} draftChapters={draftChapters} onSaveChapters={async()=>{}} onDraftChange={()=>{}} onNextStep={()=>{}}/>);
  const clean = render(raw);
  assert.ok(clean.includes('No unsaved chapter edits.'));
  assert.ok(clean.includes('All changes saved'));
  const edited = raw.map(chapter => ({...chapter}));
  edited[1] = {...edited[1], title:'New title',start:'00:00:35.125', titleManuallyEdited:true, startManuallyEdited:true} as ChapterEntry;
  const pending = render(raw,edited);
  assert.ok(pending.includes('Unsaved changes'));
  assert.ok(pending.includes('set start to 00:00:35.125'));
  assert.ok(pending.includes('Renamed chapter to New title'));
  const saved = render(edited,edited);
  assert.ok(saved.includes('No unsaved chapter edits.'));
  assert.ok(saved.includes('All changes saved'));
});
