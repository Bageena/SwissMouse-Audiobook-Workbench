import { readProjectState } from './project-store-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { LibraryMediaReader } from './library-media';
import { identifyBook, scanRoot } from './library-filesystem';

test('Inbox and Library discover embedded artwork, upgrade unchanged records and preserve cover edits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-embedded-covers-'));
  const inbox = path.join(root, 'Inbox'), library = path.join(root, 'Library');
  fs.mkdirSync(inbox); fs.mkdirSync(library);
  const tool = (name: string) => process.env['TEST_' + name.toUpperCase()] || path.resolve('runtime/bin', name + (process.platform === 'win32' ? '.exe' : ''));
  const ffmpeg = tool('ffmpeg'), ffprobe = tool('ffprobe');
  const png = path.join(root, 'red.png'), jpg = path.join(root, 'blue.jpg');
  const encode = (args: string[]) => execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-y', ...args], { windowsHide: true });
  const art = (color: string, target: string) => encode(['-f', 'lavfi', '-i', `color=c=${color}:s=64x64`, '-frames:v', '1', '-threads', '1', target]);
  art('red', png); art('blue', jpg);
  const audio = (file: string, image?: string) => encode(['-f', 'lavfi', '-i', 'sine=duration=0.3', ...(image ? ['-i', image] : []),
    '-map', '0:a:0', ...(image ? ['-map', '1:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic'] : []),
    '-c:a', file.endsWith('.mp3') ? 'libmp3lame' : file.endsWith('.flac') ? 'flac' : 'aac', '-metadata', 'album=Embedded title', '-metadata', 'artist=Writer', file]);
  const addBook = (parent: string, title: string, extension: string, image?: string) => {
    const folder = path.join(parent, title); fs.mkdirSync(folder);
    const file = path.join(folder, 'audio.' + extension); audio(file, image);
    fs.writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify({ title, author: 'Writer' }));
    return file;
  };
  const inboxFile = addBook(inbox, 'Inbox MP3', 'mp3', png);
  const libraryFile = addBook(library, 'Library M4B', 'm4b', jpg);
  addBook(library, 'Library FLAC', 'flac', png);
  const emptyFile = addBook(inbox, 'No artwork', 'mp3');
  const jobs = [];
  for (const [type, directory] of [['inbox', inbox], ['library', library]] as const) for (const disk of await scanRoot(directory, new Set(['mp3', 'm4b']))) {
    const metadata = (await identifyBook(disk, async () => ({}))).metadata;
    jobs.push({ id: metadata.title, name: metadata.title, metadata, metadataDraft: { ...metadata, description: 'Keep draft' },
      createdAt: new Date().toISOString(), status: 'draft', parts: disk.files.map((file, index) => ({ id: 'p' + index, name: file.name, sizeBytes: file.size, order: index + 1 })),
      source: { kind: type === 'inbox' ? 'inbox' : 'managed', mode: disk.mode, path: disk.path }, sourceFolderPath: disk.folder,
      chapters: [], candidates: [], logs: [], totalSizeBytes: 0, totalDurationSeconds: 0,
      libraryScan: { type, root: directory, path: disk.path, signature: disk.signature, identity: disk.identity, detectedMetadata: metadata,
        coverSignature: createHash('sha256').update('null').digest('hex') } });
  }
  fs.writeFileSync(path.join(root, 'jobs.json'), JSON.stringify(jobs));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ inbox_folder: inbox, library_folder: library, ffmpeg_path: ffmpeg, ffprobe_path: ffprobe }));
  const snapshots = new Map([inboxFile, libraryFile, emptyFile].map(file => [file, fs.readFileSync(file)]));
  const port = 56000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  let server: ReturnType<typeof spawn> | undefined;
  const request = async (route: string, body?: unknown) => {
    const response = await fetch(base + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  const getJob = (id: string) => request('/api/jobs/' + encodeURIComponent(id));
  const start = async () => {
    server = spawn(process.execPath, [path.resolve('dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, PORT: String(port), NODE_ENV: 'production' }, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 150; i++) { try { if (!(await request('/api/library/scan-status')).scanning) return; } catch { /* Startup. */ } await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Fixture server did not start');
  };
  const stop = async () => { if (server?.exitCode === null) { const exit = new Promise(resolve => server!.once('exit', resolve)); server.kill(); await exit; } };
  try {
    await start();
    const books = await request('/api/library'); assert.equal(books.length, 4);
    for (const [title, cover] of [['Inbox MP3', png], ['Library M4B', jpg], ['Library FLAC', png]]) {
      const book = books.find((book: any) => book.name === title); assert.ok(book.coverUrl, title);
      const response = await fetch(base + book.coverUrl); assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type')!, /^image\//);
      assert.ok((await response.arrayBuffer()).byteLength > 0, 'library thumbnail is served');
      const saved = await getJob(book.id); assert.equal(saved.libraryScan.coverScanVersion, 1);
      assert.ok(saved.libraryScan.durationSeconds >= .2 && saved.libraryScan.durationSeconds < .5, 'scan keeps the real single-file runtime for duplicate evidence');
      assert.ok(Buffer.from(saved.metadata.cover.url.split(',')[1], 'base64').equals(fs.readFileSync(cover)), 'full cover retains exact embedded bytes: ' + title);
      if (title !== 'Library FLAC') assert.equal(saved.metadataDraft.description, 'Keep draft');
    }
    assert.equal(books.find((book: any) => book.name === 'No artwork').coverUrl, undefined);
    const snapshot = JSON.stringify(readProjectState(root));
    await request('/api/library/refresh', {});
    assert.equal(JSON.stringify(readProjectState(root)), snapshot, 'unchanged scans reuse persisted cover observations');
    for (const [file, bytes] of snapshots) assert.deepEqual(fs.readFileSync(file), bytes, 'scanning is read-only');
    const custom = { source: 'upload', filename: 'chosen.png', url: 'data:image/png;base64,' + fs.readFileSync(png).toString('base64') };
    const libraryJob = await getJob('Library M4B');
    await request('/api/jobs/Library%20M4B/metadata', { metadata: { ...libraryJob.metadata, cover: custom } });
    const inboxJob = await getJob('Inbox MP3');
    await request('/api/jobs/Inbox%20MP3/metadata', { metadata: { ...inboxJob.metadata, cover: null } });
    await request('/api/library/rebuild', { sources: ['inbox', 'library'], confirmed: true });
    assert.deepEqual((await getJob('Library M4B')).metadata.cover, custom);
    assert.equal((await getJob('Inbox MP3')).metadata.cover, null, 'deliberately removed artwork stays removed');
    await stop(); await start();
    assert.deepEqual((await getJob('Library M4B')).metadata.cover, custom);
    assert.equal((await getJob('Inbox MP3')).metadata.cover, null);
    // Extraction preserves exact PNG/JPEG bytes; the media cache invalidates
    // artwork when the audio file at the same path changes.
    const reader = new LibraryMediaReader();
    const first = await reader.cover(ffmpeg, ffprobe, inboxFile);
    assert.equal(first?.url, custom.url);
    audio(inboxFile, jpg);
    const next = await reader.cover(ffmpeg, ffprobe, inboxFile);
    assert.equal(next?.url, 'data:image/jpeg;base64,' + fs.readFileSync(jpg).toString('base64'));
    assert.equal(await reader.cover(ffmpeg, ffprobe, emptyFile), undefined);
    // A folder cover takes precedence, and a multipart cover on the last part
    // is found when the first track has no artwork.
    const multipart = path.join(root, 'Multipart'); fs.mkdirSync(multipart);
    audio(path.join(multipart, '01.mp3')); audio(path.join(multipart, '02.mp3'), jpg);
    let disk = (await scanRoot(root, new Set(['mp3']), [inbox, library])).find(book => book.folder === multipart)!;
    const identify = () => identifyBook(disk, file => reader.tags(ffprobe, file), undefined, file => reader.cover(ffmpeg, ffprobe, file));
    assert.equal((await identify()).metadata.cover?.url, next?.url);
    fs.copyFileSync(png, path.join(multipart, 'cover.png'));
    disk = (await scanRoot(root, new Set(['mp3']), [inbox, library])).find(book => book.folder === multipart)!;
    assert.equal((await identify()).metadata.cover?.url, custom.url);
  } finally { await stop(); fs.rmSync(root, { recursive: true, force: true }); }
});
