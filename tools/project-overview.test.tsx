import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectOverview, projectOverviewStatus } from '../src/components/ProjectOverview';
import type { AudiobookJob } from '../src/types';

const job = { id: 'overview', name: 'Fallback', status: 'draft', metadata: { title: 'Book title', author: 'Author name', narrator: 'Narrator name' }, parts: [{ id: 'file' }], source: { path: 'private-source-path' } } as unknown as AudiobookJob;

test('overview uses compact book identity and count instead of a source path', () => {
  const html = renderToStaticMarkup(<ProjectOverview job={job} />);
  for (const text of ['Book title', 'Author name', 'Narrator name', '1 file', 'Draft', 'aria-expanded="true"', 'aria-controls=']) assert.ok(html.includes(text));
  assert.ok(!html.includes('private-source-path'));
});

test('overview status summarizes actual pipeline progress and stale results', () => {
  assert.equal(projectOverviewStatus(job).label, 'Draft');
  assert.equal(projectOverviewStatus({ ...job, status: 'merged' }).label, 'Processing started');
  assert.equal(projectOverviewStatus({ ...job, processingStatus: 'complete' }).label, 'Processed');
  assert.equal(projectOverviewStatus({ ...job, processingStatus: 'complete', sourceFilesChanged: true }).label, 'Needs reprocessing');
  assert.equal(projectOverviewStatus({ ...job, pipelineSteps: { transcribing_whisper: { status: 'running', hasOutput: false } } }).label, 'Processing');
  assert.equal(projectOverviewStatus({ ...job, sourceMembershipReview: 'Choose the correct files.' }).label, 'Review source files');
});

test('overview shares project duration and size on workflow screens', () => {
  const html = renderToStaticMarkup(<ProjectOverview job={{ ...job, totalDurationSeconds: 3661, totalSizeBytes: 10485760 }} />);
  assert.match(html, /Total project time: 1h 1m 1s/);
  assert.match(html, /Size: 10.0 MB/);
  assert.match(html, /project-overview workspace-panel/);
});
