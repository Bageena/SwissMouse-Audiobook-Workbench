import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuickPlaybackController, type ListeningCheckpoint, type QuickAudio, type QuickPlaybackDependencies } from '../src/playback/QuickPlaybackController';
import { QuickPlayer, listeningTime } from '../src/components/QuickPlayer';

test('mini player keeps five-second skipping optional and off by default', () => {
  const normal = renderToStaticMarkup(React.createElement(QuickPlayer, { jobId: 'fixture' }));
  assert.doesNotMatch(normal, /Rewind 5 seconds|Forward 5 seconds/);
  const withSkip = renderToStaticMarkup(React.createElement(QuickPlayer, { jobId: 'fixture', showSkipControls: true }));
  assert.match(withSkip, /Rewind 5 seconds/);
  assert.match(withSkip, /Forward 5 seconds/);
});
import type { PlaybackManifest } from '../src/playback/types';
import { locatePosition } from '../src/playback/timeline';

const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

class FakeAudio extends EventTarget implements QuickAudio {
  tagName = 'AUDIO';
  src = '';
  preload = '';
  volume = 1;
  muted = false;
  currentTime = 0;
  readyState = 1;
  paused = true;
  ended = false;
  plays = 0;
  loadMetadata = true;
  playResult: Promise<void> = Promise.resolve();
  play() {
    this.plays++;
    return this.playResult.then(() => { this.paused = false; this.dispatchEvent(new Event('play')); });
  }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
  load() {
    if (this.src && this.loadMetadata) { this.readyState = 1; this.dispatchEvent(new Event('loadedmetadata')); }
    if (!this.src) { this.currentTime = 0; this.readyState = 0; }
  }
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
  advance(seconds: number) { this.currentTime = seconds; this.dispatchEvent(new Event('timeupdate')); }
  finish(seconds: number) {
    this.currentTime = seconds; this.ended = true; this.paused = true;
    this.dispatchEvent(new Event('pause')); this.dispatchEvent(new Event('ended'));
  }
}
const manifest = (bookId = 'book-a', durations = [60, 90]): PlaybackManifest => {
  let offset = 0;
  return { bookId, signature: `${bookId}-signature`, kind: 'source', totalDurationSeconds: durations.reduce((sum, value) => sum + value, 0),
    segments: durations.map((durationSeconds, index) => {
      const segment = { id: `part-${index}`, signature: `file-${index}`, url: `/stream/${bookId}/${index}`, title: `Part ${index + 1}`, durationSeconds, startSeconds: offset };
      offset += durationSeconds; return segment;
    }) };
};
function fixture(options: { position?: number; completed?: boolean; request?: QuickPlaybackDependencies['request']; createAudio?: () => FakeAudio } = {}) {
  const audio: FakeAudio[] = [];
  const requests: { url: string; options?: RequestInit; body?: ListeningCheckpoint }[] = [];
  const intervals = new Map<number, () => void>();
  const pageTarget = new EventTarget();
  const otherAudio = new FakeAudio();
  let timerId = 0;
  const controller = new QuickPlaybackController({
    createAudio: () => { const item = options.createAudio?.() || new FakeAudio(); audio.push(item); return item; },
    request: async (url, init) => {
      requests.push({ url, options: init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (options.request) return options.request(url, init);
      if (init?.method === 'POST') return response({ bookmark: JSON.parse(String(init.body)) });
      const bookId = decodeURIComponent(url.split('/')[3]);
      const media = manifest(bookId);
      return response({ manifest: media, resume: { ...locatePosition(media, options.position || 0), completed: options.completed || false } });
    },
    setInterval: (callback, milliseconds) => { assert.equal(milliseconds, 15000); intervals.set(++timerId, callback); return timerId; },
    clearInterval: handle => { intervals.delete(handle as number); },
    pauseOtherAudio: () => otherAudio.pause(), activityTarget: otherAudio, pageTarget, sessionId: 'test-player-session',
  });
  return { controller, audio, requests, intervals, pageTarget, otherAudio,
    posts: () => requests.filter(item => item.options?.method === 'POST'), tick: () => { for (const callback of intervals.values()) callback(); } };
}

test('quick player resumes in the right file, reports cumulative progress, and Stop retains its checkpoint', async () => {
  const { controller, audio, posts, intervals } = fixture({ position: 75 });
  await controller.selectBook('book-a');
  assert.equal(controller.getSnapshot().positionSeconds, 75);
  assert.deepEqual(controller.getSnapshot().queue, manifest('book-a').segments.map(({ id, title, durationSeconds }) => ({ id, title, durationSeconds })), 'the visible playback order follows the actual streaming manifest');
  await controller.play();
  assert.equal(audio[0].src, '/stream/book-a/1');
  assert.equal(audio[0].currentTime, 15);
  assert.equal(audio[0].preload, 'metadata');
  audio[0].advance(30);
  assert.equal(controller.getSnapshot().positionSeconds, 90);
  await controller.stop();
  assert.equal(audio[0].src, '', 'stop releases the old stream');
  assert.equal(audio[0].paused, true);
  assert.equal(intervals.size, 0);
  assert.equal(controller.getSnapshot().positionSeconds, 90);
  assert.equal(posts().at(-1)!.body!.positionSeconds, 90);
  assert.equal(posts().at(-1)!.body!.segmentId, 'part-1');
  assert.equal(posts().at(-1)!.body!.segmentOffsetSeconds, 30);
  await controller.play();
  assert.equal(audio[1].currentTime, 30);
  controller.dispose();
});

test('source files advance automatically and completion displays the end until the next Play', async () => {
  const { controller, audio, posts } = fixture();
  await controller.selectBook('book-a'); await controller.play();
  audio[0].finish(60); await settle();
  assert.equal(audio.length, 2);
  assert.equal(audio[1].src, '/stream/book-a/1');
  assert.equal(controller.getSnapshot().positionSeconds, 60);
  assert.equal(controller.getSnapshot().status, 'playing');
  audio[1].finish(90); await settle();
  assert.equal(controller.getSnapshot().positionSeconds, 150);
  assert.equal(controller.getSnapshot().completed, true);
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.equal(posts().at(-1)!.body!.completed, true);
  await controller.play();
  assert.equal(audio[2].src, '/stream/book-a/0');
  assert.equal(audio[2].currentTime, 0);
  assert.equal(controller.getSnapshot().completed, false);
  controller.dispose();
});

test('switching books ignores an old manifest response and an old pending play promise', async () => {
  const oldResponse = deferred<ReturnType<typeof response>>();
  const context = fixture({ request: async (url, options) => {
    if (options?.method === 'POST') return response({});
    if (url.includes('/book-a/')) return oldResponse.promise;
    const media = manifest('book-b'); return response({ manifest: media, resume: { ...locatePosition(media, 0), completed: false } });
  } });
  const oldPlay = context.controller.play('book-a');
  await context.controller.selectBook('book-b');
  oldResponse.resolve(response({ manifest: manifest('book-a'), resume: { ...locatePosition(manifest(), 45), completed: false } }));
  await oldPlay;
  assert.equal(context.controller.getSnapshot().jobId, 'book-b');
  assert.equal(context.audio.length, 0);
  context.controller.dispose();

  const waiting = deferred<void>();
  const pending = fixture({ createAudio: () => { const item = new FakeAudio(); item.playResult = waiting.promise; return item; } });
  await pending.controller.selectBook('book-a');
  const attempt = pending.controller.play();
  await settle();
  await pending.controller.selectBook('book-b');
  waiting.resolve(); await attempt;
  assert.equal(pending.audio[0].paused, true);
  assert.equal(pending.audio[0].src, '');
  assert.equal(pending.controller.getSnapshot().jobId, 'book-b');
  assert.equal(pending.controller.getSnapshot().status, 'ready');
  pending.controller.dispose();
});

test('checkpoints serialize and coalesce to the latest position while a prior save is pending', async () => {
  const first = deferred<ReturnType<typeof response>>();
  let count = 0;
  const context = fixture({ request: async (_url, options) => {
    if (options?.method === 'POST') return ++count === 1 ? first.promise : response({});
    return response({ manifest: manifest(), resume: { ...locatePosition(manifest(), 0), completed: false } });
  } });
  await context.controller.selectBook('book-a'); await context.controller.play();
  context.audio[0].advance(10); context.tick();
  context.audio[0].advance(20); context.tick();
  context.audio[0].advance(30); const stopped = context.controller.stop();
  assert.equal(count, 1);
  first.resolve(response({})); await stopped;
  assert.deepEqual(context.posts().map(item => item.body!.positionSeconds), [10, 30]);
  assert.ok(context.posts()[1].body!.clientSequence > context.posts()[0].body!.clientSequence);
  context.controller.dispose();
});

test('Stop cancels an in-flight Play refresh even if the same book is selected again', async () => {
  const delayed = deferred<ReturnType<typeof response>>();
  let reads = 0;
  const context = fixture({ request: async (_url, options) => {
    if (options?.method === 'POST') return response({});
    if (++reads === 2) return delayed.promise;
    return response({ manifest: manifest(), resume: { ...locatePosition(manifest(), 0), completed: false } });
  } });
  await context.controller.selectBook('book-a');
  const play = context.controller.play();
  await context.controller.stop();
  await context.controller.selectBook('book-a');
  delayed.resolve(response({ manifest: manifest(), resume: { ...locatePosition(manifest(), 0), completed: false } }));
  await play;
  assert.equal(context.audio.length, 0, 'the cancelled Play cannot start the freshly selected book');
  context.controller.dispose();
});

test('a failed manifest refresh retains newer local progress for the next successful Play', async () => {
  let reads = 0;
  const context = fixture({ request: async (_url, options) => {
    if (options?.method === 'POST') throw new Error('offline save');
    if (++reads === 3) throw new Error('offline manifest');
    return response({ manifest: manifest(), resume: { ...locatePosition(manifest(), 5), completed: false } });
  } });
  await context.controller.selectBook('book-a'); await context.controller.play();
  context.audio[0].advance(27); await context.controller.stop();
  await context.controller.play();
  assert.equal(context.controller.getSnapshot().status, 'error');
  await context.controller.play();
  assert.equal(context.audio[1].currentTime, 27);
  context.controller.dispose();
});

test('failed saves stay visible, switching rejects after stopping, and Retry saves the latest position', async () => {
  let fail = true;
  const context = fixture({ request: async (_url, options) => {
    if (options?.method === 'POST') { if (fail) throw new Error('offline'); return response({}); }
    return response({ manifest: manifest(), resume: { ...locatePosition(manifest(), 0), completed: false } });
  } });
  await context.controller.selectBook('book-a'); await context.controller.play();
  context.audio[0].advance(24);
  await assert.rejects(context.controller.stopForSwitch(), /could not be saved/);
  assert.equal(context.audio[0].paused, true);
  assert.equal(context.controller.getSnapshot().positionSeconds, 24);
  assert.match(context.controller.getSnapshot().saveError!, /Retry/);
  fail = false; await context.controller.retrySave();
  assert.equal(context.controller.getSnapshot().saveError, undefined);
  assert.equal(context.posts().at(-1)!.body!.positionSeconds, 24);
  await context.controller.stopForSwitch();
  context.controller.dispose();
});

test('pagehide dispatches the newest keepalive even with a save in flight, using increasing sequence guards', async () => {
  const older = deferred<ReturnType<typeof response>>();
  let count = 0;
  const context = fixture({ request: async (_url, options) => {
    if (options?.method === 'POST') return ++count === 1 ? older.promise : response({});
    return response({ manifest: manifest(), resume: { ...locatePosition(manifest(), 0), completed: false } });
  } });
  await context.controller.selectBook('book-a'); await context.controller.play();
  context.audio[0].advance(10); context.tick();
  context.audio[0].advance(22); context.pageTarget.dispatchEvent(new Event('pagehide')); await settle();
  assert.equal(context.posts().length, 2, 'unload cannot wait for the previous response');
  const [first, last] = context.posts();
  assert.equal(last.options!.keepalive, true);
  assert.equal(last.body!.positionSeconds, 22);
  assert.equal(first.body!.clientSessionId, last.body!.clientSessionId);
  assert.ok(last.body!.clientSequence > first.body!.clientSequence);
  older.reject(new Error('old request failed')); await settle();
  assert.equal(context.controller.getSnapshot().saveError, undefined, 'an obsolete failed save cannot overwrite newer success');
  context.controller.dispose();
});

test('starting another audio preview stops the quick player; quick playback pauses existing page audio', async () => {
  const context = fixture();
  context.otherAudio.paused = false;
  await context.controller.selectBook('book-a'); await context.controller.play();
  assert.equal(context.otherAudio.paused, true);
  context.audio[0].advance(12);
  await context.otherAudio.play(); await settle();
  assert.equal(context.audio[0].paused, true);
  assert.equal(context.controller.getSnapshot().status, 'ready');
  assert.equal(context.posts().at(-1)!.body!.positionSeconds, 12);
  context.controller.dispose();
});

test('media errors are visible and an unmount releases media without losing the last position', async () => {
  const context = fixture();
  await context.controller.selectBook('book-a'); await context.controller.play();
  context.audio[0].advance(19); context.audio[0].dispatchEvent(new Event('error')); await settle();
  assert.equal(context.controller.getSnapshot().status, 'error');
  assert.match(context.controller.getSnapshot().error!, /could not be played/);
  assert.equal(context.controller.getSnapshot().positionSeconds, 19);
  await context.controller.play();
  assert.equal(context.audio[1].currentTime, 19);
  context.audio[1].advance(28); context.controller.releaseBook('book-a'); await settle();
  assert.equal(context.audio[1].src, '');
  assert.equal(context.controller.getSnapshot().jobId, undefined);
  assert.equal(context.posts().at(-1)!.body!.positionSeconds, 28);
  context.controller.dispose();
});

test('completed bookmark restarts at zero and unavailable manifests expose an actionable error', async () => {
  const completed = fixture({ position: 150, completed: true });
  await completed.controller.selectBook('book-a');
  assert.equal(completed.controller.getSnapshot().completed, true);
  await completed.controller.play();
  assert.equal(completed.audio[0].src, '/stream/book-a/0');
  completed.controller.dispose();
  const missing = fixture({ request: async () => response({ error: 'A selected source file is missing.' }, false) });
  await missing.controller.play('book-a');
  assert.equal(missing.audio.length, 0);
  assert.match(missing.controller.getSnapshot().error!, /source file is missing/);
  missing.controller.dispose();
});

test('quick controls display compact transport controls and cumulative progress', () => {
  const html = renderToStaticMarkup(React.createElement(QuickPlayer, { jobId: 'fixture' }));
  assert.equal((html.match(/<button\b/g) || []).length, 5);
  assert.match(html, /Play audiobook/);
  assert.match(html, /Previous chapter/);
  assert.match(html, /Next chapter/);
  assert.match(html, /Stop audiobook playback/);
  assert.match(html, /role="slider"/);
  assert.match(html, /aria-label="Listening position"/);
  assert.match(html, /aria-label="Audiobook volume"/);
  assert.match(html, /aria-label="Mute audiobook"/);
  assert.equal(listeningTime(2 * 3600 + 30 * 60), '2:30:00');
});

test('chapter seeking crosses files, preserves paused position, and explicit Stop resets the book', async () => {
  const f = fixture();
  await f.controller.play('book-a');
  await f.controller.seek(75);
  assert.equal(f.audio.at(-1)!.src, '/stream/book-a/1');
  assert.equal(f.audio.at(-1)!.currentTime, 15);
  assert.equal(f.controller.getSnapshot().totalDurationSeconds, 150);
  await f.controller.stop(); // Pause retains position through existing checkpoint behavior.
  assert.equal(f.controller.getSnapshot().positionSeconds, 75);
  await f.controller.seek(30);
  assert.equal(f.controller.getSnapshot().positionSeconds, 30);
  assert.equal(f.controller.getSnapshot().status, 'ready');
  await f.controller.play();
  assert.equal(f.audio.at(-1)!.currentTime, 30);
  await f.controller.stopAndReset();
  assert.equal(f.controller.getSnapshot().positionSeconds, 0);
  assert.equal(f.controller.getSnapshot().completed, false);
  assert.equal(f.posts().at(-1)!.body!.positionSeconds, 0);
  f.controller.dispose();
});

test('file previews reuse quick playback without overwriting book listening progress', async () => {
  const f = fixture();
  await f.controller.play('book-a'); f.audio[0].advance(23);
  await f.controller.previewFile('book-a', 'other.mp3', 'D:\\Books', 80);
  assert.equal(f.posts().at(-1)!.body!.positionSeconds, 23);
  const savedCount = f.posts().length;
  assert.match(f.audio.at(-1)!.src, /audio-preview/);
  f.audio.at(-1)!.advance(12); await f.controller.checkpoint();
  assert.equal(f.posts().length, savedCount, 'preview progress is not a book checkpoint');
  const audioCount = f.audio.length;
  await f.controller.previewFile('book-a', 'other.mp3', 'D:\\Books', 80);
  assert.equal(f.audio.length, audioCount, 'reselecting the playing preview never restarts it');
  await f.controller.stop(); await f.controller.seekPreview(30); await f.controller.play('book-a');
  assert.equal(f.audio.at(-1)!.currentTime, 30);
  await f.controller.selectBook('book-a'); assert.equal(f.controller.getSnapshot().preview, undefined);
  assert.equal(f.posts().length, savedCount);
  f.controller.dispose();
});

test('volume and mute apply immediately and survive file transitions and book switches', async () => {
  const f = fixture();
  f.controller.setVolume(.37);
  await f.controller.play('book-a');
  assert.equal(f.audio[0].volume, .37);
  f.controller.toggleMute();
  assert.equal(f.audio[0].muted, true);
  await f.controller.seek(75);
  assert.equal(f.audio.at(-1)!.volume, .37);
  assert.equal(f.audio.at(-1)!.muted, true);
  await f.controller.play('book-b');
  assert.equal(f.audio.at(-1)!.volume, .37);
  assert.equal(f.audio.at(-1)!.muted, true);
  f.controller.toggleMute();
  assert.equal(f.audio.at(-1)!.volume, .37);
  assert.equal(f.audio.at(-1)!.muted, false);
  f.controller.toggleMute();
  f.controller.setVolume(.62);
  assert.equal(f.audio.at(-1)!.volume, .62);
  assert.equal(f.audio.at(-1)!.muted, false);
  f.controller.setVolume(4);
  assert.equal(f.audio.at(-1)!.volume, 1);
  f.controller.setVolume(NaN);
  assert.equal(f.audio.at(-1)!.volume, 1);
  f.controller.dispose();
});
