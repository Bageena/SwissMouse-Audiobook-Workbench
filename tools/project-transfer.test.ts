import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { cleanTransferredFiles, recoverTransferCopies, transferProjectFiles, writeTransferJournal, type TransferJournal } from './project-transfer';
import { contentHash, pathKey, stamp, verifiedCopy } from './library-filesystem';

async function fixture(run: (f: { root: string; inbox: string; library: string; source: string }) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swissmouse-transfer-'));
  const inbox = path.join(root, 'Inbox'), library = path.join(root, 'Library'), source = path.join(inbox, 'Book');
  await fs.mkdir(source, { recursive: true }); await fs.mkdir(library);
  try { await run({ root, inbox, library, source }); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('file cleanup preserves other projects, unlisted and hidden files, and removes only empty descendants', async () => fixture(async ({ root, inbox, library, source }) => {
  const names = ['Disc 1/01.mp3', 'Disc 2/02.mp3', 'cover.jpg', 'metadata.json', 'chapters.cue', 'shared.json'];
  for (const name of [...names, 'Book B.mp3', '.hidden', 'notes.txt']) {
    await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true });
    await fs.writeFile(path.join(source, name), name);
  }
  const entries = await Promise.all(names.map(async name => ({ name, source: path.join(source, name), stamp: await stamp(path.join(source, name)) })));
  const target = path.join(library, 'Book');
  await verifiedCopy(library, target, entries, () => {});
  const journal = path.join(root, 'journal.json');
  const intent: TransferJournal = { version: 2, id: 'book', source, target, mode: 'move', entries };
  await writeTransferJournal(journal, intent);
  await cleanTransferredFiles({ journal, intent, entries, boundaries: [inbox, library], protectedFiles: new Set([pathKey(path.join(source, 'shared.json'))]), log: () => {} });
  assert.deepEqual((await fs.readdir(source)).sort(), ['.hidden', 'Book B.mp3', 'notes.txt', 'shared.json']);
  for (const name of names) assert.equal(await fs.readFile(path.join(target, name), 'utf8'), name);
  assert.ok(await fs.stat(inbox));
}));

test('genuinely empty book folders are removed, configured Inbox root is retained', async () => fixture(async ({ root, inbox, library, source }) => {
  const file = path.join(source, 'one.m4b'); await fs.writeFile(file, 'audio');
  const entries = [{ source: file, name: 'one.m4b', stamp: await stamp(file) }];
  const target = path.join(library, 'Book'); await verifiedCopy(library, target, entries, () => {});
  const intent: TransferJournal = { version: 2, id: 'book', source, target, mode: 'move', entries };
  await cleanTransferredFiles({ journal: path.join(root, 'journal'), intent, entries, boundaries: [inbox, library], protectedFiles: new Set(), log: () => {} });
  await assert.rejects(fs.stat(source), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(inbox), []);
}));

test('partial transfer, full disk, permission errors and missing files never remove originals', async t => fixture(async ({ library, source }) => {
  for (const name of ['book.m4b', 'metadata.json']) await fs.writeFile(path.join(source, name), name);
  const entries = await Promise.all(['book.m4b', 'metadata.json'].map(async name => ({ name, source: path.join(source, name), stamp: await stamp(path.join(source, name)) })));
  const copy = fs.copyFile;
  for (const code of ['ENOSPC', 'EACCES', 'ENOENT']) {
    const stub = t.mock.method(fs, 'copyFile', async (...args: Parameters<typeof fs.copyFile>) => {
      if (String(args[0]).endsWith('metadata.json')) throw Object.assign(new Error(`${code}: metadata.json`), { code });
      return copy(...args);
    });
    await assert.rejects(verifiedCopy(library, path.join(library, code), entries, () => {}), new RegExp(code));
    stub.mock.restore();
    for (const entry of entries) assert.equal(await fs.readFile(entry.source, 'utf8'), entry.name);
    assert.deepEqual(await fs.readdir(library), []);
  }
}));

test('destination damage or source changes stop cleanup before any original is removed', async () => fixture(async ({ root, inbox, library, source }) => {
  const entries = [];
  for (const name of ['book.m4b', 'metadata.json']) {
    const file = path.join(source, name); await fs.writeFile(file, name);
    entries.push({ source: file, name, stamp: await stamp(file) });
  }
  const target = path.join(library, 'Book'); await verifiedCopy(library, target, entries, () => {});
  const intent: TransferJournal = { version: 2, id: 'book', source, target, mode: 'move', entries };
  await fs.writeFile(path.join(target, 'metadata.json'), 'damaged');
  await assert.rejects(cleanTransferredFiles({ journal: path.join(root, 'journal'), intent, entries, boundaries: [inbox], protectedFiles: new Set(), log: () => {} }), /metadata.json/);
  for (const entry of entries) assert.equal(await fs.readFile(entry.source, 'utf8'), entry.name);
}));

test('a late destination collision belongs to its creator and is never rolled back', async () => fixture(async ({ root, library, source }) => {
  const file = path.join(source, 'book.m4b'); await fs.writeFile(file, 'audio');
  const entries = [{ source: file, name: 'book.m4b', stamp: await stamp(file) }];
  const target = path.join(library, 'Book'); let raced = false;
  await assert.rejects(transferProjectFiles({ root: library, journal: path.join(root, 'journal'),
    intent: { version: 2, id: 'book', source, target, mode: 'copy', entries }, boundaries: [], protectedFiles: new Set(),
    commit: () => { throw new Error('must not commit'); }, rollback: () => {}, log: message => {
      if (!raced && message.startsWith('Transferred')) { raced = true; requireCollision(); }
    } }), /EEXIST/);
  function requireCollision() { /* The callback is synchronous, like an external race. */
    fsSync.mkdirSync(target); fsSync.writeFileSync(path.join(target, 'unrelated.txt'), 'keep');
  }
  assert.equal(await fs.readFile(path.join(target, 'unrelated.txt'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(file, 'utf8'), 'audio');
}));

import fsSync from 'node:fs';
test('same-volume moves avoid copying audio while copies and shared originals stay independent', async t => fixture(async ({ root, inbox, library, source }) => {
  const copy = fs.copyFile, copiedSources: string[] = [];
  const stub = t.mock.method(fs, 'copyFile', async (...args: Parameters<typeof fs.copyFile>) => {
    copiedSources.push(String(args[0])); return copy(...args);
  });
  for (const mode of ['move', 'copy', 'shared'] as const) {
    await fs.mkdir(source, { recursive: true });
    const file = path.join(source, mode + '.m4b'); await fs.writeFile(file, 'unchanged audio ' + mode);
    const before = await stamp(file), target = path.join(library, mode);
    const result = await transferProjectFiles({ root: library, journal: path.join(root, mode + '.json'),
      intent: { version: 2, id: mode, source, target, mode: mode === 'copy' ? 'copy' : 'move', entries: [{ source: file, name: 'book.m4b', stamp: before }] },
      boundaries: [inbox], protectedFiles: new Set(mode === 'shared' ? [pathKey(file)] : []),
      commit: () => {}, rollback: () => {}, log: () => {} });
    assert.equal(result, undefined);
    const destination = path.join(target, 'book.m4b');
    assert.equal(await fs.readFile(destination, 'utf8'), 'unchanged audio ' + mode);
    if (mode === 'move') {
      assert.equal((await stamp(destination)).identity, before.identity);
      assert.ok(!copiedSources.includes(file));
      await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    } else {
      assert.notEqual((await stamp(destination)).identity, before.identity);
      await fs.writeFile(file, 'changed original');
      assert.equal(await fs.readFile(destination, 'utf8'), 'unchanged audio ' + mode);
    }
  }
  stub.mock.restore();
}));

test('cross-volume move fallback copies and verifies before cleanup', async t => fixture(async ({ root, inbox, library, source }) => {
  const file = path.join(source, 'book.m4b'); await fs.writeFile(file, 'original audio');
  const link = fs.link;
  t.mock.method(fs, 'link', async (from, to) => {
    if (String(from) === file) throw Object.assign(new Error('cross device'), { code: 'EXDEV' });
    return link(from, to);
  });
  const target = path.join(library, 'Book');
  await transferProjectFiles({ root: library, journal: path.join(root, 'journal'),
    intent: { version: 2, id: 'book', source, target, mode: 'move', entries: [{ source: file, name: 'book.m4b', stamp: await stamp(file) }] },
    boundaries: [inbox], protectedFiles: new Set(), commit: () => {}, rollback: () => {}, log: () => {} });
  assert.equal(await fs.readFile(path.join(target, 'book.m4b'), 'utf8'), 'original audio');
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
}));

test('publication never overwrites a file created after the destination folder was reserved', async () => fixture(async ({ library, source }) => {
  const file = path.join(source, 'book.m4b'); await fs.writeFile(file, 'source audio');
  const target = path.join(library, 'Book');
  await assert.rejects(verifiedCopy(library, target, [{ source: file, name: 'book.m4b', stamp: await stamp(file) }], () => {}, () => {
    fsSync.writeFileSync(path.join(target, 'book.m4b'), 'late unrelated audio');
  }), /EEXIST/);
  assert.equal(await fs.readFile(path.join(target, 'book.m4b'), 'utf8'), 'late unrelated audio');
  assert.equal(await fs.readFile(file, 'utf8'), 'source audio');
}));

test('interrupted-transfer recovery moves only unchanged published files', async () => fixture(async ({ library, source }) => {
  const entries = [];
  for (const name of ['book.m4b', 'metadata.json']) {
    const file = path.join(source, name); await fs.writeFile(file, name);
    entries.push({ source: file, name, stamp: await stamp(file) });
  }
  const target = path.join(library, 'Book');
  const copied = await verifiedCopy(library, target, entries, () => {});
  await fs.writeFile(path.join(target, 'new.txt'), 'unrelated');
  await fs.writeFile(path.join(target, 'metadata.json'), 'changed by another app');
  const recovery = await recoverTransferCopies(target, copied);
  assert.ok(recovery);
  assert.equal(await fs.readFile(path.join(recovery, 'book.m4b'), 'utf8'), 'book.m4b');
  assert.deepEqual((await fs.readdir(target)).sort(), ['metadata.json', 'new.txt']);
  assert.equal(await fs.readFile(path.join(target, 'metadata.json'), 'utf8'), 'changed by another app');
  for (const entry of entries) assert.equal(await fs.readFile(entry.source, 'utf8'), entry.name);
}));

test('a failed persistence commit rolls back only published files, preserving late additions', async () => fixture(async ({ root, library, source }) => {
  const file = path.join(source, 'book.m4b'); await fs.writeFile(file, 'audio');
  const entries = [{ source: file, name: 'book.m4b', stamp: await stamp(file) }], target = path.join(library, 'Book');
  await assert.rejects(transferProjectFiles({ root: library, journal: path.join(root, 'journal'),
    intent: { version: 2, id: 'book', source, target, mode: 'move', entries }, boundaries: [], protectedFiles: new Set(), log: () => {}, rollback: () => {},
    commit: async () => { await fs.writeFile(path.join(target, 'new.txt'), 'keep'); throw new Error('store failed'); }
  }), /store failed/);
  assert.deepEqual(await fs.readdir(target), ['new.txt']); assert.equal(await fs.readFile(file, 'utf8'), 'audio');
}));


test('finishing into an owned export preserves resident audio and cleans only verified incoming originals', async () => fixture(async ({ root, inbox, library, source }) => {
  const target = path.join(library, 'Book'); await fs.mkdir(target);
  const resident = path.join(target, 'book.m4b'), incoming = path.join(source, 'metadata.json');
  await fs.writeFile(resident, 'verified export'); await fs.writeFile(incoming, 'legacy metadata');
  const residentStamp = await stamp(resident, 'book.m4b');
  const entries = [{ source: resident, name: 'book.m4b', stamp: residentStamp }, { source: incoming, name: 'metadata.json', stamp: await stamp(incoming) }];
  let committed = false;
  await transferProjectFiles({ root: library, journal: path.join(root, 'move.json'),
    intent: { version: 2, id: 'book', source, target, mode: 'move', entries },
    existingTarget: [{ name: 'book.m4b', stamp: residentStamp, hash: await contentHash(resident) }],
    boundaries: [inbox], protectedFiles: new Set(), commit: () => { committed = true; }, rollback: () => {}, log: () => {} });
  assert.equal(committed, true);
  assert.equal((await stamp(resident)).identity, residentStamp.identity);
  assert.equal(await fs.readFile(resident, 'utf8'), 'verified export');
  assert.equal(await fs.readFile(path.join(target, 'metadata.json'), 'utf8'), 'legacy metadata');
  await assert.rejects(fs.stat(incoming), { code: 'ENOENT' });
}));

test('owned-target finishing rejects unrelated additions and changed export bytes', async () => fixture(async ({ root, inbox, library, source }) => {
  const target = path.join(library, 'Book'); await fs.mkdir(target);
  const resident = path.join(target, 'book.m4b'), incoming = path.join(source, 'notes.json');
  await fs.writeFile(resident, 'verified export'); await fs.writeFile(incoming, 'keep original');
  const existingTarget = [{ name: 'book.m4b', stamp: await stamp(resident, 'book.m4b'), hash: await contentHash(resident) }];
  const options = { root: library, journal: path.join(root, 'move.json'), intent: { version: 2 as const, id: 'book', source, target, mode: 'move' as const,
    entries: [{ source: incoming, name: 'notes.json', stamp: await stamp(incoming) }] }, existingTarget,
    boundaries: [inbox], protectedFiles: new Set<string>(), commit: () => assert.fail('Must not commit'), rollback: () => {}, log: () => {} };
  await fs.writeFile(path.join(target, 'unrelated.txt'), 'leave alone');
  await assert.rejects(transferProjectFiles(options), /not owned|changed/);
  assert.equal(await fs.readFile(path.join(target, 'unrelated.txt'), 'utf8'), 'leave alone');
  await fs.unlink(path.join(target, 'unrelated.txt'));
  await fs.writeFile(resident, 'changed export');
  await assert.rejects(transferProjectFiles(options), /changed/);
  assert.equal(await fs.readFile(incoming, 'utf8'), 'keep original');
}));

test('failed owned-target commit rolls back new files and retains prior export and original sidecar', async () => fixture(async ({ root, inbox, library, source }) => {
  const target = path.join(library, 'Book'); await fs.mkdir(target);
  const resident = path.join(target, 'book.m4b'), incoming = path.join(source, 'metadata.json');
  await fs.writeFile(resident, 'verified export'); await fs.writeFile(incoming, 'keep original');
  await assert.rejects(transferProjectFiles({ root: library, journal: path.join(root, 'move.json'),
    intent: { version: 2, id: 'book', source, target, mode: 'move', entries: [{ source: incoming, name: 'metadata.json', stamp: await stamp(incoming) }] },
    existingTarget: [{ name: 'book.m4b', stamp: await stamp(resident, 'book.m4b'), hash: await contentHash(resident) }],
    boundaries: [inbox], protectedFiles: new Set(), commit: () => { throw new Error('save failed'); }, rollback: () => {}, log: () => {} }), /save failed/);
  assert.equal(await fs.readFile(resident, 'utf8'), 'verified export');
  assert.equal(await fs.readFile(incoming, 'utf8'), 'keep original');
  await assert.rejects(fs.stat(path.join(target, 'metadata.json')), { code: 'ENOENT' });
}));


test('owned-target finishing supports filesystems without hard links', async t => fixture(async ({ root, inbox, library, source }) => {
  const target = path.join(library, 'Book'); await fs.mkdir(target);
  const resident = path.join(target, 'book.m4b'), incoming = path.join(source, 'metadata.json');
  await fs.writeFile(resident, 'verified export'); await fs.writeFile(incoming, 'legacy metadata');
  t.mock.method(fs, 'link', async () => { throw Object.assign(new Error('Hard links unsupported'), { code: 'EPERM' }); });
  const existingTarget = [{ name: 'book.m4b', stamp: await stamp(resident, 'book.m4b'), hash: await contentHash(resident) }];
  await transferProjectFiles({ root: library, journal: path.join(root, 'move.json'),
    intent: { version: 2, id: 'book', source, target, mode: 'move', entries: [{ source: incoming, name: 'metadata.json', stamp: await stamp(incoming) }] },
    existingTarget, boundaries: [inbox], protectedFiles: new Set(), commit: () => {}, rollback: () => {}, log: () => {} });
  assert.equal(await fs.readFile(resident, 'utf8'), 'verified export');
  assert.equal(await fs.readFile(path.join(target, 'metadata.json'), 'utf8'), 'legacy metadata');
  await assert.rejects(fs.stat(incoming), { code: 'ENOENT' });
}));
