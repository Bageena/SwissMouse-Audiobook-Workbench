import test from 'node:test';
import assert from 'node:assert/strict';
import { mapScanWork } from './scan-work';

test('scan work overlaps I/O within the limit and preserves discovery order', async () => {
  let active = 0, peak = 0;
  const values = await mapScanWork([0, 1, 2, 3, 4, 5], 3, async value => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, value === 0 ? 20 : 2));
    active--;
    return value * 2;
  });
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.deepEqual(values, [0, 2, 4, 6, 8, 10]);
});

test('failed scan work settles active readers before rollback', async () => {
  let active = 0;
  await assert.rejects(mapScanWork([0, 1, 2, 3], 2, async value => {
    active++;
    try {
      await new Promise(resolve => setTimeout(resolve, value === 0 ? 1 : 10));
      if (value === 0) throw new Error('Unreadable file');
      return value;
    } finally { active--; }
  }), /Unreadable file/);
  assert.equal(active, 0, 'no unfinished readers can mutate a rolled-back scan');
  assert.deepEqual(await mapScanWork([], 2, async value => value), []);
});
