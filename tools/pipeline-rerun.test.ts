import test from 'node:test';
import assert from 'node:assert/strict';
import type { AudiobookJob } from '../src/types';
import { beginStepRerun, canRerunStep, completeStepRerun, failStepRerun, hasManualChapterWork, markDependentResultsStale } from '../src/utils/pipelineRerun';

const job = (overrides: Partial<AudiobookJob> = {}): AudiobookJob => ({
  id: 'job', name: 'Book', createdAt: '', parts: [], totalDurationSeconds: 100, totalSizeBytes: 1,
  status: 'transcribed', candidates: [], chapters: [], logs: [], chapterSource: 'whisperx', ...overrides,
});

test('rerunning Chapter Detection does not rerun Transcription', () => {
  const states = completeStepRerun({
    transcribing_whisper: { status: 'current', hasOutput: true, updatedAt: 'old-transcript' },
    detecting_chapters: { status: 'running', hasOutput: true },
  }, 'detecting_chapters', 'new-detection');
  assert.deepEqual(states?.transcribing_whisper, { status: 'current', hasOutput: true, updatedAt: 'old-transcript' });
  assert.equal(states?.detecting_chapters?.updatedAt, 'new-detection');
});

test('rerunning Transcription marks Chapter Detection stale without invalidating waveform', () => {
  const states = completeStepRerun({
    generating_waveform: { status: 'current', hasOutput: true },
    detecting_chapters: { status: 'current', hasOutput: true },
  }, 'transcribing_whisper', 'new-transcript');
  assert.equal(states?.detecting_chapters?.status, 'stale');
  assert.equal(states?.generating_waveform?.status, 'current');
  assert.deepEqual(markDependentResultsStale([], 'transcribing_whisper'), ['chapter_detection', 'chapter_review', 'export', 'validation']);
});

test('failed rerun preserves the prior successful output state and records normal error status', () => {
  const previous = { status: 'current' as const, hasOutput: true, updatedAt: 'successful-output' };
  assert.deepEqual(beginStepRerun(previous), { status: 'running', hasOutput: true, updatedAt: 'successful-output' });
  assert.deepEqual(failStepRerun(previous, 'failure'), { status: 'failed', hasOutput: true, updatedAt: 'successful-output', error: 'failure' });
});

test('successful rerun marks replacement output current', () => {
  const states = completeStepRerun({ detecting_chapters: { status: 'running', hasOutput: true, updatedAt: 'old' } }, 'detecting_chapters', 'replacement');
  assert.deepEqual(states?.detecting_chapters, { status: 'current', hasOutput: true, updatedAt: 'replacement' });
});

test('rerun availability reflects required inputs', () => {
  assert.equal(canRerunStep(job(), 'transcribing_whisper'), false);
  assert.equal(canRerunStep(job({ previewPath: 'preview.wav' }), 'transcribing_whisper'), true);
  assert.equal(canRerunStep(job({ transcriptSegments: [] }), 'detecting_chapters'), false);
  assert.equal(canRerunStep(job({ transcriptSegments: [{ id: 1, start: 0, end: 1, text: 'Chapter One', words: [] }] }), 'detecting_chapters'), true);
});

test('manual chapter edits require protection before replacement', () => {
  const edited = job({ chapters: [{ id: 'one', start: '00:00:00.000', end: '00:00:10.000', title: 'Renamed', titleManuallyEdited: true }] });
  assert.equal(hasManualChapterWork(edited), true);
});
