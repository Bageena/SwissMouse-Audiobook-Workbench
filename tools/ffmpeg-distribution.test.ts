// Copyright (C) 2026 SwissMouse contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { installFfmpegDistribution } from './ffmpeg-distribution';

const digest = 'a'.repeat(64);
function runtime(t: TestContext) {
  fs.mkdirSync('.cache', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.cache/ffmpeg-notices-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function archive() {
  const zip = new AdmZip();
  zip.addFile('provider-build/bin/ffmpeg.exe', Buffer.from('ffmpeg fixture'));
  zip.addFile('provider-build/bin/ffprobe.exe', Buffer.from('ffprobe fixture'));
  zip.addFile('provider-build/bin/ffplay.exe', Buffer.from('unused fixture'));
  zip.addFile('provider-build/COPYING', Buffer.from('Upstream build-specific terms\r\n'));
  return zip;
}

test('retains upstream notices, nested licenses and documentation byte-for-byte through ZIP roundtrip', t => {
  const root = runtime(t), zip = archive();
  const content = new Map([
    ['provider-build/licenses/component/COPYRIGHT', Buffer.from([0xef, 0xbb, 0xbf, 65, 13, 10])],
    ['provider-build/NOTICE.md', Buffer.from('Independent third-party notices\r\n')],
    ['provider-build/doc/legal.html', Buffer.from('<p>Build-specific license details</p>')],
    ['provider-build/bin/LICENSE.txt', Buffer.from('License beside binaries')],
    ['provider-build/README.txt', Buffer.from('Provider instructions')],
  ]);
  for (const [name, data] of content) zip.addFile(name, data);
  const entries = new AdmZip(zip.toBuffer()).getEntries();
  const result = installFfmpegDistribution(entries, root, digest);
  assert.equal(result.preservedFiles, 6);
  for (const entry of entries.filter(entry => !entry.isDirectory && !entry.entryName.endsWith('.exe'))) {
    assert.deepEqual(fs.readFileSync(path.join(result.noticesDirectory, entry.entryName)), entry.getData());
  }
  assert.equal(fs.readFileSync(path.join(root, 'bin/ffmpeg.exe'), 'utf8'), 'ffmpeg fixture');
  assert.equal(fs.readFileSync(path.join(root, 'bin/ffprobe.exe'), 'utf8'), 'ffprobe fixture');
  assert.ok(!fs.existsSync(path.join(root, 'bin/ffplay.exe')));
  zip.addFile('provider-build/COPYING', Buffer.from('Different build: upstream LGPL terms\r\n'));
  const next = installFfmpegDistribution(new AdmZip(zip.toBuffer()).getEntries(), root, 'b'.repeat(64));
  assert.notEqual(next.noticesDirectory, result.noticesDirectory);
  assert.equal(fs.readFileSync(path.join(result.noticesDirectory, 'provider-build/COPYING'), 'utf8'), 'Upstream build-specific terms\r\n');
  assert.equal(fs.readFileSync(path.join(next.noticesDirectory, 'provider-build/COPYING'), 'utf8'), 'Different build: upstream LGPL terms\r\n');
});

test('refuses incomplete or companion-free archives before replacing existing binaries', t => {
  const root = runtime(t), entries = archive().getEntries();
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(path.join(root, 'bin/ffmpeg.exe'), 'existing');
  assert.throws(() => installFfmpegDistribution(entries.filter(e => !e.entryName.endsWith('ffprobe.exe')), root, digest), /both ffmpeg/);
  assert.throws(() => installFfmpegDistribution(entries.filter(e => e.entryName.endsWith('.exe')), root, digest), /no accompanying/);
  assert.equal(fs.readFileSync(path.join(root, 'bin/ffmpeg.exe'), 'utf8'), 'existing');
});

test('rejects unsafe archive paths, symlinks and Windows path collisions', t => {
  const root = runtime(t), entries = archive().getEntries();
  for (const name of ['../NOTICE', '/NOTICE', 'C:/NOTICE', 'doc\\NOTICE', 'doc/NOTICE:stream', 'doc/NUL.txt', 'doc/NOTICE.']) {
    const extra = { entryName: name, isDirectory: false, header: { attr: 0 }, getData: () => Buffer.from('bad') };
    assert.throws(() => installFfmpegDistribution([...entries, extra], root, digest), /Unsafe/);
  }
  const extra = { entryName: 'provider-build/copying', isDirectory: false, header: { attr: 0 }, getData: () => Buffer.from('bad') };
  assert.throws(() => installFfmpegDistribution([...entries, extra], root, digest), /Duplicate/);
  assert.throws(() => installFfmpegDistribution([...entries, { ...extra, entryName: 'doc/link', header: { attr: 0xa000 << 16 } }], root, digest), /Unsafe/);
  assert.ok(!fs.existsSync(path.join(root, 'bin')));
});

test('a failed companion write leaves existing FFmpeg untouched', t => {
  const root = runtime(t);
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(path.join(root, 'bin/ffmpeg.exe'), 'existing');
  fs.writeFileSync(path.join(root, 'licenses'), 'blocks notices directory');
  assert.throws(() => installFfmpegDistribution(archive().getEntries(), root, digest), /real directory/);
  assert.equal(fs.readFileSync(path.join(root, 'bin/ffmpeg.exe'), 'utf8'), 'existing');
});
