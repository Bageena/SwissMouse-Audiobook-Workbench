import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import express from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DependencyStatusProvider } from '../src/dependency-status';
import { Step1MergeDetect } from '../src/components/Step1MergeDetect';
import { LibriVoxCatalog, normalizeBook, plainText, safeFetch, searchParams, trustedUrl } from './librivox-catalog';
import { downloadLibriVox, importedMetadata, mergeImportMetadata, mountLibriVox } from './librivox-import';
import { inspect, makePreview } from './audio-engine';
import { prepareMaster } from './source-audio';
import type { AudiobookJob } from '../src/types';

export const fixtureBook = {
  id: '52', title: 'Letters &amp; Two Brides', authors: [{ first_name: 'Honoré de', last_name: 'Balzac' }],
  description: '<p>A story with <b>many readers</b>.</p>', language: 'English', num_sections: '2', totaltime: '0:00:02',
  genres: [{ name: 'Epistolary Fiction' }], url_librivox: 'https://librivox.org/letters-of-two-brides/',
  coverart_jpg: 'https://archive.org/download/cover.jpg', sections: [
    { id: '12', section_number: '2', title: 'Second', listen_url: 'https://archive.org/download/book/two.mp3', playtime: '1', readers: [{ display_name: 'Reader B' }, { display_name: 'Reader A' }] },
    { id: '11', section_number: '1', title: 'First', listen_url: 'http://archive.org/download/book/one.mp3', playtime: '1', readers: [{ display_name: 'Reader A' }] },
  ],
};
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const probe = () => ({ durationSeconds: 1, bitrate: 64, format: 'mp3', codec: 'mp3', sampleRate: 44100, channels: 1 });
const temp = () => fs.mkdtempSync(path.resolve('.cache/librivox-test-'));
const mock = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => fn as typeof fetch;

test('LibriVox tab renders alongside folder and YouTube without external service availability', () => {
  for (const inputMethod of ['folder', 'youtube', 'librivox'] as const) {
    const job = { id: 'render', name: 'Test', inputMethod, parts: [], chapters: [], candidates: [], logs: [] } as unknown as AudiobookJob;
    const markup = renderToStaticMarkup(React.createElement(DependencyStatusProvider, null, React.createElement(Step1MergeDetect, {
      job, config: { faster_transcription: true, whisper_profile: 'turbo', lead_in_seconds: 1.5, m4b_settings: { bitrate_stereo: '96k', bitrate_mono: '64k', sample_rate: 44100 } } as any,
      isRunning: false, onRunStep1: async () => {}, onRerunStep: async () => {}, onNextStep: () => {},
    })));
    for (const name of ['Audio Folder', 'From YouTube', 'LibriVox']) assert.ok(markup.includes(name));
    if (inputMethod === 'librivox') { assert.match(markup, /aria-label="LibriVox search"/); assert.match(markup, /<option value="title" selected="">Title/); }
    if (inputMethod === 'folder') assert.match(markup, /btn-import-mp3-folder/);
    if (inputMethod === 'youtube') assert.match(markup, /youtube-url-input/);
  }
});

test('catalog normalizes Unicode, missing fields, ordered multi-reader sections and safe text/URLs', () => {
  const book = normalizeBook(fixtureBook)!;
  assert.equal(book.title, 'Letters & Two Brides'); assert.equal(book.authors[0], 'Honoré de Balzac');
  assert.deepEqual(book.sections.map(s => s.title), ['First', 'Second']);
  assert.match(book.sections[0].url!, /^https:/); assert.match(book.sections[0].originalUrl!, /^http:/);
  assert.deepEqual(importedMetadata(book).narrator, 'Reader A; Reader B');
  assert.equal(book.description, 'A story with many readers .');
  assert.equal(plainText('<script>alert(1)</script> &lt;b&gt; &#x1F408;'), 'alert(1) <b> 🐈');
  assert.equal(normalizeBook({ id: '1', title: 'Minimal' })?.coverUrl, undefined);
  const multiAuthor = normalizeBook({ ...fixtureBook, authors: [...fixtureBook.authors, { first_name: 'Another', last_name: 'Author' }] })!;
  assert.equal(importedMetadata(multiAuthor).author, 'Honoré de Balzac; Another Author');
  const solo = normalizeBook({ ...fixtureBook, num_sections: '1', sections: [fixtureBook.sections[1]] })!;
  assert.equal(importedMetadata(solo).narrator, 'Reader A');
  assert.equal(normalizeBook({ id: 'not-an-id', title: 'Bad' }), null);
  for (const url of ['file:///x', 'http://127.0.0.1/x', 'https://archive.org.evil.test/x', 'https://user@archive.org/x', 'https://archive.org:123/x']) assert.equal(trustedUrl(url), undefined);
  assert.throws(() => searchParams('title', '', 1)); assert.throws(() => searchParams('title', 'book', -1));
});

test('search sends official title/author/genre filters, 20-item pages, shared spacing and cached requests', async () => {
  const urls: URL[] = []; const starts: number[] = []; let now = 1000;
  const client = new LibriVoxCatalog(mock(url => { urls.push(new URL(url)); starts.push(now); return response({ books: Array.from({ length: 20 }, (_, i) => ({ ...fixtureBook, id: String(i + 1) })) }); }), async ms => { now += ms; }, () => now);
  const [a, b] = await Promise.all([client.search('title', 'Letters'), client.search('title', 'Letters')]);
  assert.deepEqual(a, b); assert.equal(urls.length, 1); assert.equal(a.hasNext, true);
  await client.search('title', 'Letters', 2); await client.search('author', 'Balzac'); await client.search('genre', 'Fiction');
  assert.deepEqual(starts, [1000, 4000, 7000, 10000]);
  assert.equal(urls[1].searchParams.get('offset'), '20'); assert.equal(urls[1].searchParams.get('limit'), '20');
  assert.equal(urls[0].searchParams.get('title'), '^Letters');
  assert.equal(urls[2].searchParams.get('author'), '^Balzac'); assert.equal(urls[3].searchParams.get('genre'), '^Fiction');
  assert.ok(urls.every(u => u.pathname === '/api/feed/audiobooks/' && u.searchParams.get('format') === 'json'));
});

test('no matches, skipped records, malformed response, service/network errors and rate-limit cooldown', async () => {
  const client = (fn: typeof fetch) => new LibriVoxCatalog(fn, async () => {}, () => 0, 0);
  assert.deepEqual((await client(mock(() => response({ error: 'Audiobooks could not be found' }, 404))).search('title', 'nothing')).books, []);
  const result = await client(mock(() => response({ books: [{ id: 'bad' }, fixtureBook] }))).search('title', 'x');
  assert.equal(result.skipped, 1); assert.equal(result.hasNext, false);
  for (const fn of [mock(() => new Response('{bad')), mock(() => response({}, 503)), mock(() => { throw new Error('Network unavailable'); })]) {
    let attempts = 0;
    await assert.rejects(client(mock((u, i) => { attempts++; return fn(u, i); })).search('title', 'x'), /could not be reached/);
    assert.equal(attempts, 2);
  }
  await assert.rejects(client(mock(() => response({ unexpected: [] }))).search('title', 'x'), /invalid book list/);
  let count = 0;
  const limited = client(mock(() => { count++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); }));
  await assert.rejects(limited.search('title', 'x'), (e: any) => e.status === 429 && e.retryAfter === 60);
  await assert.rejects(limited.search('title', 'y'), (e: any) => e.status === 429);
  assert.equal(count, 1);
});

test('detail uses extended data, fetching selected-project tracks only when necessary', async () => {
  const urls: URL[] = [];
  const client = new LibriVoxCatalog(mock(url => {
    const parsed = new URL(url); urls.push(parsed);
    return parsed.pathname.endsWith('/audiotracks/') ? response({ sections: fixtureBook.sections }) : response({ books: [{ ...fixtureBook, sections: [fixtureBook.sections[1]] }] });
  }), async () => {}, () => 0, 0);
  const book = await client.detail('52');
  assert.equal(book.sections.length, 2); assert.equal(urls[0].searchParams.get('extended'), '1');
  assert.equal(urls[1].searchParams.get('project_id'), '52'); assert.equal(urls.length, 2);
  assert.equal(book.sections[0].readers[0], 'Reader A');
  await client.detail('52'); assert.equal(urls.length, 2);
});

test('redirects are checked before making another network request', async () => {
  let calls = 0;
  await assert.rejects(safeFetch('https://archive.org/download/book.mp3', {}, mock(() => { calls++; return new Response(null, { status: 302, headers: { Location: 'http://localhost/private' } }); })), /untrusted/);
  assert.equal(calls, 1);
});

test('section download preserves order/provenance and removes only its own incomplete directory', async () => {
  const root = temp(); fs.writeFileSync(path.join(root, 'keep.txt'), 'user data');
  try {
    const book = normalizeBook(fixtureBook)!; const requests: string[] = []; const updates: any[] = [];
    const result = await downloadLibriVox(book, root, new AbortController().signal, p => updates.push(p), probe, mock(url => { requests.push(url); return new Response('audio'); }));
    assert.deepEqual(requests, book.sections.map(s => s.url)); assert.deepEqual(result.files.map(f => f.fileName), ['00001-section.mp3', '00002-section.mp3']);
    assert.deepEqual(result.sections.map(s => [s.startSeconds, s.endSeconds]), [[0, 1], [1, 2]]); assert.equal(updates.at(-1).bytes, 10);
    const before = fs.readdirSync(root);
    let count = 0;
    await assert.rejects(downloadLibriVox(book, root, new AbortController().signal, () => {}, probe, mock(() => ++count === 1 ? new Response('audio') : new Response('', { status: 503 }))), /download failed/);
    assert.deepEqual(fs.readdirSync(root), before);
    const controller = new AbortController();
    await assert.rejects(downloadLibriVox(book, root, controller.signal, p => { if (p.bytes) controller.abort(); }, probe, mock(() => new Response('audio'))));
    assert.deepEqual(fs.readdirSync(root), before);
    await assert.rejects(downloadLibriVox(book, root, new AbortController().signal, () => {}, probe, mock(() => new Response('short', { headers: { 'content-length': '100' } }))), /Incomplete/);
    await assert.rejects(downloadLibriVox({ ...book, sections: [{ ...book.sections[0], url: undefined }] }, root, new AbortController().signal, () => {}, probe), /incomplete/);
    assert.deepEqual(fs.readdirSync(root), before); assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'user data');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('metadata fills blanks, preserves drafts and retains all readers unless replacement is explicit', () => {
  const incoming = importedMetadata(normalizeBook(fixtureBook)!);
  const existing: any = { title: 'My title', author: 'My author', language: 'deu', narrator: '', description: 'My notes', genres: ['My genre'], cover: { source: 'url', url: 'mine' } };
  const filled = mergeImportMetadata(existing, incoming, false);
  assert.equal(filled.title, 'My title'); assert.equal(filled.description, 'My notes'); assert.deepEqual(filled.genres, ['My genre']);
  assert.equal(filled.narrator, 'Reader A; Reader B'); assert.equal(filled.cover?.url, 'mine');
  assert.equal(mergeImportMetadata(existing, incoming, true).title, 'Letters & Two Brides'); assert.equal(existing.narrator, '');
});

test('HTTP import commits normal pipeline inputs, reports failures, cancellation and save rollback', async () => {
  const root = temp(); const jobs = [{ id: 'test', name: 'Existing project', parts: [], chapters: [{ title: 'Old' }], logs: [], metadata: { title: 'Manual title' } }] as unknown as AudiobookJob[];
  let failSave = false, saved = 0, failMedia = false;
  const locks = new Set<string>(); const app = express(); app.use(express.json());
  let finishCatalog: (() => void) | undefined;
  const catalog = new LibriVoxCatalog(mock(url => new URL(url).searchParams.get('id') === '53'
    ? new Promise<Response>(resolve => { finishCatalog = () => resolve(response({ books: [{ ...fixtureBook, id: '53' }] })); })
    : response({ books: [fixtureBook] })), async () => {}, () => 0, 0);
  mountLibriVox(app, { jobs, root, locks, busy: () => false, probe, catalog, requireImport: (_: any, __: any, next: any) => next(),
    save: () => { if (failSave) throw new Error('Disk full'); saved++; },
    request: mock(async () => { await new Promise(r => setTimeout(r, 20)); return new Response('audio', { status: failMedia ? 503 : 200 }); }),
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + (server.address() as any).port + '/api/librivox';
  const post = (route: string, body: any = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const finished = async () => {
    for (let i = 0; i < 200; i++) { const state = await (await fetch(base + '/import/test')).json(); if (state.status !== 'downloading') return state; await new Promise(r => setTimeout(r, 10)); }
    throw new Error('Import did not finish');
  };
  try {
    assert.equal((await post('/import/missing', { projectId: '52' })).status, 404);
    assert.equal((await post('/import/test', { projectId: '../' })).status, 400);
    assert.equal((await post('/import/test', { projectId: '52' })).status, 200);
    assert.equal((await post('/import/test', { projectId: '52' })).status, 409);
    assert.equal((await finished()).status, 'completed'); assert.equal(saved, 1); assert.equal(locks.size, 0);
    const job = jobs[0]; assert.equal(job.inputMethod, 'librivox'); assert.equal(job.chapterSource, 'whisperx');
    assert.equal(job.parts.length, 2); assert.deepEqual(job.chapters, []); assert.equal(job.metadata?.title, 'Manual title');
    assert.equal(job.librivox?.sections[1].title, 'Second'); assert.equal(job.sourceSummary?.totalFiles, 2);
    const prior = JSON.stringify(job), directories = fs.readdirSync(root);
    assert.equal((await post('/import/test', { projectId: '52' })).status, 409);
    await post('/import/test', { projectId: '52', confirmReplaceSource: true }); await post('/import/test/cancel');
    assert.equal((await finished()).status, 'cancelled'); assert.equal(JSON.stringify(job), prior); assert.deepEqual(fs.readdirSync(root), directories);
    failSave = true;
    await post('/import/test', { projectId: '52', confirmReplaceSource: true });
    assert.equal((await finished()).error, 'Disk full'); assert.equal(JSON.stringify(job), prior); assert.deepEqual(fs.readdirSync(root), directories);
    failSave = false; failMedia = true;
    await post('/import/test', { projectId: '52', confirmReplaceSource: true }); assert.equal((await finished()).status, 'error');
    assert.equal(JSON.stringify(job), prior); assert.deepEqual(fs.readdirSync(root), directories);
    // Cancelling must not wait for the shared, read-only catalog request.
    failMedia = false;
    await post('/import/test', { projectId: '53', confirmReplaceSource: true });
    await post('/import/test/cancel');
    assert.equal((await finished()).status, 'cancelled'); assert.equal(locks.size, 0);
    assert.ok(finishCatalog); finishCatalog();
    assert.equal(JSON.stringify(job), prior); assert.deepEqual(fs.readdirSync(root), directories);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); fs.rmSync(root, { recursive: true, force: true }); }
});

test('downloaded section files feed the existing PCM preparation and preview pipeline', async () => {
  const root = temp(); const ff = process.env.TEST_FFMPEG || 'ffmpeg', fp = process.env.TEST_FFPROBE || 'ffprobe';
  try {
    const audio = path.join(root, 'source.mp3');
    execFileSync(ff, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=0.5', audio], { windowsHide: true });
    const imported = await downloadLibriVox(normalizeBook(fixtureBook)!, path.join(root, 'imports'), new AbortController().signal, () => {}, file => inspect(fp, file), mock(() => new Response(fs.readFileSync(audio))));
    const prepared = await prepareMaster(ff, fp, imported.files.map(f => path.join(imported.directory, f.fileName)), path.join(root, 'intermediates'), 'standard');
    assert.ok(Math.abs(inspect(fp, prepared.master).durationSeconds - 1) < 0.1);
    const preview = path.join(root, 'preview.wav'); await makePreview(ff, prepared.master, preview);
    assert.ok(inspect(fp, preview).durationSeconds > 0.9);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
