import test from 'node:test';
import assert from 'node:assert/strict';
import { getTranscriptWordsNear } from '../src/utils/wordAlignment';

test('transcript context follows a changed chapter timestamp', () => {
  const words = [
    { word: 'earlier', start: '00:00:04.000', startSeconds: 4, endSeconds: 4.5 },
    { word: 'near', start: '00:00:30.000', startSeconds: 30, endSeconds: 30.5 },
    { word: 'selected', start: '00:00:45.000', startSeconds: 45, endSeconds: 45.5 },
    { word: 'later', start: '00:01:11.000', startSeconds: 71, endSeconds: 71.5 },
  ];

  assert.deepEqual(getTranscriptWordsNear(words, 45).map(word => word.word), ['near', 'selected']);
  assert.deepEqual(getTranscriptWordsNear(words, 71).map(word => word.word), ['later']);
});
