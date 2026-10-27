import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalRatingController, normalizePersonalRating, personalRatingAtPosition, personalRatingForKey } from '../src/utils/personalRating';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

test('rating hit targets use actual star halves and account for gaps', () => {
  const stars = [0, 1, 2, 3, 4].map((index) => ({ left: 103 + index * 26, width: 20 }));
  assert.equal(personalRatingAtPosition(103 + 3 * 26 + 4, stars), 7, 'left half of star four is 3.5');
  assert.equal(personalRatingAtPosition(103 + 3 * 26 + 16, stars), 8, 'right half of star four is 4');
  assert.equal(personalRatingAtPosition(103 + 2 * 26 + 10, stars), 6, 'exact midpoint belongs to the right half');
  assert.equal(personalRatingAtPosition(124, stars), 2, 'gap after the first star keeps the first full star');
  assert.equal(personalRatingAtPosition(-10, stars), 1);
  assert.equal(personalRatingAtPosition(1000, stars), 10);
  assert.equal(personalRatingAtPosition(Number.NaN, stars), null);
});

test('rating keyboard supports half stars, bounds, zero, and explicit unrated', () => {
  assert.equal(personalRatingForKey(null, 'ArrowRight'), 1);
  assert.equal(personalRatingForKey(10, 'ArrowRight'), 10);
  assert.equal(personalRatingForKey(5, 'ArrowLeft'), 4);
  assert.equal(personalRatingForKey(0, 'ArrowDown'), 0);
  assert.equal(personalRatingForKey(7, 'Home'), 0);
  assert.equal(personalRatingForKey(1, 'End'), 10);
  assert.equal(personalRatingForKey(0, 'Delete'), null);
  assert.equal(personalRatingForKey(8, 'Backspace'), null);
  assert.equal(personalRatingForKey(8, 'Tab'), undefined);
  assert.equal(normalizePersonalRating(0), 0);
  assert.equal(normalizePersonalRating(null), null);
  assert.equal(normalizePersonalRating(5.5), null);
  assert.equal(normalizePersonalRating(11), null);
});

test('dragging both directions previews without writes and flushes final position on switch', async () => {
  const writes: (number | null)[] = [];
  const control = new PersonalRatingController(10, async (value) => { writes.push(value); });
  control.preview(3);
  control.preview(9);
  control.preview(6);
  assert.deepEqual(writes, []);
  assert.equal(control.getSnapshot().value, 6);
  control.flush();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(writes, [6]);
  assert.equal(control.getSnapshot().saving, false);
});

test('double-click clear is the final write despite slow earlier clicks and stale props', async () => {
  const writes: (number | null)[] = [];
  const first = deferred();
  const control = new PersonalRatingController(10, async (value) => {
    writes.push(value);
    if (writes.length === 1) await first.promise;
  });
  void control.commit(6);
  void control.commit(6);
  const clearing = control.commit(null);
  await Promise.resolve();
  assert.deepEqual(writes, [6]);
  control.syncSaved(6);
  assert.equal(control.getSnapshot().value, null, 'late saved click cannot overwrite optimistic clear');
  first.resolve();
  await clearing;
  assert.deepEqual(writes, [6, 6, null]);
  assert.deepEqual(control.getSnapshot(), { value: null, saving: false, error: null });
});

test('failed earlier writes do not block a later clear and final failures restore last confirmed rating', async () => {
  let calls = 0;
  const control = new PersonalRatingController(4, async () => {
    calls++;
    if (calls === 1 || calls === 3) throw new Error('Offline');
  });
  void control.commit(10);
  await control.commit(null);
  assert.deepEqual(control.getSnapshot(), { value: null, saving: false, error: null });
  await control.commit(8);
  assert.deepEqual(control.getSnapshot(), { value: null, saving: false, error: 'Offline' });
});

test('switching books keeps pending saves and subsequent ratings associated with their own controls', async () => {
  const writes: { book: string; rating: number | null }[] = [];
  const pendingA = deferred();
  const bookA = new PersonalRatingController(null, async (rating) => { writes.push({ book: 'a', rating }); await pendingA.promise; });
  const bookB = new PersonalRatingController(4, async (rating) => { writes.push({ book: 'b', rating }); });
  bookA.preview(7);
  bookA.flush();
  await bookB.commit(10);
  assert.deepEqual(writes, [{ book: 'a', rating: 7 }, { book: 'b', rating: 10 }]);
  pendingA.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(bookA.getSnapshot().value, 7);
  assert.equal(bookB.getSnapshot().value, 10);
});

test('an in-flight save does not overwrite a newer unfinished drag', async () => {
  const pending = deferred();
  const writes: (number | null)[] = [];
  const control = new PersonalRatingController(2, async (value) => { writes.push(value); await pending.promise; });
  const saved = control.commit(8);
  control.preview(3);
  pending.resolve();
  await saved;
  control.syncSaved(8);
  assert.equal(control.getSnapshot().value, 3);
  control.flush();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(writes, [8, 3]);
});
