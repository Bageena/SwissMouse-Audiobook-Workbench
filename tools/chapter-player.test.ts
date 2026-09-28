import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { ChapterAudioPlayer } from '../src/components/ChapterAudioPlayer';
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
  let displayed = 0, notified = 0, captured = 0;
  const context = { duration: 7200, audioRef: { current: audio }, audioUrl: '/preview',
    currentTime: 12, setCurrentTime: (seconds: number) => { displayed = seconds; },
    onSeek: (seconds: number) => { notified = seconds; },
    onSetTimestamp: (seconds: number) => { captured = seconds; },
  };
  vm.runInNewContext(transformSync(`${code}\nseekTo(3661.237); captureTimestamp();`, { loader: 'ts' }).code, context);
  assert.equal(displayed, 3661.237);
  assert.equal(audio.currentTime, 3661.237);
  assert.equal(notified, 3661.237);
  assert.equal(captured, 3661.237, 'capture must use the current media position, not a stale React render');
  assert.equal(formatTimestampMs(displayed * 1000), '01:01:01.237');
});

test('Set Timestamp resolves only the selected missing chapter using the editor update path', () => {
  const chapter = (number: number, start: string): ChapterEntry => ({
    id: `chapter-${number}`, title: `Chapter ${number}`, start,
    headingType: 'numbered_chapter', chapterNumber: number,
  });
  const chapters = prepareChapters([chapter(8, '01:00:00.000'), chapter(10, '02:00:00.000')], 10800);
  const missing = chapters[1];
  const source = fs.readFileSync('src/components/Step2ChapterReview.tsx', 'utf8');
  const update = section(source, '  const handleUpdateChapter =', '  const handleCleanTitles =');
  const capture = section(source, '  const handleSetMissingTimestamp =', '\n  return (');
  let result: ChapterEntry[] = [], selectedId: string | null = missing.id;
  const context = {
    chapters, selectedMissingChapter: missing, selectedMissingChapterId: missing.id, activeTrack: null,
    parseMs: parseTimestampToMs, formatTimestampMs, applyDefaultChapterEnds,
    job: { totalDurationSeconds: 10800 },
    resolveTranscriptWordIndex: () => 42,
    setChapters: (next: ChapterEntry[]) => { result = next; },
    syncPlayerToChapter() {}, setSaveSuccess() {},
    validateChaptersList: (next: ChapterEntry[]) => validateChapterEntries(next, 10800),
    setValidationError() {},
    setSelectedMissingChapterId: (id: string | null) => { selectedId = id; },
  };
  vm.runInNewContext(transformSync(`${update}\n${capture}\nhandleSetMissingTimestamp(5400.237);`, { loader: 'ts' }).code, context);
  assert.equal(result[1].start, '01:30:00.237');
  assert.equal(result[1].isMissing, false);
  assert.equal(isIncompleteChapter(result[1]), false);
  assert.equal(result[1].startManuallyEdited, true);
  assert.equal(result[1].transcriptWordIndex, 42);
  assert.equal(result[0].start, chapters[0].start);
  assert.equal(result[2].start, chapters[2].start);
  assert.equal(result[0].end, '01:30:00.236');
  assert.equal(validateChapterEntries(result, 10800), null);
  assert.equal(selectedId, null);
});

test('capture control appears only while locating a missing chapter', () => {
  const props = {
    transcriptWords: [], activeTrack: { id: 'chapter-8', title: 'Chapter 8', start: '01:00:00.000', seconds: 3600, sourceType: 'chapter' as const },
    isPlaying: false, onPlay() {}, onPause() {}, onStop() {}, totalDurationSeconds: 7200.5,
    audioSrc: '/preview',
  };
  const normal = renderToStaticMarkup(React.createElement(ChapterAudioPlayer, props));
  const locating = renderToStaticMarkup(React.createElement(ChapterAudioPlayer, {
    ...props, timestampTarget: 'Chapter 9', onSetTimestamp() {}, onCancelTimestamp() {},
  }));
  assert.doesNotMatch(normal, /Set Timestamp/);
  assert.match(locating, /Set Timestamp/);
  assert.match(locating, /Set Chapter 9 to the current position/);
  assert.match(locating, /02:00:00\.500/);
});

test('transcript word selection targets the chosen placeholder, preserving the playing chapter', () => {
  const source = fs.readFileSync('src/components/Step2ChapterReview.tsx', 'utf8');
  const handler = section(source, '  const handleWordTimestampSelect =', '  const handleTranscriptWordSelect =');
  const chapters = [
    { id: 'existing', title: 'Chapter 8', start: '01:00:00.000' },
    { id: 'missing', title: 'Chapter 9', start: '', isMissing: true },
  ];
  const updates: number[] = [];
  vm.runInNewContext(transformSync(`${handler}\nhandleWordTimestampSelect('01:30:00.237', 'Chapter', 5400.237);`, { loader: 'ts' }).code, {
    chapters, selectedMissingChapterId: 'missing', activeTrack: { id: 'existing', chapterIndex: 0 },
    resolveTranscriptWordIndex: () => 42, navigateToTranscriptWord() {},
    handleUpdateChapter: (index: number) => { updates.push(index); },
    setWordUpdateNotification() {}, setTimeout() {},
  });
  assert.deepEqual(updates, [1]);
  assert.equal(chapters[0].start, '01:00:00.000');
});
