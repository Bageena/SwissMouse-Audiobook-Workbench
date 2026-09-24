import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AlignedWord, ChapterCandidate } from '../src/types';
import { musicFeatures } from './music-transitions';
import { findIsolatedTitles, scoreTitleBoundaries, detectTitleBoundaries, type TitleEvidence } from './title-boundaries';

function wordsFor(title: string, start: number, before = 12, after = 4): AlignedWord[] {
  const timed = (text: string, time: number, step = 0.35): AlignedWord[] => text.split(' ').map((word, i) => ({
    word, start: '', startSeconds: time + i * step, endSeconds: time + (i + 1) * step, confidence: 0.95,
  }));
  const phrase = timed(title, start);
  return [...timed('Earlier narration ends.', start - before - 1.5, 0.5), ...phrase,
    ...timed('The story continues in a distant land.', phrase.at(-1)!.endSeconds + after)];
}
function cue(seconds = 12, constant = false): Buffer {
  const pcm = Buffer.alloc(Math.round(seconds * 32000));
  for (let i = 0; i < pcm.length / 2; i++) {
    const time = i / 16000, frequency = constant ? 440 : [261, 330, 392, 523][Math.floor(time * 3) % 4];
    pcm.writeInt16LE(Math.round(5500 * (Math.sin(time * 2 * Math.PI * frequency) + 0.3 * Math.sin(time * 4 * Math.PI * frequency))), i * 2);
  }
  return pcm;
}
function evidence(title: string, start: number, before = 12, after = 4, constant = false): TitleEvidence {
  const [phrase] = findIsolatedTitles(wordsFor(title, start, before, after), 1000);
  assert.ok(phrase);
  return { ...phrase, acoustic: musicFeatures(cue(before, constant), { start: start - before, end: start, wordIndex: phrase.wordIndex }) };
}

test('isolated spoken noun phrases retain exact saved word positions and sensible title case', () => {
  const words = wordsFor('the glass mountain.', 200.123, 38, 16);
  const [title] = findIsolatedTitles(words, 1000);
  assert.equal(title.title, 'The Glass Mountain');
  assert.equal(title.start, 200.123);
  assert.equal(title.end, words[5].endSeconds);
  assert.equal(title.wordIndex, 3);
  assert.equal(title.wordEndIndex, 5);
  assert.equal(title.pauseAfter, 16);
});
test('different tonal transitions corroborate two internal titles and an opening title', () => {
  const features = [evidence('The First Voyage', 25, 15), evidence('The Glass Mountain', 200, 38, 16), evidence('The Quiet River', 650, 27, 6)];
  const decisions = scoreTitleBoundaries(features, [], 1000);
  assert.ok(decisions.every(cue => cue.accepted));
  assert.equal(decisions[0].supportingTitles, 2);
  assert.equal(decisions[1].supportingTitles, 1);
});
test('lone title, intro plus lone internal title, repeated same phrase and nearby pairs are insufficient', () => {
  const one = evidence('The Glass Mountain', 200);
  assert.equal(scoreTitleBoundaries([one], [], 1000)[0].accepted, false);
  assert.ok(scoreTitleBoundaries([evidence('The First Voyage', 25), one], [], 1000).every(cue => !cue.accepted));
  assert.ok(scoreTitleBoundaries([one, evidence('The Glass Mountain', 650)], [], 1000).every(cue => !cue.accepted));
  assert.ok(scoreTitleBoundaries([one, evidence('The Quiet River', 250)], [], 1000).every(cue => !cue.accepted));
});
test('repeated ordinary short narration, dialogue, credits and sound labels are not titles', () => {
  for (const phrase of ['He went home.', 'The sun rose.', 'A door opened.', 'It was over.', 'Then came dawn.', 'She smiled.', 'Please come back.', 'The narrator said.', 'We are here.', 'The end.', 'Thank you for listening.', 'An Audible production.', '[Soft music]', '"The secret room!"']) {
    assert.deepEqual(findIsolatedTitles([...wordsFor(phrase, 200), ...wordsFor(phrase, 600)], 1000), [], phrase);
  }
});
test('missing pauses, long speech, distant joins, weak words and bad timelines are rejected', () => {
  assert.deepEqual(findIsolatedTitles(wordsFor('The Glass Mountain', 200, 4), 1000), []);
  assert.deepEqual(findIsolatedTitles(wordsFor('The Glass Mountain', 200, 70), 1000), []);
  assert.deepEqual(findIsolatedTitles(wordsFor('The Glass Mountain', 200, 12, 1), 1000), []);
  assert.deepEqual(findIsolatedTitles(wordsFor('The Glass Mountain', 200, 12, 35), 1000), []);
  assert.deepEqual(findIsolatedTitles(wordsFor('The Mountain', 960), 1000), []);
  const split = wordsFor('The Glass Mountain', 200);
  split[4].startSeconds += 2; split[4].endSeconds += 2;
  for (let i = 5; i < split.length; i++) { split[i].startSeconds += 2; split[i].endSeconds += 2; }
  assert.deepEqual(findIsolatedTitles(split, 1000), []);
  const weak = wordsFor('The Glass Mountain', 200); weak[4].confidence = 0.1;
  assert.deepEqual(findIsolatedTitles(weak, 1000), []);
  const zero = wordsFor('The Glass Mountain', 200); zero[4].endSeconds = zero[4].startSeconds;
  assert.deepEqual(findIsolatedTitles(zero, 1000), []);
  const malformed = wordsFor('The Glass Mountain', 200); malformed[4].startSeconds = NaN;
  assert.deepEqual(findIsolatedTitles(malformed, 1000), []);
  const backwards = wordsFor('The Glass Mountain', 200); backwards[4].startSeconds = 180;
  assert.deepEqual(findIsolatedTitles(backwards, 1000), []);
  assert.deepEqual(findIsolatedTitles(wordsFor('The Long Long Long Long Long Long Long Long Long Long Long Long Long Long Title', 200), 1000), []);
});
test('silence and steady ambient tone do not corroborate titles; explicit headings retain priority', () => {
  const features = [evidence('The Glass Mountain', 200), evidence('The Quiet River', 650)];
  const quiet = features.map(cue => ({ ...cue, acoustic: { ...cue.acoustic, duration: 0, tonalFraction: 0 } }));
  assert.ok(scoreTitleBoundaries(quiet, [], 1000).every(cue => !cue.accepted));
  assert.ok(scoreTitleBoundaries([evidence('The Glass Mountain', 200, 12, 4, true), evidence('The Quiet River', 650, 12, 4, true)], [], 1000).every(cue => !cue.accepted));
  const priority = scoreTitleBoundaries(features, [201], 1000);
  assert.equal(priority[0].accepted, false);
  assert.match(priority[0].reason, /Existing spoken/);
  assert.equal(priority[1].accepted, true);
});

function writeWave(audio: string, pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(audio, Buffer.concat([header, pcm]));
}
test('cached PCM analysis produces review candidates anchored to saved title words, without transcribing again', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-titles-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const audio = path.join(directory, 'analysis.wav'), pcm = Buffer.alloc(500 * 32000);
  for (const start of [25, 180, 380]) cue().copy(pcm, (start - 12) * 32000);
  writeWave(audio, pcm);
  const words = [...wordsFor('The First Voyage', 25), ...wordsFor('The Glass Mountain', 180), ...wordsFor('The Quiet River', 380)];
  const logs: string[] = [];
  const candidates = await detectTitleBoundaries(audio, words, [], { log: message => logs.push(message) });
  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].candidate_start, '00:00:25.000');
  assert.equal(candidates[1].candidate_start, '00:03:00.000');
  assert.equal(candidates[2].candidate_start, '00:06:20.000');
  assert.ok(candidates.every(candidate => candidate.status === 'review' && candidate.headingType === 'chapter_like'));
  assert.ok(candidates.every(candidate => words[candidate.transcriptWordIndex!].startSeconds * 1000 === [25000, 180000, 380000][candidate.candidate_id - 1]));
  const again = await detectTitleBoundaries(audio, words, [], { log: message => logs.push(message) });
  assert.deepEqual(again, candidates);
  assert.ok(logs.some(line => /cache: Hit/i.test(line)));
  const prior: ChapterCandidate = { ...candidates[1], proposed_title: 'Chapter One', headingType: 'numbered_chapter' };
  const merged = await detectTitleBoundaries(audio, words, [prior]);
  assert.equal(merged.length, 3);
  assert.equal(merged[1].proposed_title, 'Chapter One');
  assert.equal(merged[1].headingType, 'numbered_chapter');
});
test('empty or uncorroborated transcript avoids expensive analysis and cancellation propagates', async () => {
  assert.deepEqual(await detectTitleBoundaries('not-an-audio-file', [], []), []);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(detectTitleBoundaries('not-an-audio-file', [], [], { signal: controller.signal }), { name: 'AbortError' });
});
