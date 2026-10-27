import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DependencyStatusProvider } from '../src/dependency-status';
import { Step1MergeDetect } from '../src/components/Step1MergeDetect';
import { Step2ChapterReview } from '../src/components/Step2ChapterReview';
import { Step4Export } from '../src/components/Step4Export';
import { Step5Validate } from '../src/components/Step5Validate';
import type { AudiobookJob, WorkbenchConfig } from '../src/types';

const job = {
  id: 'responsive-fixture', name: 'Example', status: 'merged',
  chapters: [{ id: 'one', title: 'First chapter', start: '00:00:00.000', end: '00:00:59.999', endManuallyEdited: true }],
  totalDurationSeconds: 60, parts: [], candidates: [], transcriptWords: [], logs: [],
} as unknown as AudiobookJob;
const config = { faster_transcription: true, lead_in_seconds: 1.5, m4b_settings: {} } as WorkbenchConfig;
const withDependencies = (node: React.ReactNode) => renderToStaticMarkup(<DependencyStatusProvider>{node}</DependencyStatusProvider>);

test('compact processing choices retain independent accessible radio names and unavailable reason', () => {
  const html = withDependencies(<Step1MergeDetect job={job} config={config} isRunning={false}
    onRunStep1={async () => {}} onRerunStep={async () => {}} />);
  for (const name of ['Find spoken chapters', 'Use files and folders', 'Use chapter groups', 'Prepare for accuracy', 'Join without converting']) {
    assert.match(html, new RegExp(`<input[^>]*aria-label="${name}"`));
  }
  assert.match(html, /title="Unavailable: /);
  assert.match(html, /aria-label="Re-run"/);
});

test('compact chapter rows retain editable fields and named header commands', () => {
  const html = renderToStaticMarkup(<Step2ChapterReview job={job} onSaveChapters={async () => {}}
    onDraftChange={() => {}} onNextStep={() => {}} />);
  for (const label of ['Start of First chapter', 'End of First chapter', 'Title of chapter 1',
    'Nudge selected chapter one second earlier', 'Nudge selected chapter one second later', 'Remove selected chapter', 'Play First chapter']) {
    assert.ok(html.includes(`aria-label="${label}"`), label);
  }
  for (const label of ['Start', 'End', 'Chapter title']) assert.ok(html.includes(`data-label="${label}"`), label);
  assert.match(html, /value="00:00:00.000"/);
  assert.match(html, /value="00:00:59.999"/);
  assert.match(html, /role="table" aria-label="Chapters to export"/);
});

test('export and validation keep full action names when rendered as compact commands', () => {
  const exported = { ...job, outputM4b: { filename: 'example.m4b', fullPath: '/books/example.m4b' } } as AudiobookJob;
  const exportHtml = withDependencies(<Step4Export job={exported} config={config} onBuildM4b={async () => {}}
    isBuilding={false} error={null} onNextStep={() => {}} />);
  assert.match(exportHtml, /aria-label="Convert"/);
  assert.match(exportHtml, /aria-label="Continue to final check"/);
  const validationHtml = withDependencies(<Step5Validate job={exported} onValidate={async () => {}} isValidating={false} />);
  assert.match(validationHtml, /aria-label="Check audiobook"/);
  assert.match(validationHtml, /title="Checking requirements…"/);
});

test('conversion can be skipped without an export or conversion dependencies', () => {
  const html = withDependencies(<Step4Export job={job} config={config} onBuildM4b={async()=>{}} isBuilding={false} error={null} onNextStep={()=>{}}/>);
  assert.match(html, />Convert<\/h2>/);
  const next = html.match(/<button[^>]*aria-label="Continue to final check"[^>]*>/)?.[0];
  assert.ok(next); assert.doesNotMatch(next,/\sdisabled(?:=|\s|>)/);
  assert.match(html, /lucide-play/);
  const final = withDependencies(<Step5Validate job={job} onValidate={async()=>{}} onCheckSourceAudio={async()=> 'Checked source'} isValidating={false}/>);
  assert.match(final,/Conversion was skipped/);
  assert.match(final,/aria-label="Check source audio"/);
  assert.doesNotMatch(final,/aria-label="Check audiobook"/);
});
