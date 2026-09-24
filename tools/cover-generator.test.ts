import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCoverDesign, fitCoverText, squareCrop, solidTextColor, wrapCoverText } from '../src/utils/coverGenerator';

test('cover defaults copy metadata without mutating it', () => {
  const metadata = { title: 'The Last Lighthouse', author: 'Mira Vale', narrator: 'Sam Reed' };
  const design = defaultCoverDesign(metadata);
  design.title = 'Cover-only title';
  assert.equal(metadata.title, 'The Last Lighthouse');
  assert.equal(design.author, metadata.author);
  assert.equal(design.narrator, metadata.narrator);
});

test('square crops preserve aspect ratio for portrait and landscape images', () => {
  assert.deepEqual(squareCrop(3000, 1000), { x: 1000, y: 0, size: 1000 });
  assert.deepEqual(squareCrop(1000, 3000), { x: 0, y: 1000, size: 1000 });
});

test('wrapping keeps normal words intact and fits oversized tokens', () => {
  assert.deepEqual(wrapCoverText('one two three', 7, t => t.length), ['one two', 'three']);
  assert.deepEqual(wrapCoverText('abcdefgh', 3, t => t.length), ['abc', 'def', 'gh']);
});

test('long titles and credits stay inside their allocated safe areas', () => {
  const measure = (text: string, size: number) => Array.from(text).length * size * 0.7;
  for (const text of ['A short title', 'An unusually long title with many words '.repeat(14), 'W'.repeat(500), '海'.repeat(300)]) {
    const title = fitCoverText(text, 1640, 760, 230, measure);
    assert.ok(title.lines.length > 0);
    assert.ok(title.height <= 760);
    assert.ok(title.lines.every(line => measure(line, title.size) <= 1640));
    const author = fitCoverText('Author '.repeat(40), 1640, 280, Math.min(84, title.size * .65), measure);
    assert.ok(author.size < title.size);
    assert.ok(author.height <= 280);
  }
});

test('solid background contrast selects readable light and dark text', () => {
  assert.equal(solidTextColor('#ffffff'), '#151515');
  assert.equal(solidTextColor('#000000'), '#ffffff');
  assert.equal(solidTextColor('#ffff00'), '#151515');
  assert.equal(solidTextColor('#0000ff'), '#ffffff');
});
