import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudiobookEditController } from '../packages/audiobooks/src/edit-controller';
import { rememberedAudiobookStep } from '../packages/audiobooks/src/session-view';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise<void>(done => setImmediate(done));
type Metadata = { title: string };
type Chapter = { id: string; title: string };
function controller(overrides: Partial<Parameters<typeof createAudiobookEditController<Metadata, Chapter>>[0]> = {}) {
  return createAudiobookEditController<Metadata, Chapter>({
    revision: () => 3, writeDraft: async () => {}, writeRating: async (_id, rating) => ({ rating }), ratingSaved: () => {}, ...overrides,
  });
}
function leaving(edit: ReturnType<typeof controller>, overrides: Partial<Parameters<typeof edit.prepareToLeave>[0]> = {}) {
  return { id: 'a', chaptersChanged: () => true, confirmChapters: () => true, saveChapters: async () => {}, stopPlayback: async () => {}, ...overrides };
}

test('rating writes serialize per book, other books continue, and only the newest rating reaches UI', async () => {
  const gate = deferred(), calls: string[] = [], saved: [string, number | null][] = [];
  const edit = controller({
    writeRating: async (id, rating) => { calls.push(`${id}:${rating}`); if (id === 'a' && rating === 2) await gate.promise; return { rating }; },
    ratingSaved: (id, rating) => { saved.push([id, rating]); },
  });
  const first = edit.saveRating('a', 2), second = edit.saveRating('a', null), other = edit.saveRating('b', 0);
  await other;
  assert.deepEqual(calls, ['a:2', 'b:0']);
  assert.deepEqual(saved, [['b', 0]]);
  gate.resolve(); await Promise.all([first, second]);
  assert.deepEqual(saved, [['b', 0], ['a', null]]);
  assert.equal(edit.withSavedRating({ id: 'a', personalRating: 2 }).personalRating, null);
  assert.equal(edit.withSavedRating({ id: 'b', personalRating: 8 }).personalRating, 0);
});

test('a failed rating is reported, and a later edit can recover', async () => {
  let fail = true;
  const edit = controller({ writeRating: async (_id, rating) => { if (fail) throw new Error('Busy'); return { rating }; } });
  await assert.rejects(edit.saveRating('a', 4), /Busy/);
  fail = false; await edit.saveRating('a', 7);
  assert.equal(edit.withSavedRating({ id: 'a' }).personalRating, 7);
});

test('navigation flush includes edits typed during a slow draft write and retains the original book/revision', async () => {
  const gate = deferred(), writes: [string, string, number][] = [];
  const edit = controller({ writeDraft: async (id, metadata, revision) => {
    writes.push([id, metadata.title, revision]); if (writes.length === 1) await gate.promise;
  } });
  edit.metadataDraft = { jobId: 'a', metadata: { title: 'First' } };
  const flush = edit.flushDraft('a'); await tick();
  edit.metadataDraft = { jobId: 'a', metadata: { title: 'Latest' } };
  gate.resolve(); await flush;
  assert.deepEqual(writes, [['a', 'First', 3], ['a', 'Latest', 3]]);
  assert.equal(edit.metadataDraft.metadata.title, 'Latest');
});

test('failed draft save blocks navigation and keeps edits available for retry', async () => {
  let fail = true;
  const edit = controller({ writeDraft: async () => { if (fail) throw new Error('Conflict'); } });
  const metadata = { title: 'Keep this edit' };
  edit.metadataDraft = { jobId: 'a', metadata };
  await assert.rejects(edit.prepareToLeave(leaving(edit)), /Conflict/);
  assert.equal(edit.metadataDraft.metadata, metadata);
  fail = false;
  assert.equal(await edit.prepareToLeave(leaving(edit)), true);
});

test('chapter cancellation retains the draft; accepted navigation shares preparation and saves late edits', async () => {
  const edit = controller(), gate = deferred();
  const original = [{ id: 'chapter-stable', title: 'Before' }], newer = [{ id: 'chapter-stable', title: 'After' }];
  edit.chapterDraft = { jobId: 'a', chapters: original };
  let stopped = 0, confirmed = 0;
  assert.equal(await edit.prepareToLeave(leaving(edit, { confirmChapters: () => false, stopPlayback: async () => { stopped++; } })), false);
  assert.equal(edit.chapterDraft.chapters, original); assert.equal(stopped, 0);
  const saved: Chapter[][] = [];
  const options = leaving(edit, {
    confirmChapters: () => { confirmed++; return true; },
    saveChapters: async chapters => { saved.push(chapters); if (saved.length === 1) await gate.promise; else edit.chapterDraft = null; },
    stopPlayback: async () => { stopped++; },
  });
  const first = edit.prepareToLeave(options), second = edit.prepareToLeave(options);
  assert.equal(first, second);
  edit.chapterDraft = { jobId: 'a', chapters: newer };
  gate.resolve(); assert.equal(await first, true);
  assert.deepEqual(saved, [original, newer]); assert.equal(confirmed, 1); assert.equal(stopped, 1);
});

test('navigation waits for an in-flight rating on the book being left', async () => {
  const gate = deferred();
  const edit = controller({ writeRating: async (_id, rating) => { await gate.promise; return { rating }; } });
  const rating = edit.saveRating('a', 5); let finished = false;
  const navigation = edit.prepareToLeave(leaving(edit)).then(result => { finished = true; return result; });
  await tick(); assert.equal(finished, false);
  gate.resolve(); await rating; assert.equal(await navigation, true);
});

test('saving an old metadata snapshot cannot clear a newer or different-book draft', () => {
  const edit = controller(), old = { title: 'Old' }, latest = { title: 'Latest' };
  edit.metadataDraft = { jobId: 'a', metadata: latest };
  edit.metadataSaved('a', old);
  assert.equal(edit.withCurrentDraft({ id: 'a', metadataDraft: old }).metadataDraft, latest);
  edit.metadataSaved('b', latest); assert.equal(edit.metadataDraft.metadata, latest);
  edit.metadataSaved('a', latest); assert.equal(edit.metadataDraft, null);
});

test('obsolete navigation reads are cancelled and cannot pass the generation check', () => {
  const edit = controller(), first = edit.beginNavigation(), signal = edit.navigationSignal();
  const second = edit.beginNavigation();
  assert.equal(signal.aborted, true); assert.equal(edit.isCurrentNavigation(first), false);
  assert.equal(edit.isCurrentNavigation(second), true); assert.equal(edit.navigationSignal().aborted, false);
  edit.cancelReads(); assert.equal(edit.navigationSignal().aborted, true); assert.equal(edit.isCurrentNavigation(second), false);
});

test('remembered steps reopen under the legacy key and malformed values fall back to saved progress', () => {
  assert.equal(rememberedAudiobookStep({ id: 'stable-id', status: 'built' }, key => { assert.equal(key, 'swissmouse-book-step-stable-id'); return 2; }), 2);
  for (const value of [undefined, '2', 0, 6, 1.5, NaN, {}]) assert.equal(rememberedAudiobookStep({ id: 'a', status: 'metadata_ready' }, () => value), 3);
  for (const [status, step] of [['draft', 1], ['merged', 2], ['transcribed', 2], ['built', 4], ['validated', 5]] as const)
    assert.equal(rememberedAudiobookStep({ id: 'a', status }, () => undefined), step);
});
