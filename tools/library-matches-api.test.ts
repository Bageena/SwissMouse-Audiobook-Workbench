import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';

test('Inbox review confirms exact files, keeps alternate narration, and persists logical merge', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-matches-'));
  const inbox = path.join(root, 'Inbox'), library = path.join(root, 'Library');
  fs.mkdirSync(inbox); fs.mkdirSync(library);
  for (const [folder, narrator, bytes, extension] of [['A', 'Reader', 'same bytes', 'mp3'], ['B', 'Reader', 'same bytes', 'mp3'], ['C', 'Another Reader', 'other bytes', 'm4b']]) {
    const target = path.join(inbox, folder); fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, `audio.${extension}`), bytes);
    fs.writeFileSync(path.join(target, 'metadata.json'), JSON.stringify({ title: folder === 'B' ? 'Wrong Album Tag' : 'The Book', author: 'Writer', narrator }));
  }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ inbox_folder: inbox, library_folder: library, library_template: '%Book Title%' }));
  const port = 48000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.resolve('dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, NODE_ENV: 'production', PORT: String(port) }, stdio: 'ignore', windowsHide: true });
  const request = async (route: string, body?: object) => {
    const response = await fetch(base + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const data = await response.json(); assert.equal(response.status, 200, `${route}: ${JSON.stringify(data)}`); return data;
  };
  try {
    for (let i = 0; i < 100; i++) {
      try { if (!(await request('/api/library/scan-status')).scanning) break; } catch { /* Boot. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const books = await request('/api/library');
    assert.equal(books.length, 3);
    const a = books.find((book: any) => book.representations[0].path.endsWith('A'));
    const b = books.find((book: any) => book.representations[0].path.endsWith('B'));
    const c = books.find((book: any) => book.representations[0].path.endsWith('C'));
    assert.deepEqual(a.formats, ['MP3']); assert.deepEqual(c.formats, ['M4B']);
    const initial = await request('/api/library/matches');
    assert.equal(initial.length, 2);
    assert.equal(initial.find((match: any) => [match.a, match.b].includes(a.id) && [match.a, match.b].includes(b.id)).kind, 'uncertain');
    assert.equal(initial.find((match: any) => [match.a, match.b].includes(c.id) && [match.a, match.b].includes(a.id)).kind, 'book');
    const comparison = await request('/api/library/matches/compare', { a: a.id, b: b.id });
    assert.equal(comparison.exact, true);
    assert.match(comparison.evidence, /SHA-256/);
    assert.equal((await request('/api/library/matches')).find((match: any) => [match.a, match.b].includes(a.id) && [match.a, match.b].includes(b.id)).kind, 'audio');
    await request('/api/library/matches/decision', { a: a.id, b: b.id, decision: 'merge' });
    const merged = await request('/api/library');
    assert.equal(merged.length, 2);
    assert.equal(merged.find((book: any) => book.id === a.id).representations.length, 2);
    assert.ok(fs.existsSync(path.join(inbox, 'A', 'audio.mp3')) && fs.existsSync(path.join(inbox, 'B', 'audio.mp3')));
    await request('/api/library/matches/decision', { a: a.id, b: c.id, decision: 'different' });
    assert.equal((await request('/api/library/matches')).some((match: any) => [match.a, match.b].includes(a.id) && [match.a, match.b].includes(c.id)), false);
    assert.equal((await request('/api/library/matches/reviewed')).find((item: any) => item.a === a.id && item.b === c.id).decision, 'different');
    await request('/api/library/matches/reopen', { a: a.id, b: c.id });
    assert.equal((await request('/api/library/matches')).some((match: any) => [match.a, match.b].includes(a.id) && [match.a, match.b].includes(c.id)), true);
    await request('/api/library/matches/decision', { a: a.id, b: c.id, decision: 'different' });
    assert.equal((await request('/api/library/refresh', {})).books.length, 2);
    assert.equal((await request('/api/library')).find((book: any) => book.id === a.id).representations.length, 2);
    fs.renameSync(path.join(inbox, 'B'), path.join(library, 'B'));
    const relocated = (await request('/api/library/refresh', {})).books.find((book: any) => book.id === a.id);
    assert.deepEqual(relocated.rootTypes.sort(), ['inbox', 'library']);
    assert.equal(relocated.representations.length, 2);
  } finally {
    if (server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MP3 and M4B encodes of one recording become a likely audio match only after comparison', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-cross-format-'));
  const inbox = path.join(root, 'Inbox'), library = path.join(root, 'Library');
  fs.mkdirSync(inbox); fs.mkdirSync(library);
  const ffmpeg = process.env.TEST_FFMPEG || path.resolve('runtime', 'bin', 'ffmpeg' + (process.platform === 'win32' ? '.exe' : ''));
  const ffprobe = process.env.TEST_FFPROBE || path.resolve('runtime', 'bin', 'ffprobe' + (process.platform === 'win32' ? '.exe' : ''));
  const wav = path.join(root, 'source.wav');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=sin(2*PI*440*t)*(0.1+0.08*sin(2*PI*0.17*t)):s=16000:d=100', '-c:a', 'pcm_s16le', wav], { windowsHide: true });
  for (const [folder, codec, extension] of [['MP3', 'libmp3lame', 'mp3'], ['M4B', 'aac', 'm4b']]) {
    const target = path.join(inbox, folder); fs.mkdirSync(target);
    execFileSync(ffmpeg, ['-v', 'error', '-i', wav, '-c:a', codec, path.join(target, `audio.${extension}`)], { windowsHide: true });
    fs.writeFileSync(path.join(target, 'metadata.json'), JSON.stringify({ title: 'Shared Recording', author: 'Writer', narrator: 'Reader' }));
  }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ inbox_folder: inbox, library_folder: library, ffmpeg_path: ffmpeg, ffprobe_path: ffprobe }));
  const port = 49000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.resolve('dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, NODE_ENV: 'production', PORT: String(port) }, stdio: 'ignore', windowsHide: true });
  const request = async (route: string, body?: object) => {
    const response = await fetch(base + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const data = await response.json(); assert.equal(response.status, 200, `${route}: ${JSON.stringify(data)}`); return data;
  };
  try {
    for (let i = 0; i < 100; i++) {
      try { if (!(await request('/api/library/scan-status')).scanning) break; } catch { /* Boot. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const books = await request('/api/library'); assert.equal(books.length, 2);
    const match = (await request('/api/library/matches'))[0]; assert.equal(match.kind, 'book');
    const compared = await request('/api/library/matches/compare', { a: match.a, b: match.b });
    assert.equal(compared.exact, false);
    assert.ok(compared.confidence >= .94, compared.evidence);
    assert.equal((await request('/api/library/matches'))[0].kind, 'audio');
    await request('/api/library/matches/decision', { a: match.a, b: match.b, decision: 'merge' });
    const merged = await request('/api/library'); assert.equal(merged.length, 1);
    assert.deepEqual(merged[0].formats, ['M4B', 'MP3']);
    assert.equal(merged[0].representations.length, 2);
  } finally {
    if (server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
