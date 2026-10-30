import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudiobookClient } from '../packages/audiobooks/src/client-service';
import { createLegacyAudiobookWorkspaceClient } from '../packages/audiobooks/src/legacy-workspace-client';

test('rating transport encodes identity, checks saved identity/value and propagates failures', async () => {
  const calls: [string, RequestInit][] = [];
  let response = new Response(JSON.stringify({ bookId: 'book/a', rating: 4 }));
  const client = createAudiobookClient(async (url, options) => { calls.push([String(url), options!]); return response; });
  assert.deepEqual(await client.saveRating('book/a', 4), { bookId: 'book/a', rating: 4 });
  assert.equal(calls[0][0], '/api/jobs/book%2Fa/personal-rating');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0][1].body)), { rating: 4 });
  response = new Response(JSON.stringify({ bookId: 'other', rating: 4 }));
  await assert.rejects(client.saveRating('book/a', 4), /did not match/);
  response = new Response(JSON.stringify({ error: 'Busy' }), { status: 409 });
  await assert.rejects(client.saveRating('book/a', null), /Busy/);
  response = new Response(JSON.stringify({ bookId: 'book/a', rating: null }));
  assert.equal((await client.saveRating('book/a', null)).rating, null);
});

test('draft transport preserves metadata and revision and rejects an unsuccessful write', async () => {
  const metadata = { title: 'Saved title', authors: ['An Author'], custom: { retained: true } };
  const before = JSON.stringify(metadata);
  const client = createAudiobookClient(async (url, options) => {
    assert.equal(url, '/api/jobs/book%2Fa/metadata-draft');
    assert.deepEqual(JSON.parse(String(options?.body)), { metadata, expectedRevision: 7 });
    return new Response(null, { status: 204 });
  });
  await client.saveMetadataDraft('book/a', metadata, 7);
  assert.equal(JSON.stringify(metadata), before);
  const failing = createAudiobookClient(async () => new Response(null, { status: 409 }));
  await assert.rejects(failing.saveMetadataDraft('book/a', metadata, 7), /Could not save the metadata draft/);
  const disconnected = createAudiobookClient(async () => { throw new Error('Offline'); });
  await assert.rejects(disconnected.saveMetadataDraft('book/a', metadata, 7), /Offline/);
});

test('metadata and chapter commands retain revisions, fields, and server conflict messages', async () => {
  const calls: [string, RequestInit][] = [];
  let result = { job: { id: 'a/b', metadataRevision: 8 }, libraryBook: { id: 'a/b' } };
  let status = 200;
  const client = createAudiobookClient(async (url, options) => {
    calls.push([String(url), options!]); return new Response(JSON.stringify(result), { status });
  });
  const metadata = { title: 'Title', explicit: false, cover: null, collections: [{ id: 'stable', name: 'Shelf' }] };
  assert.deepEqual(await client.saveMetadata('a/b', metadata, 7), result);
  assert.equal(calls[0][0], '/api/jobs/a%2Fb/metadata');
  assert.deepEqual(JSON.parse(String(calls[0][1].body)), { metadata, expectedRevision: 7 });
  const chapters = [{ id: 'stable-chapter', start: '00:00:00.000', title: 'Manual', titleManuallyEdited: true }];
  await client.saveChapters('a/b', chapters);
  assert.equal(calls[1][0], '/api/jobs/a%2Fb/chapters');
  assert.deepEqual(JSON.parse(String(calls[1][1].body)), { chapters });
  result = { written: ['metadata.json'] } as any;
  assert.deepEqual(await client.updateMetadataJson('a/b', metadata, 8), ['metadata.json']);
  assert.deepEqual(JSON.parse(String(calls[2][1].body)), { metadata, expectedRevision: 8 });
  status = 409; result = { error: 'Details changed in another view' } as any;
  await assert.rejects(client.saveMetadata('a/b', metadata, 7), /Details changed/);
  await assert.rejects(client.saveChapters('a/b', chapters), /Details changed/);
  await assert.rejects(client.updateMetadataJson('a/b', metadata, 7), /Details changed/);
});

test('book reads pass cancellation, enforce identity and distinguish an unavailable saved book', async () => {
  const controller = new AbortController(); let id = 'a/b', status = 200;
  const client = createAudiobookClient(async (url, options) => {
    assert.equal(url, '/api/jobs/a%2Fb'); assert.equal(options?.signal, controller.signal);
    return new Response(JSON.stringify({ id }), { status });
  });
  assert.equal((await client.loadBook('a/b', { signal: controller.signal }))?.id, 'a/b');
  id = 'wrong'; await assert.rejects(client.loadBook('a/b', { signal: controller.signal }), /did not match/);
  status = 404;
  assert.equal(await client.loadBook('a/b', { signal: controller.signal, allowUnavailable: true }), undefined);
  await assert.rejects(client.loadBook('a/b', { signal: controller.signal, failure: 'Cannot play this book' }), /Cannot play/);
});

test('legacy workflow transport reports confirmation responses without retrying or asking dialogs', async () => {
  const calls: [string, RequestInit | undefined][] = [];
  const api = createLegacyAudiobookWorkspaceClient(async (url, options) => {
    calls.push([String(url), options]);
    return new Response(JSON.stringify({ requiresConfirmation: true, error: 'Keep manual edits?' }), { status: 409 });
  });
  const first = await api.rerun('a/b', 'detecting_chapters', false);
  assert.equal(first.response.status, 409); assert.equal(first.data.requiresConfirmation, true);
  assert.equal(calls.length, 1); assert.deepEqual(JSON.parse(String(calls[0][1]?.body)), { confirmReplaceManualChapters: false });
  await api.rerun('a/b', 'detecting_chapters', true);
  assert.equal(calls[1][0], '/api/jobs/a%2Fb/rerun/detecting_chapters');
  assert.deepEqual(JSON.parse(String(calls[1][1]?.body)), { confirmReplaceManualChapters: true });
  await api.build('a/b', { outputFormats: ['m4b'], overwriteExisting: false });
  assert.equal(calls.length, 3); assert.equal(calls[2][0], '/api/jobs/a%2Fb/build-m4b');
});

test('import revisions, folder previews and explicit transfer approvals survive the service boundary', async () => {
  const calls: [string, RequestInit | undefined][] = [];
  const api = createLegacyAudiobookWorkspaceClient(async (url, options) => {
    calls.push([String(url), options]); return new Response(JSON.stringify({ job: { id: 'a/b' }, moves: [] }));
  });
  const metadata = { title: 'Keep fields', cover: null };
  await api.finishImport('a/b', metadata, true, false, 12);
  assert.deepEqual(JSON.parse(String(calls[0][1]?.body)), { metadata, process: true, writeSource: false, expectedRevision: 12 });
  await api.folderMovePlan('a/b');
  assert.equal(calls[1][0], '/api/jobs/a%2Fb/export-folder-move'); assert.equal(calls[1][1]?.method, undefined);
  const approved = [{ jobId: 'a/b', from: 'original', to: 'reviewed destination' }];
  await api.moveExportFolder('a/b', approved);
  assert.deepEqual(JSON.parse(String(calls[2][1]?.body)), { confirmedMoves: approved });
  await api.moveToLibrary('a/b', 'copy', true);
  assert.equal(calls[3][0], '/api/library/a%2Fb/send-to-library');
  assert.equal((calls[3][1]?.headers as Record<string, string>)['X-SwissMouse-Catalog'], '1');
  await api.moveToLibrary('a/b', 'move', false);
  assert.equal(calls[4][0], '/api/jobs/a%2Fb/move-to-library');
});

test('legacy operation errors and partial failures remain available to the controller', async () => {
  const api = createLegacyAudiobookWorkspaceClient(async () => new Response(JSON.stringify({ error: 'Active work', written: ['kept.mp3'], failures: ['failed.m4b'] }), { status: 409 }));
  await assert.rejects(api.saveSettings('a', {}), /Active work/);
  await assert.rejects(api.validate('a'), /Active work/);
  await assert.rejects(api.removeProject('a'), /Active work/);
  const partial = await api.writeAudioMetadata('a');
  assert.equal(partial.response.ok, false); assert.deepEqual(partial.data.written, ['kept.mp3']); assert.deepEqual(partial.data.failures, ['failed.m4b']);
  let context = '';
  const diagnostics = createLegacyAudiobookWorkspaceClient(async () => new Response('old server HTML'), async (_response, operation) => { context = operation; throw new Error('Expected JSON'); });
  await assert.rejects(diagnostics.verifyAudio('a'), /Expected JSON/); assert.equal(context, 'Recheck project audio');
});
