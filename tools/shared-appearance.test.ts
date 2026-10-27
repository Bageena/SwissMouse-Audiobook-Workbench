import assert from 'node:assert/strict';
import test from 'node:test';
import { saveSharedTheme, readSharedTheme } from '../src/utils/sharedAppearance';

test('queued theme changes remain ordered and recover after a failed save', async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = (async (_url, options) => {
    const { theme } = JSON.parse(options!.body as string);
    requests.push(theme);
    if (theme === 'cheese') await gate;
    return { ok: theme !== 'dark', json: async () => ({ theme }) } as Response;
  }) as typeof fetch;
  try {
    const first = saveSharedTheme('cheese');
    const second = saveSharedTheme('parchment');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests, ['cheese']);
    release();
    assert.equal(await first, 'cheese');
    assert.equal(await second, 'parchment');
    await assert.rejects(saveSharedTheme('dark'), /could not be saved/);
    assert.equal(await saveSharedTheme('forest'), 'forest');
    assert.deepEqual(requests, ['cheese', 'parchment', 'dark', 'forest']);
  } finally { release(); globalThis.fetch = original; }
});

test('shared theme reads bypass browser caching and report server failures', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url, options) => {
    assert.equal(url, '/api/appearance');
    assert.equal(options?.cache, 'no-store');
    return { ok: true, json: async () => ({ theme: 'cheese' }) } as Response;
  }) as typeof fetch;
  try {
    assert.equal(await readSharedTheme(), 'cheese');
    globalThis.fetch = (async () => ({ ok: false }) as Response) as typeof fetch;
    await assert.rejects(readSharedTheme(), /Could not read/);
  } finally { globalThis.fetch = original; }
});
