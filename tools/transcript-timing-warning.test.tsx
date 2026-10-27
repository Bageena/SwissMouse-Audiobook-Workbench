import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranscriptTimingWarning } from '../src/components/TranscriptTimingWarning';
import { buildTranscriptWords, missingWordTimestampSegments } from '../src/utils/wordAlignment';

const timed = { id: 0, start: 1, end: 2, text: 'Hello', words: [{ word: 'Hello', start: 1.125, end: 1.8 }] };
const untimed = { id: 1, start: 5, end: 7, text: 'Missing passage', words: [] };
test('missing timing warning preserves untimed text and exact valid word timestamps', () => {
  const segments = [timed, untimed, { ...untimed, id: 2, text: '  ' }];
  assert.deepEqual(missingWordTimestampSegments(segments), [untimed]);
  assert.deepEqual(buildTranscriptWords(segments).map(w => [w.word, w.startSeconds, w.endSeconds]), [['Hello', 1.125, 1.8]]);
  const html = renderToStaticMarkup(<TranscriptTimingWarning segments={segments} />);
  assert.match(html, /Missing passage/);
  assert.match(html, /00:00:05\.000/);
  assert.match(html, /00:00:07\.000/);
  assert.match(html, /not word timings/);
  assert.equal(renderToStaticMarkup(<TranscriptTimingWarning segments={[timed]} />), '');
});
test('fully untimed results remain reviewable without inventing words', () => {
  assert.equal(buildTranscriptWords([untimed]).length, 0);
  assert.match(renderToStaticMarkup(<TranscriptTimingWarning segments={[untimed]} />), /Missing passage/);
});
