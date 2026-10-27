import test from 'node:test';
import assert from 'node:assert/strict';
import { manualChapterGroups, setChapterGroup } from '../src/utils/sourceStructure';
import { canRerunStep } from '../src/utils/pipelineRerun';
import type { AudioPart, AudiobookJob } from '../src/types';

const parts = (): AudioPart[] => ['03.mp3', '01.mp3', '02.mp3', '04.mp3'].map((name, index) => ({ id: String(index), name, order: index + 1, sizeBytes: 1, bitrate: 128, durationSeconds: index + 1 }));

test('manual groups preserve processing order and keep ungrouped files as chapters', () => {
  const files = parts();
  setChapterGroup(files, ['01.mp3', '02.mp3'], ' Middle chapter ', 'g1');
  assert.deepEqual(manualChapterGroups(files), { mode: 'manual_groups', groups: [
    { title: '03', indices: [0] }, { title: 'Middle chapter', indices: [1, 2] }, { title: '04', indices: [3] },
  ] });
  assert.deepEqual(files.map(part => part.name), ['03.mp3', '01.mp3', '02.mp3', '04.mp3']);
  const persisted = JSON.parse(JSON.stringify(files));
  assert.deepEqual(manualChapterGroups(persisted), manualChapterGroups(files));
  setChapterGroup(files, ['02.mp3'], undefined, 'unused');
  assert.ok(files.every(part => !part.chapterGroup));
});

test('groups reject gaps, stale membership, partial regrouping and split playback order', () => {
  const files = parts();
  assert.throws(() => setChapterGroup(files, ['03.mp3', '02.mp3'], 'Gap', 'g'), /consecutive/);
  assert.throws(() => setChapterGroup(files, ['missing.mp3'], 'Stale', 'g'), /changed/);
  assert.throws(() => setChapterGroup(files, ['03.mp3', '01.mp3'], ' ', 'g'), /name/);
  setChapterGroup(files, ['03.mp3', '01.mp3'], 'Opening', 'g');
  assert.throws(() => setChapterGroup(files, ['01.mp3', '02.mp3'], 'Partial', 'g2'), /whole existing group/);
  assert.throws(() => manualChapterGroups([files[0], files[2], files[1], files[3]]), /together/);
  assert.equal(files[0].chapterGroup?.title, 'Opening', 'invalid regrouping preserves original group');
});

test('grouped workflow offers independent transcription without chapter detection', () => {
  const job = { chapterSource: 'grouped_files', parts: parts(), mergedMp3: {}, previewPath: 'preview', transcriptSegments: [{}] } as AudiobookJob;
  assert.equal(canRerunStep(job, 'extracting_chapters'), true);
  assert.equal(canRerunStep(job, 'transcribing_whisper'), true);
  assert.equal(canRerunStep(job, 'detecting_chapters'), false);
});
