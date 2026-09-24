import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { processingKey } from './transcription-cache';
import { CHAPTER_DETECTOR_VERSION } from './chapter-detection';
import { MUSIC_DETECTOR_VERSION } from './music-transitions';
import { TITLE_DETECTOR_VERSION } from './title-boundaries';
import { buildTranscriptWords } from '../src/utils/wordAlignment';
import type { AudiobookJob } from '../src/types';

// Exercise the actual server cache policy without starting HTTP, transcription,
// or audio preparation. Only preview-file metadata is controlled by the fixture.
function cachePolicy() {
  const source = fs.readFileSync('server.ts', 'utf8');
  const start = source.indexOf('function chapterDetectionCacheKey(');
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start, 'server chapter cache policy must be present');
  const preview = { exists: true, size: 320044, mtimeMs: 1000, ctimeMs: 2000, reads: 0 };
  const context = vm.createContext({
    CHAPTER_DETECTOR_VERSION, MUSIC_DETECTOR_VERSION, TITLE_DETECTOR_VERSION, processingKey,
    currentConfig: { lead_in_seconds: 1.5 },
    fs: {
      existsSync() { return preview.exists; },
      statSync() { preview.reads++; return { size: preview.size, mtimeMs: preview.mtimeMs, ctimeMs: preview.ctimeMs }; },
    },
  });
  vm.runInContext(transformSync(source.slice(start, end), { loader: 'ts' }).code, context);
  const key = vm.runInContext('chapterDetectionCacheKey', context) as (job: Partial<AudiobookJob>, enabled: boolean) => string;
  return { key, preview, context };
}

function savedTranscript(): Partial<AudiobookJob> {
  const segments = [{ id: 0, start: 10, end: 11, text: 'Chapter Twelve', words: [
    { word: 'Chapter', start: 10, end: 10.4, probability: 0.95 },
    { word: 'Twelve', start: 10.5, end: 11, probability: 0.94 },
  ] }];
  return {
    transcriptKey: 'same-request-and-runtime-result', previewPath: 'fixture-preview.wav',
    transcriptSegments: segments, transcriptWords: buildTranscriptWords(segments),
  };
}

test('unchanged chapter detection reruns have stable keys regardless of object key order', () => {
  const { key } = cachePolicy();
  const job = savedTranscript();
  for (const enabled of [false, true]) {
    const before = key(job, enabled);
    assert.match(before, /^[a-f0-9]{64}$/);
    assert.equal(key(structuredClone(job), enabled), before);
    assert.equal(key(Object.fromEntries(Object.entries(job).reverse()), enabled), before);
    assert.equal(key({ ...job, chapters: [], candidates: [], chapterDetectionKey: 'old-reviewed-result' }, enabled), before);
  }
});

test('the same transcription request cannot reuse decisions after transcript content or timings change', () => {
  const { key } = cachePolicy();
  const job = savedTranscript();
  const original = key(job, true);
  for (const change of [
    (value: Partial<AudiobookJob>) => { value.transcriptSegments![0].text = 'Chapter Twenty'; },
    (value: Partial<AudiobookJob>) => { value.transcriptSegments![0].words[0].start = 10.125; },
    (value: Partial<AudiobookJob>) => { value.transcriptWords![0].startSeconds = 10.125; },
    (value: Partial<AudiobookJob>) => { value.transcriptWords![0].confidence = 0.1; },
  ]) {
    const changed = structuredClone(job);
    change(changed);
    assert.equal(changed.transcriptKey, job.transcriptKey, 'transcription settings/result key has not changed');
    assert.notEqual(key(changed, true), original);
    assert.notEqual(key(changed, false), key(job, false));
  }
});

test('spoken detector version invalidates decisions with music both enabled and disabled', () => {
  const { key, context } = cachePolicy();
  const job = savedTranscript();
  const disabled = key(job, false), enabled = key(job, true);
  context.CHAPTER_DETECTOR_VERSION++;
  assert.notEqual(key(job, false), disabled);
  assert.notEqual(key(job, true), enabled);
});

test('music and named-title detector versions invalidate acoustic decisions only', () => {
  for (const detector of ['MUSIC_DETECTOR_VERSION', 'TITLE_DETECTOR_VERSION']) {
    const { key, context } = cachePolicy();
    const job = savedTranscript();
    const disabled = key(job, false), enabled = key(job, true);
    context[detector]++;
    assert.notEqual(key(job, true), enabled, detector);
    assert.equal(key(job, false), disabled, detector);
  }
});

test('music toggle invalidates decisions even when the preview is unavailable', () => {
  const { key, preview } = cachePolicy();
  const job = savedTranscript();
  for (const exists of [true, false]) {
    preview.exists = exists;
    assert.notEqual(key(job, true), key(job, false));
  }
});

test('preview replacement invalidates acoustic decisions but not transcript-only decisions', () => {
  for (const field of ['size', 'mtimeMs', 'ctimeMs'] as const) {
    const { key, preview } = cachePolicy();
    const job = savedTranscript();
    const disabled = key(job, false), enabled = key(job, true);
    preview[field]++;
    assert.notEqual(key(job, true), enabled, field);
    assert.equal(key(job, false), disabled, field);
  }
  const { key, preview } = cachePolicy();
  const job = savedTranscript();
  const present = key(job, true);
  preview.exists = false;
  assert.notEqual(key(job, true), present, 'missing preview must not reuse decisions made from audio');
});

test('legacy lead-in changes do not alter exact-word detection or trigger audio reads when disabled', () => {
  const { key, context, preview } = cachePolicy();
  const job = savedTranscript();
  const original = key(job, false);
  context.currentConfig.lead_in_seconds = 30;
  assert.equal(key(job, false), original);
  assert.equal(preview.reads, 0);
});
