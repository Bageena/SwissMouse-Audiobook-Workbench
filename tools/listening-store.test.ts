import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ListeningStore } from './listening-store';
import { createBookmark } from '../src/playback/timeline';
import type { PlaybackManifest } from '../src/playback/types';

const manifest: PlaybackManifest = { bookId: 'book/../stable', signature: 'timeline', kind: 'source', totalDurationSeconds: 30,
  segments: [{ id: 'part', signature: 'audio', durationSeconds: 30, startSeconds: 0, url: '/audio', title: 'Book' }] };
test('listening storage separates profiles/books and restores after restart with stale request protection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-listening-'));
  try {
    const store = new ListeningStore(root), other = new ListeningStore(root, 'second-profile');
    const at = (seconds: number) => createBookmark(manifest, seconds);
    store.save(at(8), { clientSessionId: 'browser', clientSequence: 2 });
    assert.equal(store.save(at(3), { clientSessionId: 'browser', clientSequence: 1 }).positionSeconds, 8);
    assert.equal(other.get(manifest.bookId), undefined);
    const restarted = new ListeningStore(root);
    assert.equal(restarted.get(manifest.bookId)?.positionSeconds, 8);
    assert.equal(restarted.save(at(1), { clientSessionId: 'browser', clientSequence: 0 }).positionSeconds, 8);
    restarted.save(createBookmark({ ...manifest, bookId: 'other-book' }, 4));
    assert.equal(restarted.get(manifest.bookId)?.positionSeconds, 8);
    assert.equal(restarted.get('other-book')?.positionSeconds, 4);
    assert.equal(restarted.has(manifest.bookId), true);
    assert.equal(restarted.has('unknown'), false);
    assert.ok(fs.readdirSync(path.join(root, 'local')).every(name => /^[a-f0-9]{64}\.json(?:\.bak)?$/.test(name)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('listening storage recovers a valid backup and preserves damaged records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-listening-'));
  try {
    const store = new ListeningStore(root);
    store.save(createBookmark(manifest, 8)); store.save(createBookmark(manifest, 12));
    const folder = path.join(root, 'local'), file = path.join(folder, fs.readdirSync(folder).find(name => name.endsWith('.json'))!);
    fs.writeFileSync(file, '{truncated');
    let warning = '';
    assert.equal(new ListeningStore(root, 'local', message => { warning = message; }).get(manifest.bookId)?.positionSeconds, 8);
    assert.match(warning, /Recovered/);
    assert.ok(fs.readdirSync(folder).some(name => name.includes('.corrupt-')));
    fs.writeFileSync(file, '{bad'); fs.writeFileSync(file + '.bak', '{also bad');
    const broken = new ListeningStore(root);
    assert.throws(() => broken.get(manifest.bookId), /damaged/);
    assert.throws(() => broken.save(createBookmark(manifest, 2)), /damaged/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{bad');
    assert.throws(() => new ListeningStore(root, '../unsafe'), /profile/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
