import test from 'node:test';
import assert from 'node:assert/strict';
import { findBookMatches, pairKey, type MatchBook } from './library-matches';
import { energyEnvelope, envelopeConfidence } from './audio-match';
import { sampledEnvelope } from './audio-match';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const book = (id: string, narrator = 'Reader', title = 'The Book'): MatchBook => ({ id,
  metadata: { title, author: 'Writer', narrator, genres: [], language: 'eng', abridged: false, explicit: false },
  durationSeconds: 3600, chapterCount: 12, formats: ['MP3'], fileSizes: [12345] });

test('same book and different narrator remains a book match, not duplicate audio', () => {
  const matches = findBookMatches([book('a'), book('b', 'Other Reader')]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].kind, 'book');
  assert.ok(matches[0].reasons.includes('Different narrators'));
  assert.equal(findBookMatches([book('a'), book('b', 'Other Reader')], new Set([pairKey('a', 'b')])).length, 0);
});

test('missing series remains matchable; different editions with similar runtime stay reviewable books', () => {
  const a = book('a'), b = book('b');
  a.metadata.series = 'Cycle'; a.metadata.edition = 'Unabridged';
  b.metadata.edition = 'Radio drama';
  const match = findBookMatches([a, b])[0];
  assert.equal(match.kind, 'book');
  assert.ok(match.reasons.includes('Different editions'));
  assert.ok(match.reasons.includes('Similar runtime'));
});

test('missing narrator stays uncertain and merged representations are hidden from review', () => {
  const a = book('a'), b = book('b', '');
  assert.equal(findBookMatches([a, b])[0].kind, 'uncertain');
  a.logicalBookId = 'a'; b.logicalBookId = 'a';
  assert.equal(findBookMatches([a, b]).length, 0);
});

test('equal file sizes create a hash-review candidate despite conflicting titles', () => {
  const a = book('a'), b = book('b', 'Other Reader', 'Wrong Album Tag');
  assert.equal(findBookMatches([a, b]).length, 1);
  assert.equal(findBookMatches([a, b])[0].kind, 'uncertain');
  assert.match(findBookMatches([a, b])[0].reasons[0], /file counts and sizes/);
});

test('candidate generation is bounded for large repeated-title sets', () => {
  const candidates = Array.from({ length: 500 }, (_, index) => book(String(index)));
  assert.equal(findBookMatches(candidates).length, 2000);
});

// Distinct sizes isolate metadata matching from the independent exact-size
// candidate path; equal fixture sizes would hide false title matches.
const named = (id: string, title: string, author = 'Writer'): MatchBook => ({ ...book(id, 'Reader', title),
  metadata: { ...book(id).metadata, title, author }, fileSizes: [] });

test('file order, collection codes, format suffixes and author lists reveal the same book', () => {
  const a = named('a', '01 FW1.0 Earth Unaware.m4b', 'Orson Scott Card');
  const b = named('b', 'Ender09 - Earth Unaware [MP3 64kbps]', 'Orson Scott Card, Aaron Johnston');
  const matches = findBookMatches([a, b]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].kind, 'uncertain');
  assert.ok(matches[0].reasons.includes('Overlapping authors'));
  assert.match(matches[0].reasons[0], /naming and format annotations/);
  assert.equal(findBookMatches([a, b], new Set([pairKey('a', 'b')])).length, 0);
  b.metadata.title = 'Ender10 - Earth Afire [MP3 64kbps]';
  assert.equal(findBookMatches([a, b]).length, 0, 'different novels remain separate');
});

test('author inversion, structured lists, initials and punctuation remain compatible', () => {
  const a = named('a', 'Ender’s Game', 'Orson Scott Card');
  const b = named('b', 'Enders Game', 'Card, Orson Scott');
  assert.ok(findBookMatches([a, b])[0].reasons.includes('Matching author'));
  a.metadata.title = b.metadata.title = 'The Hobbit';
  a.metadata.authors = ['Tolkien, J. R. R.']; b.metadata.author = 'JRR Tolkien';
  assert.equal(findBookMatches([a, b])[0].kind, 'book');
  a.metadata.authors = ['Terry Pratchett', 'Neil Gaiman'];
  b.metadata.author = 'Neil Gaiman & Terry Pratchett';
  assert.ok(findBookMatches([a, b])[0].reasons.includes('Matching author'));
});

test('known author and series decorations are removed without erasing numeric titles', () => {
  const a = named('a', 'Orson Scott Card - Ender’s Game (Unabridged)', 'Orson Scott Card');
  const b = named('b', 'Enders Game', 'Orson Scott Card');
  assert.equal(findBookMatches([a, b]).length, 1);
  a.metadata.title = 'Ender Saga 01 - Enders Game'; a.metadata.series = 'Ender Saga';
  assert.equal(findBookMatches([a, b]).length, 1);
  a.metadata.title = 'The Hive: The Second Formic War, Book 2'; b.metadata.title = 'The Hive';
  a.metadata.series = ''; a.durationSeconds = b.durationSeconds = 0;
  assert.equal(findBookMatches([a, b]).length, 1, 'explicit series suffix needs no runtime probe');
  a.metadata.title = b.metadata.title = '1984';
  assert.equal(findBookMatches([a, b]).length, 1);
});

test('different numbered novels and subtitle variants do not collapse to their series', () => {
  const a = named('a', 'Collected Stories (Volume 1)');
  const b = named('b', 'Collected Stories (Volume 2)');
  assert.equal(findBookMatches([a, b]).length, 0);
  a.metadata.title = 'Shared Series: The First of Many Adventures';
  b.metadata.title = 'Shared Series: The Last of Many Adventures';
  assert.equal(findBookMatches([a, b]).length, 0);
  a.metadata.title = 'Dune'; b.metadata.title = 'Dune: Messiah';
  assert.equal(findBookMatches([a, b]).length, 0);
});

test('omitted subtitles require supporting metadata and remain review candidates', () => {
  const a = named('a', 'Sapiens: A Brief History of Humankind');
  const b = named('b', 'Sapiens');
  assert.equal(findBookMatches([a, b])[0].kind, 'uncertain');
  b.durationSeconds = 0;
  assert.equal(findBookMatches([a, b]).length, 0, 'no runtime evidence for an untagged subtitle');
  a.metadata.subtitle = 'A Brief History of Humankind';
  assert.equal(findBookMatches([a, b]).length, 1, 'an explicit subtitle establishes the title boundary');
});

test('generic track titles and unrelated known authors do not flood review', () => {
  for (const title of ['01', 'Disc 1', 'Track 01.mp3', 'Book 2', 'Unknown Title', 'Untitled']) {
    assert.equal(findBookMatches([named('a', title), named('b', title)]).length, 0, title);
  }
  const a = named('a', 'The Lost World', 'Arthur Conan Doyle');
  const b = named('b', 'The Lost World', 'Michael Crichton');
  assert.equal(findBookMatches([a, b]).length, 0);
  b.metadata.author = 'Unknown Author';
  assert.equal(findBookMatches([a, b])[0].kind, 'uncertain');
});

test('matching identifiers and sizes find conflicting tags without false author claims', () => {
  for (const field of ['isbn', 'asin'] as const) {
    const a = named('a', 'One Title', 'One Author'), b = named('b', 'Wrong Title', 'Other Author');
    a.metadata[field] = field === 'isbn' ? '978-0-123456-78-9' : 'B012345678';
    b.metadata[field] = field === 'isbn' ? '9780123456789' : 'b012345678';
    const match = findBookMatches([a, b])[0];
    assert.equal(match.kind, 'uncertain');
    assert.ok(match.reasons.includes('Matching ' + field.toUpperCase()));
    assert.ok(match.reasons.includes('Different authors'));
    assert.ok(!match.reasons.includes('Matching author'));
    b.missing = true;
    assert.equal(findBookMatches([a, b]).length, 0);
  }
  const a = named('a', 'One Title', 'One Author'), b = named('b', 'Wrong Title', 'Other Author');
  a.fileSizes = [100, 200]; b.fileSizes = [200, 100];
  const match = findBookMatches([a, b])[0];
  assert.ok(match.reasons.includes('Different authors'));
  assert.ok(!match.reasons.includes('Matching author'));
});

test('candidate cap covers separate groups and members before exhaustive popular-title pairs', () => {
  const candidates = Array.from({ length: 500 }, (_, index) => named('popular-' + index, 'Popular Book'));
  for (let i = 0; i < 40; i++) candidates.push(named('pair-' + i + '-a', 'Distinct Book ' + i), named('pair-' + i + '-b', 'Distinct Book ' + i));
  const matches = findBookMatches(candidates);
  assert.equal(matches.length, 2000);
  const covered = new Set(matches.flatMap(match => [match.a, match.b]));
  assert.equal(covered.size, candidates.length, 'the first large bucket must not starve later books or members');
  assert.equal(new Set(matches.map(match => pairKey(match.a, match.b))).size, matches.length);
});

test('large common-title libraries use author indexes rather than quadratic comparisons', () => {
  const candidates = Array.from({ length: 12000 }, (_, index) => named(String(index), 'Same Title', 'Distinct Author ' + index));
  candidates.push(named('real-a', 'The Actual Book'), named('real-b', '01 - The Actual Book.m4b'));
  const matches = findBookMatches(candidates);
  assert.equal(matches.length, 1);
  assert.equal(pairKey(matches[0].a, matches[0].b), pairKey('real-a', 'real-b'));
});

test('activity fingerprint needs changing speech-like energy, and tolerates small encode differences', () => {
  const pcm = Buffer.alloc(4000 * 2 * 20);
  for (let frame = 0; frame < 20; frame++) for (let sample = 0; sample < 4000; sample++)
    pcm.writeInt16LE(Math.round(1000 + 900 * Math.sin(frame * 1.7)), (frame * 4000 + sample) * 2);
  const envelope = energyEnvelope(pcm);
  assert.ok(envelopeConfidence([envelope], [envelope.map(value => value + .02)]) > .99);
  assert.equal(envelopeConfidence([envelope], [Array(20).fill(-1)]), 0);
});

test('sampled activity identifies the same recording across MP3 and M4B encodes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-audio-match-'));
  const ffmpeg = process.env.TEST_FFMPEG || path.resolve('runtime', 'bin', 'ffmpeg' + (process.platform === 'win32' ? '.exe' : ''));
  try {
    const source = path.join(root, 'source.wav'), mp3 = path.join(root, 'book.mp3'), m4b = path.join(root, 'book.m4b');
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=sin(2*PI*440*t)*(0.1+0.08*sin(2*PI*0.17*t)):s=16000:d=100', '-c:a', 'pcm_s16le', source], { windowsHide: true });
    execFileSync(ffmpeg, ['-v', 'error', '-i', source, '-c:a', 'libmp3lame', '-b:a', '96k', mp3], { windowsHide: true });
    execFileSync(ffmpeg, ['-v', 'error', '-i', source, '-c:a', 'aac', '-b:a', '64k', m4b], { windowsHide: true });
    const [first, second] = await Promise.all([sampledEnvelope(ffmpeg, mp3, 100), sampledEnvelope(ffmpeg, m4b, 100)]);
    assert.ok(envelopeConfidence(first, second) > .94, 'cross-format encodes should produce closely matching activity');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
