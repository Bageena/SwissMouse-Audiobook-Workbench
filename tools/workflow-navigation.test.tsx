import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectAudioTools } from '../src/components/ProjectAudioTools';
import { WorkflowLayout, workflowStepState } from '../src/components/WorkflowNavigation';
import type { AudiobookJob } from '../src/types';

const job = { status: 'draft', chapters: [], parts: [] } as unknown as AudiobookJob;

test('project navigation starts with Book Files and marks the selected screen', () => {
  const html = renderToStaticMarkup(<WorkflowLayout job={job} files={false} activeStep={2} onNavigate={() => {}}><p>Screen content</p></WorkflowLayout>);
  assert.ok(html.indexOf('aria-label="Book Files"') < html.indexOf('aria-label="Process audio"'));
  assert.match(html, /aria-label="Review chapters" aria-current="page"/);
  assert.ok(html.includes('Screen content'));
  assert.equal((html.match(/class="workflow-nav-item/g) || []).length, 6);
});

test('import and library screens do not receive project navigation', () => {
  for (const value of [null, { ...job, importPending: true }]) {
    const html = renderToStaticMarkup(<WorkflowLayout job={value} files activeStep={1} onNavigate={() => {}}>Content</WorkflowLayout>);
    assert.ok(html.includes('Content'));
    assert.ok(!html.includes('Project navigation'));
  }
});

test('navigation preserves completed and stale workflow state', () => {
  assert.deepEqual(workflowStepState(job, 1), { completed: false, stale: false });
  assert.deepEqual(workflowStepState({ ...job, status: 'built', staleSteps: ['export'] }, 4), { completed: true, stale: true });
  assert.deepEqual(workflowStepState({ ...job, status: 'validated' }, 5), { completed: true, stale: false });
});

test('project audio toolbar remains disabled during processing and is separate from navigation', () => {
  const html = renderToStaticMarkup(<ProjectAudioTools job={{ ...job, parts: [{ id: 'part' }] } as AudiobookJob} busy onRecheckAudio={async () => 'Verified'} onShowLogs={() => {}} />);
  assert.match(html, /role="toolbar" aria-label="Project audio tools"/);
  assert.match(html, /aria-label="Recheck project audio"[^>]*disabled/);
  const navigation = renderToStaticMarkup(<WorkflowLayout job={job} files={false} activeStep={1} onNavigate={() => {}}>Content</WorkflowLayout>);
  assert.ok(!navigation.includes('Recheck project audio'));
});
