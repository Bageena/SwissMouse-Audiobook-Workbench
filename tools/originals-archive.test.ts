import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { archiveOriginals, validateOriginalsZip, type OriginalsArchive } from './originals-archive';
import { pathKey } from './library-filesystem';

for (const failure of ['none', 'corrupt', 'commit', 'collision', 'shared'] as const) test(`original ZIP verification and cleanup: ${failure}`, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swissmouse-originals-'));
  try {
    const sources = [{ source: path.join(root, '01.mp3'), name: 'Disc 1/01.mp3' }, { source: path.join(root, "'Salem's Lot [Reader].mp4"), name: "'Salem's Lot [Reader].mp4" }];
    const bytes = [randomBytes(1024 * 1024 + 7), randomBytes(13577)];
    for (const [index, file] of sources.entries()) await fs.writeFile(file.source, bytes[index]);
    await fs.writeFile(path.join(root, 'finished.m4b'), 'finished');
    const target = path.join(root, 'Originals.zip');
    if (failure === 'collision') await fs.writeFile(target, 'existing zip');
    let committed: OriginalsArchive | undefined;
    const operation = archiveOriginals({ folder: root, sources, sourceKey: 'fixture', journal: path.join(root, 'recovery.json'),
      protectedFiles: new Set(failure === 'shared' ? [pathKey(sources[0].source)] : []),
      commit: archive => { if (failure === 'commit') throw new Error('Disk full saving project'); committed = archive; },
      log: message => { if (failure === 'corrupt' && message.startsWith('Checking')) syncFs.writeFileSync(target, 'corrupt ZIP'); },
    });
    if (failure === 'none') {
      const result = await operation;
      assert.equal(result.warning, undefined); assert.ok(committed); assert.equal(committed.path, target);
      await validateOriginalsZip(target, committed.files);
      for (const file of sources) await assert.rejects(fs.stat(file.source), { code: 'ENOENT' });
    } else {
      await assert.rejects(operation);
      assert.equal(committed, undefined);
      for (const [index, file] of sources.entries()) assert.deepEqual(await fs.readFile(file.source), bytes[index], 'Every original survives the failed operation');
      if (failure === 'collision') assert.equal(await fs.readFile(target, 'utf8'), 'existing zip');
    }
    assert.equal(await fs.readFile(path.join(root, 'finished.m4b'), 'utf8'), 'finished');
    assert.equal((await fs.readdir(root)).some(name => name.startsWith('.swissmouse-original-')), false);
    await assert.rejects(fs.stat(path.join(root, 'recovery.json')), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
