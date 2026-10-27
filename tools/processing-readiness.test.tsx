import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesktopWorkspace, DesktopWindow } from '../src/components/DesktopWorkspace';
import { hasProcessingDetails, Step1ProgressPanel } from '../src/components/Step1ProgressPanel';
import type { Step1ProcessState } from '../src/types';

const idle: Step1ProcessState = { isActive: false, stage: 'idle', label: 'Ready', currentTask: 'Ready to start.',
  currentStageNumber: 0, totalStages: 1, stages: [{ key: 'generating_waveform', label: 'Generate waveform', desc: 'Create the preview.' }],
  percentage: 0, isDeterminate: false, elapsedSeconds: 0, liveStatusMessage: 'Idle', logs: [], canCancel: false };
function render(progress: Step1ProcessState) {
  return renderToStaticMarkup(<DesktopWorkspace page="readiness-test"><DesktopWindow id="readiness-test" title="Audio processing"
    headerOnly={!hasProcessingDetails(progress)} expandWhen={progress.isActive}>
    <Step1ProgressPanel ready progress={progress} onCancel={() => {}} processingAction={<button>Run processing</button>} />
  </DesktopWindow></DesktopWorkspace>);
}

test('before the first run only the header action is shown, without an empty body or collapse control', () => {
  const html = render(idle);
  assert.ok(html.includes('Ready for Processing'));
  assert.match(html, /<header[^>]*>[\s\S]*?<button>Run processing<\/button>[\s\S]*?<\/header>/);
  assert.ok(!html.includes('Generate waveform'));
  assert.ok(!html.includes('Collapse Audio processing'));
  assert.ok(!html.includes('Expand Audio processing'));
});

test('processing exposes stage details in an expanded window', () => {
  const html = render({ ...idle, isActive: true, stage: 'generating_waveform', currentStageNumber: 1 });
  assert.ok(html.includes('Generate waveform'));
  assert.ok(html.includes('data-window-collapsed="false"'));
  assert.ok(!html.includes('hidden=""'));
});

test('completed, interrupted and persisted processing retain details; metadata alone does not unlock them', () => {
  for (const stage of ['completed', 'error', 'cancelled'] as const) assert.equal(hasProcessingDetails({ ...idle, stage }), true);
  assert.equal(hasProcessingDetails(idle, { generating_waveform: { status: 'failed', hasOutput: false } }), true);
  assert.equal(hasProcessingDetails(idle, { metadata_processing: { status: 'current', hasOutput: true } }), false);
});
