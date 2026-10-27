import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryVirtualRange } from '../src/components/useLibraryVirtualRows';

for (const count of [2_000, 5_000, 10_000]) {
  test(`continuous library windows ${count} rows`, () => {
    const rowHeight = 88;
    const offsets = Array.from({ length: count + 1 }, (_, index) => index * rowHeight);
    for (const scrollTop of [0, 700, count * rowHeight / 2, count * rowHeight - 700]) {
      const { start, end } = libraryVirtualRange(offsets, scrollTop, 700);
      assert.ok(start >= 0 && end <= count && start < end);
      assert.ok(end - start <= 30, `mounted ${end - start} rows`);
      assert.ok(offsets[start] <= Math.max(0, scrollTop - 600));
      assert.ok(offsets[end] >= Math.min(offsets[count], scrollTop + 700));
    }
  });
}
