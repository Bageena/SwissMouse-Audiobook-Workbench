import test from 'node:test';
import assert from 'node:assert/strict';
import { StatusCache } from './status-cache';

test('concurrent status reads share work; refresh, expiry and invalidation rediscover changes', async () => {
  let calls = 0;
  const cache = new StatusCache<number>(20);
  const load = async () => { calls++; await new Promise(r => setTimeout(r, 5)); return calls; };
  assert.deepEqual(await Promise.all([cache.get(load), cache.get(load), cache.refresh(load)]), [1,1,1]);
  assert.equal(await cache.get(load), 1);
  assert.equal(await cache.refresh(load), 2);
  cache.invalidate();
  assert.equal(await cache.get(load), 3);
  await new Promise(r => setTimeout(r, 25));
  assert.equal(await cache.get(load), 4);
});

test('an invalidated in-flight response cannot overwrite a fresh result; errors are retried', async () => {
  const cache = new StatusCache<number>(60_000);
  let finish!: (n: number) => void;
  const stale = cache.get(() => new Promise(resolve => finish = resolve));
  cache.invalidate();
  assert.equal(await cache.get(async () => 2), 2);
  finish(1); await stale;
  assert.equal(await cache.get(async () => 3), 2);
  cache.invalidate();
  await assert.rejects(cache.get(async () => { throw Error('unavailable'); }));
  assert.equal(await cache.get(async () => 4), 4);
});
