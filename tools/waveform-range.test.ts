import test from 'node:test';
import assert from 'node:assert/strict';
import { waveformRange, waveformTime } from '../src/utils/waveform';

test('range keeps millisecond boundaries and fits exactly across the canvas', () => {
  const range = waveformRange('01:00:00.125', '01:02:03.456', 7200)!;
  assert.deepEqual(range, { start: 3600.125, end: 3723.456 });
  assert.equal(waveformTime(0, 800, range.start, range.end - range.start), range.start);
  assert.equal(waveformTime(800, 800, range.start, range.end - range.start), range.end);
  assert.deepEqual(waveformRange('00:00:00', '02:00:00', 7200), { start: 0, end: 7200 });
});

test('range rejects malformed, reversed, empty and out-of-audio endpoints', () => {
  for (const [from, to] of [['', '00:01:00'], ['00:60:00', '01:01:00'], ['00:00:60', '00:02:00'], ['00:01:00', '00:01:00'], ['00:02:00', '00:01:00'], ['-00:01:00', '00:02:00'], ['00:00:00', '02:00:00.001'], ['00:00:00.0001', '00:01:00']]) {
    assert.equal(waveformRange(from, to, 7200), null, `${from} to ${to}`);
  }
});
