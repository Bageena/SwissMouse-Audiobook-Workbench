import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { ChapterAudioPlayer } from '../src/components/ChapterAudioPlayer';
import { DesktopWorkspace } from '../src/components/DesktopWorkspace';
import { applyDefaultChapterEnds, formatTimestampMs, isIncompleteChapter, prepareChapters, validateChapterEntries } from '../src/utils/chapters';
import { formatTimestamp, parseTimestampToMs } from '../src/utils/wordAlignment';
import type { ChapterEntry } from '../src/types';

function section(source: string, from: string, until: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(until, start + from.length);
  assert.ok(start >= 0 && end > start, `Cannot find ${from}`);
  return source.slice(start, end);
}

test('player and editor share millisecond formatting across the hour boundary', () => {
  for (const [seconds, expected] of [
    [0, '00:00:00.000'], [59.237, '00:00:59.237'],
    [3599.9996, '01:00:00.000'], [3723.456, '01:02:03.456'],
  ] as const) {
    assert.equal(formatTimestampMs(seconds * 1000), expected);
    assert.equal(formatTimestamp(seconds), expected);
  }
});

test('player seek updates its display position immediately and capture reads the audio element', () => {
  const source = fs.readFileSync('src/components/ChapterAudioPlayer.tsx', 'utf8');
  const code = section(source, '  const seekTo =', '  const handleSeekOffset =');
  const audio = { currentTime: 0 };
  let displayed = 0, notified = 0, captured = 0, added = 0;
  const context = { duration: 7200, audioRef: { current: audio }, audioUrl: '/preview',
    setWaveformSeekRevision() {}, currentTime: 12, setCurrentTime: (seconds: number) => { displayed = seconds; },
    onSeek: (seconds: number) => { notified = seconds; },
    onSetTimestamp: (seconds: number) => { captured = seconds; },
    onAddChapter: (seconds: number) => { added = seconds; },
  };
  vm.runInNewContext(transformSync(`${code}\nseekTo(3661.237); captureTimestamp(); addChapterHere();`, { loader: 'ts' }).code, context);
  assert.equal(displayed, 3661.237);
  assert.equal(audio.currentTime, 3661.237);
  assert.equal(notified, 3661.237);
  assert.equal(captured, 3661.237, 'capture must use the current media position, not a stale React render');
  assert.equal(added, 3661.237, 'adding a chapter uses the same current media position');
  assert.equal(formatTimestampMs(displayed * 1000), '01:01:01.237');
});

test('Set Chapter Start resolves the selected placeholder and retains it as the editing target', () => {
  const chapter = (number: number, start: string): ChapterEntry => ({
    id: `chapter-${number}`, title: `Chapter ${number}`, start,
    headingType: 'numbered_chapter', chapterNumber: number,
  });
  const chapters = prepareChapters([chapter(8, '01:00:00.000'), chapter(10, '02:00:00.000')], 10800);
  const missing = chapters[1];
  const source = fs.readFileSync('src/components/Step2ChapterReview.tsx', 'utf8');
  const update = section(source, '  const handleUpdateChapter =', '  const handleCleanTitles =');
  const capture = section(source, '  const handleSetChapterTimestamp =', '\n  const nextAction =');
  let result: ChapterEntry[] = [];
  const context = {
    chapters, editingChapterId: missing.id, activeTrack: null,
    parseMs: parseTimestampToMs, formatTimestampMs, applyDefaultChapterEnds,
    job: { totalDurationSeconds: 10800 },
    resolveTranscriptWordIndex: () => 42,
    setChapters: (next: ChapterEntry[]) => { result = next; },
    syncPlayerToChapter() {}, setSaveSuccess() {},
    validateChaptersList: (next: ChapterEntry[]) => validateChapterEntries(next, 10800),
    setValidationError() {},
  };
  vm.runInNewContext(transformSync(`${update}\n${capture}\nhandleSetChapterTimestamp(5400.237);`, { loader: 'ts' }).code, context);
  assert.equal(result[1].start, '01:30:00.237');
  assert.equal(result[1].isMissing, false);
  assert.equal(isIncompleteChapter(result[1]), false);
  assert.equal(result[1].startManuallyEdited, true);
  assert.equal(result[1].transcriptWordIndex, 42);
  assert.equal(result[0].start, chapters[0].start);
  assert.equal(result[2].start, chapters[2].start);
  assert.equal(result[0].end, '01:30:00.236');
  assert.equal(validateChapterEntries(result, 10800), null);
  assert.equal(context.editingChapterId, missing.id);
});

test('capture is available for any selected chapter and new chapters can use the current position', () => {
  const props = {
    transcriptWords: [], activeTrack: { id: 'chapter-8', title: 'Chapter 8', start: '01:00:00.000', seconds: 3600, sourceType: 'chapter' as const },
    isPlaying: false, onPlay() {}, onPause() {}, onStop() {}, totalDurationSeconds: 7200.5,
    audioSrc: '/preview', onAddChapter() {},
  };
  const normal = renderToStaticMarkup(React.createElement(ChapterAudioPlayer, props));
  const workspace = renderToStaticMarkup(React.createElement(DesktopWorkspace, { page: 'step-2', children: React.createElement(ChapterAudioPlayer, props) }));
  assert.match(workspace, /data-desktop-window="interactive-transcription"/);
  assert.match(workspace, /data-panel-role="child"/);
  assert.match(workspace, /data-panel-variant="compact"/);
  assert.match(normal, /class="interactive-transcription" data-expanded="false"/);
  assert.match(normal, /aria-expanded="false"[^>]*aria-controls="interactive-transcription-words"[^>]*aria-label="Show ten lines of transcription"/);
  const locating = renderToStaticMarkup(React.createElement(ChapterAudioPlayer, {
    ...props, timestampTarget: 'Chapter 8', onSetTimestamp() {},
  }));
  assert.doesNotMatch(normal, /Set Chapter Start/);
  assert.match(normal, /Add Chapter Here/);
  assert.match(locating, /Set Chapter Start/);
  assert.doesNotMatch(locating, /Editing: Chapter 8/);
  assert.match(locating, /aria-label="Set Chapter Start"[^>]*>[\s\S]*?lucide-map-pin/);
  assert.match(normal, /aria-label="Add Chapter Here"[^>]*>[\s\S]*?lucide-plus/);
  assert.match(locating, /class="mini-player-seek /);
  assert.match(locating, /role="slider" aria-label="Playback position"/);
  assert.match(locating, /02:00:00\.500/);
});

test('both transcript click paths use the selected chapter ID, never the nearest or playing chapter', () => {
  const source = fs.readFileSync('src/components/Step2ChapterReview.tsx', 'utf8');
  const handler = section(source, '  const handleWordTimestampSelect =', '  // Save changes');
  const chapters = [
    { id: 'existing', title: 'Chapter 8', start: '01:00:00.000' },
    { id: 'selected', title: 'Chapter 8', start: '02:00:00.000' },
  ];
  const updates: number[] = [];
  const context = {
    chapters, editingChapterId: 'selected', activeTrack: { id: 'existing', chapterIndex: 0 },
    resolveTranscriptWordIndex: () => 42, navigateToTranscriptWord() {},
    handleUpdateChapter: (index: number) => { updates.push(index); },
    selectedTimelineTime: { current: null }, setIsPlaying() {},
    setWordUpdateNotification() {}, setTimeout() {},
  };
  const exercise = `${handler}\nhandleWordTimestampSelect('01:30:00.237', 'Chapter', 5400.237);\nhandleTranscriptWordSelect({ start: '01:30:00.237', word: 'Chapter', startSeconds: 5400.237 }, 42);`;
  vm.runInNewContext(transformSync(exercise, { loader: 'ts' }).code, context);
  assert.deepEqual(updates, [1, 1]);
  updates.length = 0;
  vm.runInNewContext(transformSync(exercise, { loader: 'ts' }).code, { ...context, chapters: [...chapters].reverse() });
  assert.deepEqual(updates, [0, 0], 'reordering cannot redirect a selected ID');
  assert.equal(chapters[0].start, '01:00:00.000');
});

test('no editor selection, including a deleted selection, only previews the clicked word', () => {
  const source = fs.readFileSync('src/components/Step2ChapterReview.tsx', 'utf8');
  const handler = section(source, '  const handleWordTimestampSelect =', '  // Save changes');
  for (const editingChapterId of [null, 'deleted']) {
    let preview: any;
    vm.runInNewContext(transformSync(`${handler}\nhandleTranscriptWordSelect({ start: '00:00:25.125', word: 'hello', startSeconds: 25.125 }, 20);`, { loader: 'ts' }).code, {
      chapters: [{ id: 'existing', title: 'Opening', start: '00:00:00.000' }], editingChapterId,
      resolveTranscriptWordIndex: () => 20, navigateToTranscriptWord() {},
      handleUpdateChapter() { assert.fail('A word click must not infer a chapter to edit'); },
      selectedTimelineTime: { current: null }, seekRevision: { current: 0 },
      setActiveTrack: (track: any) => { preview = track; }, setIsPlaying() {}, setWordUpdateNotification() {}, setTimeout() {},
    });
    assert.equal(preview.seconds, 25.125);
    assert.equal(preview.sourceType, 'transcript');
  }
});
