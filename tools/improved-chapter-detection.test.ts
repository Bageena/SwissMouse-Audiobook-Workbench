import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AlignedWord, ChapterCandidate } from '../src/types';
import { formatTimestampMs } from '../src/utils/chapters';
import { candidateChapter, initialDetectedChapters } from '../src/utils/chapterSuggestions';
import { defaultReviewChapters } from '../src/utils/chapterReviewActivity';
import { isolatedHeadingPhrases, structuralSuggestions, sourceBoundaries, reconcileSources, mergeDetectionSuggestions } from './improved-chapter-detection';
import { recoveryWindows, recoveredCandidates, recheckChapterWindows } from './chapter-recovery';
import { musicFeatures, scoreMusicTransitions } from './music-transitions';
import { addGapAudioContext } from './chapter-audio-context';
import { parseHeadingNumber } from './chapter-detection';
import { createTestFixture } from './test-fixtures.mjs';
import type { NormalizedTranscription } from './transcription-engine';

const timed = (text: string, start: number, step = .35): AlignedWord[] => text.split(' ').map((word, index) => ({
  word, start: formatTimestampMs((start + index * step) * 1000), startSeconds: start + index * step, endSeconds: start + (index + 1) * step, confidence: .95,
}));
function phrase(text: string, start: number, before = 3, after = 2) {
  const words = timed(text, start);
  return [...timed('The earlier narration ends.', start - before - 1.4), ...words,
    ...timed('The story resumes across the valley.', words.at(-1)!.endSeconds + after)];
}
function anchor(start: number, number = 1): ChapterCandidate {
  return { candidate_id: number, candidate_start: formatTimestampMs(start * 1000), candidate_end: formatTimestampMs((start + 1) * 1000),
    proposed_title: `Chapter ${number}`, headingType: 'numbered_chapter', chapterNumber: number,
    matched_text: `Chapter ${number}`, context_before: '', context_after: '', status: 'review', notes: '', confidence: '.9' };
}
function wave(file: string, pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
}

test('whole-phrase numbers reject narrative fragments and invalid roman/numeric strings', () => {
  for (const [text, number] of [['Four.', 4], ['twenty-three', 23], ['XIV', 14], ['21st', 21]] as const) assert.equal(parseHeadingNumber(text), number);
  for (const text of ['four horses', 'I was there', 'IIX', '12nd', 'nothing', '0']) assert.equal(parseHeadingNumber(text), undefined, text);
});

test('numbered sections form consecutive sequences within parents and can restart', () => {
  const spoken = [anchor(10), anchor(600, 2)];
  const words = [phrase('One.', 100), phrase('Two.', 230), phrase('Three.', 400), phrase('One.', 700), phrase('Two.', 800), phrase('Three.', 900)].flat();
  const result = structuralSuggestions(words, spoken, 1100);
  assert.deepEqual(result.map(candidate => candidate.chapterNumber), [1, 2, 3, 1, 2, 3]);
  assert.ok(result.every(candidate => candidate.suggestionOnly && candidate.headingType === 'numbered_section'));
  assert.equal(result[3].parentChapterStart, spoken[1].candidate_start);
  assert.equal(result[0].candidate_start, words[4].start);
  assert.equal(result[0].transcriptWordIndex, 4);
});

test('isolated numbers, inline counts, close counting, parent-crossing and bad timelines do not manufacture sequences', () => {
  for (const words of [phrase('Four.', 100), [phrase('One horse.', 100), phrase('Two people.', 250), phrase('Three trees.', 400)].flat(),
    [phrase('One.', 100), phrase('Two.', 110), phrase('Three.', 120)].flat()]) assert.deepEqual(structuralSuggestions(words, [], 600), []);
  const words = [phrase('One.', 100), phrase('Two.', 250), phrase('Three.', 400)].flat();
  assert.deepEqual(structuralSuggestions(words, [anchor(300)], 600), []);
  assert.deepEqual(isolatedHeadingPhrases([...words].reverse(), [], 600), []);
  assert.deepEqual(isolatedHeadingPhrases([{ ...words[0], startSeconds: NaN }, ...words.slice(1)], [], 600), []);
});

test('three different isolated titles need no music; dialogue and solitary titles remain excluded', () => {
  const words = ['The Glass Mountain.', 'The Quiet River.', 'A Secret Garden.'].flatMap((title, index) => phrase(title, 100 + index * 200));
  const result = structuralSuggestions(words, [], 800);
  assert.deepEqual(result.map(candidate => candidate.proposed_title), ['The Glass Mountain', 'The Quiet River', 'A Secret Garden']);
  assert.ok(result.every(candidate => candidate.suggestionOnly));
  assert.deepEqual(structuralSuggestions(phrase('The Glass Mountain.', 100), [], 800), []);
  assert.deepEqual(structuralSuggestions(['The Glass Mountain.', 'The Quiet River.', 'The Quiet River.'].flatMap((title, i) => phrase(title, 100 + i * 200)), [], 800), []);
  assert.deepEqual(structuralSuggestions([phrase('The Glass Mountain.', 100), phrase('The Quiet River.', 300), phrase('A Secret Garden.', 320)].flat(), [], 800), []);
  assert.deepEqual(structuralSuggestions(['He went home.', 'She opened it.', 'The sun rose.'].flatMap((title, i) => phrase(title, 100 + i * 200)), [], 800), []);
});

test('source corroboration can support a single title; unmatched markers stay separate and generic tracks supply no evidence', () => {
  const sources = sourceBoundaries([{ id: 'a', title: 'The Glass Mountain', start: '00:01:40.000' }],
    [{ id: 'p', name: 'Track 01.mp3', order: 1, durationSeconds: 200, sizeBytes: 1, bitrate: 1 }], 800);
  assert.equal(sources.length, 1);
  const candidate = structuralSuggestions(phrase('The Glass Mountain.', 100), [], 800, sources)[0];
  assert.match(candidate.notes, /Matches/);
  const merged = reconcileSources([candidate], [...sources, { start: 500, title: 'Next Story', origin: 'Chapter sidecar' }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].timingSource, 'source');
  assert.ok(merged[1].suggestionOnly);
  assert.equal(merged[1].transcriptWordIndex, undefined);
  assert.equal(mergeDetectionSuggestions(merged, [candidate]).length, 2);
});

test('experimental candidates are excluded from initial chapters and reset; acceptance preserves provenance', () => {
  const candidate = structuralSuggestions([phrase('One.', 100), phrase('Two.', 250), phrase('Three.', 400)].flat(), [anchor(10)], 600)[0];
  const candidates = [anchor(10), candidate];
  assert.equal(initialDetectedChapters(candidates).length, 2);
  const accepted = candidateChapter(candidate, 'accepted');
  assert.equal(accepted.parentChapterStart, '00:00:10.000');
  const job = { chapterSource: 'whisperx', candidates, chapters: [accepted] } as Parameters<typeof defaultReviewChapters>[0];
  assert.deepEqual(defaultReviewChapters(job), initialDetectedChapters(candidates));
  assert.equal(initialDetectedChapters([candidate])[0].title, 'Prologue');
});

test('recheck windows are bounded and search actual pauses inside missing section sequences', () => {
  const words = [phrase('Seven.', 100), phrase('Unclear.', 220), phrase('Nine.', 400)].flat();
  const windows = recoveryWindows(words, [anchor(10)], [], 600);
  assert.ok(windows.some(window => window.number === 8 && window.parent === '00:00:10.000'));
  assert.ok(windows.every(window => window.end - window.start <= 24));
  const mixed = recoveryWindows(words, [anchor(10), anchor(550, 3)], [], 600);
  assert.ok(mixed.some(window => window.number === 2 && window.reason === 'Pause inside a missing spoken-chapter sequence'));
  const many = recoveryWindows([], [], [], 1000, Array.from({ length: 30 }, (_, i) => ({ start: 30 + i * 30, title: 'Story', origin: 'Source' })));
  assert.equal(many.length, 8);
  assert.deepEqual(recoveryWindows(words, [], [], 600).filter(window => window.number === 20), []);
});

const original = [...timed('Earlier narration ends here.', 93), ...timed('The story resumes across the valley.', 104)];
const window = { start: 90, end: 114, target: 100, number: 2, reason: 'Missing Chapter 2', packedStart: 0 };
function recheckResult(): NormalizedTranscription {
  const groups = [timed('Earlier narration ends here.', 3), timed('Chapter Two.', 10), timed('The story resumes across the valley.', 14)];
  return { engine: 'faster-whisper', model: 'small', device: 'cpu', computeType: 'int8', segments: groups.map((words, id) => ({
    id, start: words[0].startSeconds, end: words.at(-1)!.endSeconds, text: words.map(word => word.word).join(' '), noSpeechProbability: .01,
    words: words.map(word => ({ word: word.word, start: word.startSeconds, end: word.endSeconds, probability: word.confidence })),
  })) };
}

test('second-pass headings keep real clip offsets without modifying or fabricating original transcript words', () => {
  const before = structuredClone(original);
  const result = recoveredCandidates(recheckResult(), [window], original);
  assert.equal(result.length, 1);
  assert.equal(result[0].candidate_start, '00:01:40.000');
  assert.equal(result[0].timingSource, 'recheck');
  assert.equal(result[0].transcriptWordIndex, undefined);
  assert.ok(result[0].suggestionOnly && result[0].recovered);
  assert.deepEqual(original, before);
  const low = recheckResult(); low.segments[1].words[0].probability = .1;
  assert.deepEqual(recoveredCandidates(low, [window], original), []);
  const hallucinated = recheckResult(); hallucinated.segments = [hallucinated.segments[1]];
  assert.deepEqual(recoveredCandidates(hallucinated, [window], original), []);
  const silent = recheckResult(); silent.segments[1].noSpeechProbability = .9;
  assert.deepEqual(recoveredCandidates(silent, [window], original), []);
});

test('rechecks reuse versioned results, invalidate on settings changes and remove temporary clips on failure', async t => {
  const fixture = createTestFixture(path.resolve('.cache/chapter-recheck-test-'));
  t.after(() => fixture.cleanup());
  const audio = path.join(fixture.root, 'source.wav'); wave(audio, Buffer.alloc(130 * 32000));
  let runs = 0;
  const options = { audio, directory: fixture.root, windows: [window], original, settingsKey: 'one',
    run: async (clip: string) => { runs++; assert.equal(fs.statSync(clip).size, 44 + 25 * 32000); return recheckResult(); } };
  const first = await recheckChapterWindows(options);
  assert.equal(first.length, 1);
  assert.deepEqual(await recheckChapterWindows(options), first);
  assert.equal(runs, 1);
  await recheckChapterWindows({ ...options, settingsKey: 'two' }); assert.equal(runs, 2);
  await assert.rejects(recheckChapterWindows({ ...options, settingsKey: 'failed', run: async () => { throw Error('backend unavailable'); } }), /backend unavailable/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(recheckChapterWindows({ ...options, signal: controller.signal }), /abort/i);
  assert.ok(fs.readdirSync(fixture.root).every(name => !fs.statSync(path.join(fixture.root, name)).isDirectory()));
});

test('quiet colored noise cannot become music when compared with narration, while audible note cues survive', async t => {
  const fixture = createTestFixture(path.resolve('.cache/chapter-noise-test-'));
  t.after(() => fixture.cleanup());
  const audio = path.join(fixture.root, 'source.wav'), pcm = Buffer.alloc(800 * 32000), starts = [180, 400, 650];
  let seed = 13, low = 0;
  const noise = Buffer.alloc(3 * 32000), notes = Buffer.alloc(3 * 32000);
  for (let i = 0; i < noise.length / 2; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; low = .97 * low + .03 * (seed / 0xffffffff * 2 - 1);
    noise.writeInt16LE(Math.round(low * 800), i * 2);
    const time = i / 16000, frequency = [262, 330, 392, 523][Math.floor(time * 2) % 4];
    notes.writeInt16LE(Math.round(Math.sin(time * frequency * 2 * Math.PI) * 5000), i * 2);
  }
  for (const start of starts) {
    notes.copy(pcm, (start - 3) * 32000); noise.copy(pcm, start * 32000); notes.copy(pcm, (start + 3) * 32000);
  }
  wave(audio, pcm);
  const features = starts.map(start => musicFeatures(noise, { start, end: start + 3, wordIndex: 3 }));
  assert.ok(scoreMusicTransitions(features, [], 800).every(cue => cue.accepted), 'reproduces the old normalized-noise false positive');
  const contextual = await addGapAudioContext(audio, features);
  assert.ok(scoreMusicTransitions(contextual, [], 800).every(cue => !cue.accepted && cue.backgroundRejection));
  // Include short silence at the edges to expose a real noise floor.
  for (const start of starts) { notes.copy(pcm, start * 32000); pcm.fill(0, (start - .3) * 32000, start * 32000); pcm.fill(0, (start + 3) * 32000, (start + 3.3) * 32000); }
  wave(audio, pcm);
  const music = starts.map(start => musicFeatures(notes, { start, end: start + 3, wordIndex: 3 }));
  assert.ok(scoreMusicTransitions(await addGapAudioContext(audio, music), [], 800).every(cue => cue.accepted));
});
