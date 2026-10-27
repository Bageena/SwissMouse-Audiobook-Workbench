import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { inspect, writeAudioMetadata } from './audio-engine';
import { stamp } from './library-filesystem';
import { audiobookTags } from './audiobook-metadata';
import { extendedMetadata } from '../src/utils/extendedMetadata';
import { preserveMp4Metadata } from './mp4-metadata';

test('completed project transfer shares both API entry points and preserves associations, copies and identities', async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), 'transfer-test-'));
  const external = process.env.TEST_CROSS_VOLUME === '1' ? fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-identity-')) : undefined;
  const inbox = path.join(external || root, 'Inbox'), library = path.join(root, 'Library');
  fs.mkdirSync(inbox); fs.mkdirSync(library);
  if (external) assert.notEqual(fs.statSync(inbox).dev, fs.statSync(library).dev, 'cross-volume test requires distinct filesystem devices');
  const tool = (name: string) => {
    const candidate = process.env[`TEST_${name.toUpperCase()}`] || path.resolve('runtime', 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
    return fs.existsSync(candidate) ? candidate : execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
  };
  const ffmpeg = tool('ffmpeg'), ffprobe = tool('ffprobe');
  const seed = path.join(root, 'seed.m4b'), chapters = path.join(root, 'chapters.txt');
  fs.writeFileSync(chapters, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=One\n');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-i', chapters, '-map_metadata', '1', '-map_chapters', '1', '-c:a', 'aac', seed], { windowsHide: true });
  const cover = fs.readFileSync(path.resolve('tools/fixtures/cover.png'));
  const records: any[] = [];
  const make = (id: string, folder: string, names: string[], sidecars: string[] = []) => {
    const source = path.join(inbox, folder); fs.mkdirSync(source, { recursive: true });
    for (const name of names) { fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true }); fs.copyFileSync(seed, path.join(source, name)); }
    const metadata = { title: id, author: 'Writer', series: 'Series', seriesSequence: '2', narrator: '', genres: [], tags: [], language: 'eng', abridged: false, explicit: false };
    const associatedFiles = sidecars.map(name => {
      const file = path.join(source, name);
      fs.writeFileSync(file, /\.(png|jpg)$/.test(name) ? cover : /\.json$/.test(name) ? JSON.stringify(metadata) : 'FILE "book.m4b" WAVE');
      return { path: file, kind: /\.(png|jpg)$/.test(name) ? 'cover' : /\.json$/.test(name) ? 'metadata' : 'chapters' };
    });
    const exportDir = path.join(inbox, '.swissmouse-work', id); fs.mkdirSync(exportDir, { recursive: true });
    const output = path.join(exportDir, `${id}.m4b`);
    const duration = names.length;
    const end = `00:00:${String(duration).padStart(2, '0')}.000`;
    const savedChapters = [{ id: 'c', title: 'One', start: '00:00:00.000', end }];
    const outputChapters = path.join(exportDir, 'chapters.ffmeta');
    fs.writeFileSync(outputChapters, `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=${duration * 1000}\ntitle=One\n`);
    const tags = audiobookTags(metadata, undefined, {}, 'm4b');
    const tagArgs = Object.entries(tags).flatMap(([key, value]) => ['-metadata', `${key}=${value}`]);
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`, '-i', outputChapters, '-map_metadata', '1', '-map_chapters', '1', '-c:a', 'aac', '-metadata:s:a:0', 'language=eng', ...tagArgs, output], { windowsHide: true });
    preserveMp4Metadata(undefined, output, tags, false);
    fs.writeFileSync(path.join(exportDir, 'exmetadata.json'), JSON.stringify(extendedMetadata(metadata, savedChapters, id)));
    const record = { id, name: id, createdAt: new Date().toISOString(), sourceMembership: 'confirmed', metadata, metadataDraft: { ...metadata, description: 'Keep draft' },
      source: { kind: 'inbox', mode: 'folder', path: source }, sourceFolderPath: source,
      parts: names.map((name, index) => ({ id: `p${index}`, name, order: index + 1, sizeBytes: fs.statSync(seed).size, durationSeconds: 1, bitrate: 64 })),
      associatedFiles, status: 'built', totalDurationSeconds: duration, totalSizeBytes: names.length * fs.statSync(seed).size,
      chapters: savedChapters, candidates: [], logs: [],
      outputM4b: { fullPath: output, filename: path.basename(output), format: 'm4b', sizeBytes: fs.statSync(output).size, duration, chaptersCount: 1, bitrate: '64k' },
      exports: [{ format: 'm4b', fullPath: output, status: 'success', progress: 100 }], exportedFiles: { m4b: output } };
    records.push(record); return record;
  };
  const rootBook = make('Root Book', '', ['Root Book Part 1.m4b', 'Root Book Part 2.m4b']);
  const single = make('Single', 'Single', ['book.m4b']);
  const multi = make('Book A', 'Shared', ['Book A Part 1.m4b', 'Book A Part 2.m4b'], ['Book A cover.jpg', 'Book A metadata.json', 'Book A.cue']);
  const other = make('Book B', 'Shared', ['Book B.m4b'], ['Book B cover.jpg']);
  const copy = make('Copy', 'Copy', ['book.m4b'], ['cover.jpg', 'metadata.json']);
  const failure = make('Failure', 'Failure', ['book.m4b'], ['metadata.json']);
  const unowned = path.join(multi.sourceFolderPath, 'notes.txt'); fs.writeFileSync(unowned, 'Unrelated');
  const hidden = path.join(multi.sourceFolderPath, '.hidden'); fs.writeFileSync(hidden, 'Hidden');
  const shared = path.join(multi.sourceFolderPath, 'shared.json'); fs.writeFileSync(shared, 'Shared');
  multi.associatedFiles.push({ path: shared, kind: 'metadata' }); other.associatedFiles.push({ path: shared, kind: 'metadata' });
  const signatures = copy.parts.map(part => fs.readFileSync(path.join(copy.sourceFolderPath, part.name)));
  fs.writeFileSync(path.join(root, 'jobs.json'), JSON.stringify(records));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ inbox_folder: inbox, library_folder: library, library_template: '%Author%/%Series%/%Series Number% %Book Title%', ffmpeg_path: ffmpeg, ffprobe_path: ffprobe }));
  const port = 48000 + Math.floor(Math.random() * 900), base = `http://127.0.0.1:${port}`;
  let server: ReturnType<typeof spawn> | undefined;
  const request = async (route: string, body?: object, status = 200) => {
    const response = await fetch(base + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const result = await response.json(); assert.equal(response.status, status, `${route}: ${JSON.stringify(result)}`); return result;
  };
  const start = async () => {
    server = spawn(process.execPath, [path.resolve(process.env.TEST_PACKAGE_ROOT || '.', 'dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, NODE_ENV: 'production', PORT: String(port) }, stdio: 'ignore', windowsHide: true });
    for (let n = 0; n < 150; n++) {
      try { if (!(await request('/api/library/scan-status')).scanning) return; } catch { /* Starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Fixture server did not start');
  };
  const stop = async () => { if (server && server.exitCode === null) { const done = new Promise(resolve => server!.once('exit', resolve)); server.kill(); await done; } };
  const identities = async () => {
    const page = await request('/api/catalog/library/query', { limit: 100 });
    return Promise.all(records.map(async record => {
      const book = page.items.find((item: any) => item.id === record.id);
      assert.ok(book, record.id);
      const relations = await request(`/api/resources/${book.recordingId}/relations`);
      // Associated files and exports may be added during finalization; source identities must remain.
      const files = await Promise.all(relations.items.filter((item: any) => item.kind === 'core.contains').map((item: any) => request(`/api/resources/${item.toId}`)));
      return { id: record.id, work: book.resourceId, recording: book.recordingId, files: files.map((item: any) => item.id).sort() };
    }));
  };
  const preserved = async (before: Awaited<ReturnType<typeof identities>>) => {
    const after = await identities();
    before.forEach((item, index) => {
      assert.equal(after[index].work, item.work); assert.equal(after[index].recording, item.recording);
      for (const file of item.files) assert.ok(after[index].files.includes(file), `preserved file ${file} in ${item.id}`);
    });
  };
  try {
    await start();
    const before = await identities();
    for (const job of records) {
      // Discovery can adopt a source cover. Prepare an actual finalized fixture
      // with that saved artwork and sidecar before asking Final Check to pass.
      const saved = await request(`/api/jobs/${job.id}`);
      const output = saved.outputM4b.fullPath;
      if (saved.metadata.cover?.url) {
        const artwork = path.join(saved.sourceFolderPath, 'cover.jpg');
        await writeAudioMetadata({ ffmpeg, ffprobe, file: output, format: 'm4b', tags: audiobookTags(saved.metadata, undefined, {}, 'm4b'), cover: artwork });
        fs.copyFileSync(artwork, path.join(path.dirname(output), 'cover.jpg'));
      }
      fs.writeFileSync(path.join(path.dirname(output), 'exmetadata.json'), JSON.stringify(extendedMetadata(saved.metadata, saved.chapters, saved.id)));
      const result = await request(`/api/jobs/${job.id}/validate`, {});
      assert.equal(result.validation.status, 'PASS', JSON.stringify(result.validation));
    }
    assert.ok((await request('/api/jobs/Root%20Book')).canMoveToLibrary);
    const preview = await request('/api/jobs/Root%20Book/move-to-library');
    assert.equal(preview.keptOverview, true);
    assert.ok(preview.kept.includes(path.join(inbox, 'Shared')), 'preview lists unrelated directories without enumerating all their contents');
    assert.ok(!preview.kept.includes(unowned), 'preview does not walk unrelated book folders');
    assert.ok(preview.files.includes(rootBook.outputM4b.fullPath), 'explicit output remains in the transfer plan');
    const rootMoved = await request('/api/jobs/Root%20Book/move-to-library', { mode: 'move' });
    assert.equal(rootMoved.job.outputM4b.fullPath, path.join(rootMoved.path, 'Root Book.m4b'));
    assert.equal(fs.existsSync(path.join(rootMoved.path, '.swissmouse-work')), false);
    assert.ok(fs.existsSync(inbox), 'moving loose multipart audio never deletes the Inbox root');
    for (const part of rootBook.parts) assert.equal(fs.existsSync(path.join(inbox, part.name)), false);
    const target = (id: string) => path.join(library, 'Writer', 'Series', `002 ${id}`);
    await request('/api/jobs/Single/move-to-library', {}, 400);
    const moved = await request('/api/jobs/Single/move-to-library', { mode: 'move' });
    assert.equal(moved.path, target('Single')); assert.ok(fs.existsSync(inbox)); assert.equal(fs.existsSync(single.sourceFolderPath), false);
    assert.equal(inspect(ffprobe, moved.job.outputM4b.fullPath).chapters.length, 1);
    assert.equal(moved.job.metadataDraft.description, 'Keep draft');
    // The Library Manager's previous route delegates to exactly the same service.
    const sharedMove = await request('/api/library/Book%20A/send-to-library', { mode: 'move' });
    for (const file of multi.parts.map(part => part.name).concat(['Book A cover.jpg', 'Book A metadata.json', 'Book A.cue'])) {
      assert.equal(fs.existsSync(path.join(multi.sourceFolderPath, file)), false, file);
      assert.ok(fs.existsSync(path.join(sharedMove.path, file)), file);
    }
    for (const file of ['Book B.m4b', 'Book B cover.jpg', 'notes.txt', '.hidden', 'shared.json']) assert.ok(fs.existsSync(path.join(other.sourceFolderPath, file)), file);
    assert.equal((await request('/api/jobs/Book%20B')).parts.length, 1);
    assert.equal((await request('/api/jobs/Book%20B')).sourceFolderPath, other.sourceFolderPath);
    assert.ok(sharedMove.books.some((book: any) => book.id === 'Book B' && book.rootType === 'inbox'));
    assert.ok(sharedMove.books.some((book: any) => book.id === 'Book A' && book.rootType === 'library'));
    const copied = await request('/api/jobs/Copy/move-to-library', { mode: 'copy' });
    assert.equal(copied.mode, 'copy'); assert.ok(fs.existsSync(copy.sourceFolderPath));
    assert.deepEqual(fs.readFileSync(path.join(copy.sourceFolderPath, 'book.m4b')), signatures[0]);
    assert.deepEqual(fs.readFileSync(path.join(copied.path, 'metadata.json')), fs.readFileSync(path.join(copy.sourceFolderPath, 'metadata.json')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(copied.path, 'exmetadata.json'), 'utf8')).metadata.title, copied.job.metadata.title);
    assert.deepEqual(fs.readFileSync(path.join(copied.path, 'cover.jpg')), fs.readFileSync(path.join(copy.sourceFolderPath, 'cover.jpg')));
    for (let n = 0; n < 2; n++) {
      const books = (await request('/api/library/refresh', {})).books;
      assert.equal(books.filter((book: any) => book.name === 'Copy').length, 1);
      assert.equal(books.find((book: any) => book.id === 'Copy').rootType, 'library');
    }
    const failureTarget = target('Failure'); fs.mkdirSync(failureTarget, { recursive: true }); fs.writeFileSync(path.join(failureTarget, 'keep.txt'), 'Keep');
    await request('/api/jobs/Failure/move-to-library', { mode: 'move' }, 409);
    assert.equal(fs.readFileSync(path.join(failureTarget, 'keep.txt'), 'utf8'), 'Keep');
    assert.ok(fs.existsSync(path.join(failure.sourceFolderPath, 'book.m4b')));
    fs.rmSync(failureTarget, { recursive: true });
    fs.unlinkSync(path.join(failure.sourceFolderPath, 'metadata.json'));
    const failed = await request('/api/jobs/Failure/move-to-library', { mode: 'move' }, 409);
    assert.match(failed.error, /metadata.json/); assert.ok(fs.existsSync(path.join(failure.sourceFolderPath, 'book.m4b')));
    assert.equal(fs.existsSync(failureTarget), false);
    await stop(); await start();
    await preserved(before);
    const afterRestart = await request('/api/library');
    assert.equal(afterRestart.filter((book: any) => book.name === 'Copy').length, 1);
    assert.equal(afterRestart.find((book: any) => book.id === 'Copy').rootType, 'library');
    await request('/api/library/rebuild', { sources: ['inbox'], confirmed: true });
    assert.equal((await request('/api/library')).filter((book: any) => book.name === 'Copy').length, 1);
    // Interrupted cleanup restores only its quarantined file and retains both copies.
    await stop();
    const original = path.join(copy.sourceFolderPath, 'book.m4b'), quarantine = path.join(copy.sourceFolderPath, '.swissmouse-abcd.moved');
    const originalStamp = await stamp(original); fs.renameSync(original, quarantine);
    fs.writeFileSync(path.join(root, 'library-move-interrupted.json'), JSON.stringify({ version: 2, id: copy.id, mode: 'move', source: copy.sourceFolderPath, target: copied.path,
      entries: [{ source: original, name: 'book.m4b', stamp: originalStamp }], pending: { source: original, quarantine } }));
    await start(); assert.ok(fs.existsSync(original)); assert.ok(fs.existsSync(path.join(copied.path, 'book.m4b'))); assert.equal(fs.existsSync(quarantine), false);
  } finally {
    await stop();
    assert.ok(root.startsWith(process.cwd() + path.sep)); fs.rmSync(root, { recursive: true, force: true });
    if (external) { assert.ok(external.startsWith(os.tmpdir() + path.sep)); fs.rmSync(external, { recursive: true, force: true }); }
  }
});
