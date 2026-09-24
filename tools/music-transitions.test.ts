import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { musicFeatures, musicGaps, scoreMusicTransitions, detectMusicTransitions } from './music-transitions';
import { readManifest } from './audio-analysis';
import { detectChapterHeadings } from './chapter-detection';
import { applyDefaultChapterEnds, validateChapterEntries } from '../src/utils/chapters';
import type { AlignedWord, ChapterCandidate } from '../src/types';

// Generated note sequences and synthetic speech timing only; no audiobook data,
// model, network, FFmpeg process, or GPU required by these tests.
function cue(padding = 0, seconds = 8, tone = false, frequencies = [262, 330, 392, 523]) {
  const pcm = Buffer.alloc(Math.round((seconds + padding * 2) * 16000) * 2);
  for (let i = 0; i < seconds * 16000; i++) {
    const time = i / 16000;
    const frequency = tone ? 440 : frequencies[Math.floor(time * 2) % frequencies.length];
    const phase = 2 * Math.PI * frequency * time;
    const envelope = Math.min(1, (time % 0.5) * 50, (0.5 - time % 0.5) * 50);
    pcm.writeInt16LE(Math.round((Math.sin(phase) + 0.4 * Math.sin(phase * 2) + 0.2 * Math.sin(phase * 3)) * 5000 * (tone ? 1 : envelope)), (i + Math.round(padding * 16000)) * 2);
  }
  return pcm;
}
function evidence(start: number, padding = 0, seconds = 8, tone = false) {
  return musicFeatures(cue(padding, seconds, tone), { start, end: start + seconds + padding * 2, wordIndex: 3 });
}
function wordsAround(start: number, gapDuration = 8): AlignedWord[] {
  return [-3, -2, -1, gapDuration, gapDuration + 1, gapDuration + 2].map((offset, i) => ({
    word: ['We', 'went', 'home.', 'Then', 'we', 'left.'][i], start: '', startSeconds: start + offset, endSeconds: start + offset + 1, confidence: 0.9,
  }));
}
function scaled(pcm: Buffer, gain: number) {
  const result = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i += 2) result.writeInt16LE(Math.round(pcm.readInt16LE(i) * gain), i);
  return result;
}

test('speech/music/speech yields a tonal gap but isolated music is rejected', () => {
  const words = wordsAround(180);
  assert.deepEqual(musicGaps(words, 1000), [{ start: 180, end: 188, wordIndex: 3 }]);
  const [decision] = scoreMusicTransitions([evidence(180)], [], 1000);
  assert.ok(decision.tonalFraction > 0.9);
  assert.ok(decision.variation >= 0.008);
  assert.equal(decision.accepted, false);
  assert.match(decision.reason, /Isolated/);
});
test('three recurring spectral signatures without silence are accepted', () => {
  const decisions = scoreMusicTransitions([180, 400, 650].map(start => evidence(start)), [], 1000);
  assert.ok(decisions.every(c => c.accepted && c.repeats === 3));
});
test('two matching cues require silence on both sides', () => {
  assert.ok(scoreMusicTransitions([evidence(180), evidence(400)], [], 1000).every(c => !c.accepted));
  assert.ok(scoreMusicTransitions([evidence(180, 0.5), evidence(400, 0.5)], [], 1000).every(c => c.accepted));
});
test('equal durations with different acoustics do not establish recurrence', () => {
  const other = musicFeatures(cue(0, 8, false, [800, 1100, 1500, 2000]), { start: 400, end: 408, wordIndex: 3 });
  assert.ok(scoreMusicTransitions([evidence(180), other], [], 1000).every(c => !c.accepted));
});
test('steady ambient tones, silence and long passages are rejected', () => {
  assert.ok(scoreMusicTransitions([evidence(180, 0, 8, true), evidence(400, 0, 8, true), evidence(650, 0, 8, true)], [], 1000).every(c => !c.accepted));
  const silence = musicFeatures(Buffer.alloc(8 * 32000), { start: 180, end: 188, wordIndex: 3 });
  assert.equal(scoreMusicTransitions([silence], [], 1000)[0].accepted, false);
  assert.deepEqual(musicGaps(wordsAround(180, 60), 1000), []);
  assert.equal(scoreMusicTransitions([evidence(180, 0, 20)], [], 1000)[0].accepted, false);
});
test('quiet repeated cues survive gain changes and long silence around short music', () => {
  const features = [1, 0.02, 0.05].map((gain, i) => musicFeatures(scaled(cue(12, 8), gain), {
    start: 180 + i * 220, end: 212 + i * 220, wordIndex: 3,
  }));
  assert.deepEqual(musicGaps(wordsAround(180, 32), 1000), [{ start: 180, end: 212, wordIndex: 3 }]);
  assert.ok(features.every(feature => feature.duration > 7 && feature.duration < 9));
  assert.ok(scoreMusicTransitions(features, [], 1000).every(decision => decision.accepted));
});
test('cue matching tolerates different silence padding and sub-frame alignment', () => {
  const features = [[0.17, 2.4], [0.93, 0.27], [1.42, 0.68]].map(([before, after], index) => {
    const pcm = Buffer.concat([Buffer.alloc(Math.round(before * 16000) * 2), cue(), Buffer.alloc(Math.round(after * 16000) * 2)]);
    const start = 180 + index * 220;
    return musicFeatures(pcm, { start, end: start + before + 8 + after, wordIndex: 3 });
  });
  assert.ok(scoreMusicTransitions(features, [], 1000).every(decision => decision.accepted));
});
test('brief changing musical stings can recur without opening the gate to ordinary short pauses', () => {
  const features = [180, 400, 650].map(start => evidence(start, 0, 2));
  assert.equal(musicGaps(wordsAround(180, 2), 1000).length, 1);
  assert.ok(scoreMusicTransitions(features, [], 1000).every(decision => decision.accepted));
  assert.deepEqual(musicGaps(wordsAround(180, 1), 1000), []);
});
test('explicit music annotations do not split the gap or move the resumed speech index', () => {
  for (const labels of [['[Music]'], ['[soft', 'instrumental', 'music]'], ['♪'], ['(background music)']]) {
    const words = wordsAround(180);
    words.splice(3, 0, ...labels.map((word, i) => ({ word, start: '', startSeconds: 181 + i, endSeconds: 182 + i })));
    assert.deepEqual(musicGaps(words, 1000), [{ start: 180, end: 188, wordIndex: 3 + labels.length }]);
  }
});
test('unknown annotations, low-confidence speech and ordinary spoken music are not erased', () => {
  for (const label of ['music', '[inaudible]', '[Chapter]', 'something']) {
    const words = wordsAround(180);
    words.splice(3, 0, { word: label, start: '', startSeconds: 181, endSeconds: 187, confidence: 0.2 });
    assert.deepEqual(musicGaps(words, 1000), []);
  }
  const words = wordsAround(180); words[2].word = 'music.';
  assert.equal(musicGaps(words, 1000).length, 1);
});
test('continuous narration including background music has no gap; intro/outro excluded', () => {
  assert.deepEqual(musicGaps(wordsAround(180, 0), 1000), []);
  assert.deepEqual(musicGaps(wordsAround(2), 1000), []);
  assert.deepEqual(musicGaps(wordsAround(950), 1000), []);
  assert.deepEqual(musicGaps([], 1000), []);
});
test('spoken headings retain priority and music spacing cannot manufacture recurrence', () => {
  const features = [180, 400, 650].map(start => evidence(start));
  const decisions = scoreMusicTransitions(features, [408], 1000);
  assert.equal(decisions[1].accepted, false);
  assert.match(decisions[1].reason, /Spoken heading/);
  assert.equal(decisions[0].accepted, true);
  assert.ok(scoreMusicTransitions([evidence(180), evidence(200), evidence(220)], [], 1000).every(c => !c.accepted));
  // The last two snippets corroborate the first individually, but are not
  // independent repeats of one another and therefore cannot establish three.
  assert.ok(scoreMusicTransitions([evidence(180), evidence(400), evidence(420)], [], 1000).every(c => !c.accepted));
  assert.equal(detectChapterHeadings([{ id: 1, start: 10, end: 12, text: 'Chapter Twenty', words: [] }])[0].chapterNumber, 20);
});
test('intro/outro signatures cannot supply the missing recurrence evidence', () => {
  assert.ok(scoreMusicTransitions([evidence(20), evidence(400), evidence(940)], [], 1000).every(c => !c.accepted));
});
test('similarity chains do not substitute for three mutually matching musical cues', () => {
  const base = evidence(180);
  const features = [0, 15, 30].map((angle, index) => ({
    ...base, start: 180 + index * 220, end: 188 + index * 220,
    fingerprint: [Math.cos(angle * Math.PI / 180), Math.sin(angle * Math.PI / 180)],
  }));
  assert.ok(scoreMusicTransitions(features, [], 1000).every(cue => !cue.accepted && cue.repeats <= 2));
});
test('strongest nearby boundary wins consistently regardless of input order', () => {
  const features = [evidence(180), evidence(200, 0.5), evidence(400, 0.5), evidence(650, 0.5)];
  const accepted = (items: typeof features) => scoreMusicTransitions(items, [], 1000).filter(cue => cue.accepted).map(cue => cue.start).sort((a, b) => a - b);
  assert.deepEqual(accepted(features), [200, 400, 650]);
  assert.deepEqual(accepted([...features].reverse()), [200, 400, 650]);
});
test('broadband noise does not become a music boundary even when the recording repeats', () => {
  let state = 13;
  const pcm = Buffer.alloc(8 * 32000);
  for (let i = 0; i < pcm.length; i += 2) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    pcm.writeInt16LE(Math.round((state / 0xffffffff * 2 - 1) * 4000), i);
  }
  const features = [180, 400, 650].map(start => musicFeatures(pcm, { start, end: start + 8, wordIndex: 3 }));
  assert.ok(scoreMusicTransitions(features, [], 1000).every(cue => !cue.accepted));
});
test('missing speech evidence, overlapping words, and bad timelines are conservative', () => {
  assert.deepEqual(musicGaps(wordsAround(180).slice(1), 1000), []);
  const words = wordsAround(180); words[0].endSeconds = 190;
  assert.deepEqual(musicGaps(words, 1000), []);
  const malformed = wordsAround(180); malformed[0].startSeconds = NaN;
  assert.deepEqual(musicGaps(malformed, 1000), []);
});

function writeWave(audio: string, pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(audio, Buffer.concat([header, pcm]));
}

test('real PCM windows, resumed word anchoring, cache reuse/invalidation and normal chapter ends', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-music-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const audio = path.join(dir, 'analysis.wav'), pcm = Buffer.alloc(800 * 32000);
  const starts = [180, 400, 650];
  for (const start of starts) cue(0.5).copy(pcm, start * 32000);
  writeWave(audio, pcm);
  const words = starts.flatMap(start => wordsAround(start, 9));
  const logs: string[] = [];
  const first = await detectMusicTransitions(audio, words, [], { log: message => logs.push(message) });
  assert.equal(first.length, 3);
  assert.equal(first[0].candidate_start, '00:03:09.000');
  assert.equal(first[0].transcriptWordIndex, 3);
  assert.equal(first[0].status, 'review');
  const manifest = readManifest(audio);
  const cache = fs.readdirSync(manifest.directory).find(name => name.startsWith('music-'))!;
  const cacheTime = fs.statSync(path.join(manifest.directory, cache)).mtimeMs;
  assert.deepEqual(await detectMusicTransitions(audio, words, [], { log: message => logs.push(message) }), first);
  assert.equal(fs.statSync(path.join(manifest.directory, cache)).mtimeMs, cacheTime);
  assert.ok(logs.some(line => line.includes('cache: Hit')));
  // Valid JSON with the wrong resumed-word index must not redirect a candidate.
  const corrupt = JSON.parse(fs.readFileSync(path.join(manifest.directory, cache), 'utf8'));
  corrupt.features[0].wordIndex = 9999;
  fs.writeFileSync(path.join(manifest.directory, cache), JSON.stringify(corrupt));
  assert.deepEqual(await detectMusicTransitions(audio, words, []), first);
  const chapters = applyDefaultChapterEnds([{ id: 'opening', start: '00:00:00.000', title: 'Opening' }, ...first.map((c, i) => ({ id: String(i), start: c.candidate_start, title: c.proposed_title, headingType: c.headingType }))], 800);
  assert.equal(chapters[0].end, '00:03:08.999'); // Existing inclusive end convention.
  assert.equal(validateChapterEntries(chapters, 800), null);
  const spoken: ChapterCandidate[] = [{ ...first[1], headingType: 'numbered_chapter', proposed_title: 'Chapter Twenty' }];
  const combined = await detectMusicTransitions(audio, words, spoken);
  assert.equal(combined.length, 3);
  assert.equal(combined[1].proposed_title, 'Chapter Twenty');
  const changedWords = words.map((w, i) => i === 3 ? { ...w, startSeconds: w.startSeconds + 0.1 } : w);
  await detectMusicTransitions(audio, changedWords, []);
  assert.equal(fs.readdirSync(manifest.directory).filter(name => name.startsWith('music-')).length, 2);
  const stat = fs.statSync(audio); fs.utimesSync(audio, stat.atime, new Date(stat.mtimeMs + 2000));
  await detectMusicTransitions(audio, words, []);
  assert.notEqual(readManifest(audio).directory, manifest.directory);
  const afterReplacement = readManifest(audio);
  // Project temporary cleanup may remove the generation but retain the manifest.
  const generation = path.resolve(afterReplacement.directory);
  assert.ok(generation.startsWith(path.resolve(dir) + path.sep));
  fs.rmSync(generation, { recursive: true, force: true });
  assert.equal(readManifest(audio), null);
  assert.deepEqual(await detectMusicTransitions(audio, words, []), first);
  const readFile = fs.promises.readFile;
  try {
    fs.promises.readFile = (async (...args: Parameters<typeof readFile>) => {
      const content = await readFile(...args);
      if (String(args[0]).includes('/music-')) {
        const current = fs.statSync(audio);
        fs.utimesSync(audio, current.atime, new Date(current.mtimeMs + 2000));
      }
      return content;
    }) as typeof readFile;
    await assert.rejects(detectMusicTransitions(audio, words, []), /Preview changed/);
  } finally { fs.promises.readFile = readFile; }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(detectMusicTransitions(audio, words, [], { signal: controller.signal }), /abort/i);
});
