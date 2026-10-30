import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import yauzl from 'yauzl';
import * as crc32Module from 'buffer-crc32';
import { assertUnlinked, contentHash, fileSignature, pathKey, stamp, type FileStamp } from './library-filesystem';

// The package's ESM default export has CommonJS-only TypeScript declarations.
const crc32 = (crc32Module as unknown as { default: { unsigned(data: Buffer, previous?: number): number } }).default;

export type { ArchivedOriginal, OriginalsArchive } from '../packages/audiobooks/src/legacy-domain';
import type { ArchivedOriginal, OriginalsArchive } from '../packages/audiobooks/src/legacy-domain';
type ArchiveJournal = { version: 1; archive: string; files: { source: string; quarantine: string; stamp: FileStamp }[] };

const sameStamp = (a: FileStamp, b: FileStamp) => a.identity === b.identity && fileSignature([a]) === fileSignature([b]);
async function durableJson(file: string, value: unknown) {
  const temp = file + '.tmp';
  const handle = await fs.open(temp, 'w');
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, file);
}

// A single read-back pass checks every entry's name, length, CRC and SHA-256
// against the bytes streamed from the originals. Nothing is extracted to disk.
export async function validateOriginalsZip(file: string, files: ArchivedOriginal[]) {
  const expected = new Map(files.map(item => [item.name, item]));
  const seen = new Set<string>();
  const zip = await yauzl.openPromise(file, { autoClose: false, strictFileNames: true, validateEntrySizes: true });
  try {
    for await (const entry of zip.eachEntry()) {
      const original = expected.get(entry.fileName);
      if (!original || seen.has(entry.fileName) || entry.uncompressedSize !== original.stamp.size) throw new Error('ZIP file list or size does not match the originals.');
      const hash = createHash('sha256'); let size = 0, crc = 0;
      const stream = await zip.openReadStreamPromise(entry);
      for await (const chunk of stream) { size += chunk.length; hash.update(chunk); crc = crc32.unsigned(chunk, crc); }
      if (size !== original.stamp.size || crc !== entry.crc32 || hash.digest('hex') !== original.sha256) throw new Error(`ZIP verification failed: ${entry.fileName}`);
      seen.add(entry.fileName);
    }
    if (seen.size !== files.length) throw new Error('ZIP is missing original audio files.');
  } finally { zip.close(); }
}

async function writeZip(file: string, files: ArchivedOriginal[]) {
  const zip = new yazl.ZipFile();
  zip.on('error', error => zip.outputStream.destroy(error));
  const streams = new Set<syncFs.ReadStream>();
  const finished = pipeline(zip.outputStream, syncFs.createWriteStream(file, { flags: 'wx' }));
  // Attach the rejection handler before file setup can emit an asynchronous error.
  void finished.catch(() => {});
  try {
    for (const original of files) {
      zip.addReadStreamLazy(original.name, { size: original.stamp.size, mtime: new Date(original.stamp.mtime), compressionLevel: 1 }, callback => {
        const hash = createHash('sha256');
        const input = syncFs.createReadStream(original.source, { highWaterMark: 1024 * 1024 });
        streams.add(input); input.once('close', () => streams.delete(input));
        const checked = new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); done(null, chunk); },
          flush(done) { original.sha256 = hash.digest('hex'); done(); } });
        input.on('error', error => checked.destroy(error));
        checked.on('error', error => zip.outputStream.destroy(error));
        input.pipe(checked); callback(null, checked);
      });
    }
    zip.end();
    await finished;
    const handle = await fs.open(file, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
  } finally { for (const input of streams) input.destroy(); zip.outputStream.destroy(); }
}

// Quarantine renames are reversible. If the ZIP check or durable project update
// fails, restore all original names. Recovery never automatically deletes audio.
export async function restoreArchivedSources(journalPath: string): Promise<void> {
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as ArchiveJournal;
  if (journal.version !== 1 || !Array.isArray(journal.files)) throw new Error('Invalid originals archive recovery journal.');
  for (const item of journal.files) {
    if (path.dirname(item.source) !== path.dirname(item.quarantine) || !/^\.swissmouse-original-[\w-]+\.audio$/.test(path.basename(item.quarantine))) throw new Error('Unsafe originals recovery path.');
    try {
      await assertUnlinked(item.quarantine);
      if (!sameStamp(await stamp(item.quarantine, item.stamp.name), item.stamp)) throw new Error('Original changed in quarantine; retained for manual recovery.');
      try { await fs.lstat(item.source); throw new Error('Original name is occupied; quarantined audio was retained.'); }
      catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      // A link is exclusive; do not overwrite a new file created at the old name.
      try { await fs.link(item.quarantine, item.source); }
      catch (error: any) {
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(error.code)) throw error;
        await fs.copyFile(item.quarantine, item.source, fs.constants.COPYFILE_EXCL);
        if (await contentHash(item.source) !== await contentHash(item.quarantine)) throw new Error('Original restore could not be verified; quarantined audio was retained.');
        await fs.utimes(item.source, new Date(), new Date(item.stamp.mtime));
      }
      await fs.unlink(item.quarantine);
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  await fs.unlink(journalPath);
}

export async function archiveOriginals(options: {
  folder: string; sources: { source: string; name: string }[]; sourceKey: string;
  protectedFiles: Set<string>; journal: string;
  commit: (archive: OriginalsArchive) => Promise<void> | void;
  log: (message: string) => void;
}): Promise<{ archive: OriginalsArchive; warning?: string }> {
  const target = path.join(options.folder, 'Originals.zip');
  await assertUnlinked(options.folder);
  try { await fs.lstat(target); throw new Error('Originals.zip already exists. Keep or rename it before creating another archive.'); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  if (!options.sources.length) throw new Error('No original audio files are available to archive.');
  const names = new Set<string>(), sources = new Set<string>();
  const files: ArchivedOriginal[] = [];
  for (const input of options.sources) {
    const name = input.name.replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(piece => !piece || piece === '..' || piece === '.') || names.has(name.toLowerCase()) || sources.has(pathKey(input.source))) throw new Error('Original audio has duplicate or unsafe ZIP names.');
    if (options.protectedFiles.has(pathKey(input.source))) throw new Error('Original audio is used by another project. No originals were removed.');
    await assertUnlinked(input.source);
    names.add(name.toLowerCase()); sources.add(pathKey(input.source));
    files.push({ source: input.source, name, stamp: await stamp(input.source), sha256: '' });
  }
  const staging = path.join(options.folder, `.swissmouse-originals-${randomUUID()}.zip`);
  let published = false, journalWritten = false, committed = false;
  let publishedStamp: FileStamp | undefined;
  const journal: ArchiveJournal = { version: 1, archive: target, files: [] };
  try {
    options.log(`Creating Originals.zip from ${files.length} original audio files.`);
    await writeZip(staging, files);
    // Publish exclusively. Verify the final published ZIP, including copy fallback.
    try { await fs.link(staging, target); }
    catch (error: any) {
      if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(error.code)) throw error;
      await fs.copyFile(staging, target, fs.constants.COPYFILE_EXCL);
    }
    published = true; publishedStamp = await stamp(target);
    for (const file of files) {
      if (!sameStamp(await stamp(file.source, file.stamp.name), file.stamp)) throw new Error(`Original changed while zipping: ${file.name}`);
    }
    for (const file of files) {
      const quarantine = path.join(path.dirname(file.source), `.swissmouse-original-${randomUUID()}.audio`);
      journal.files.push({ source: file.source, quarantine, stamp: file.stamp });
      await durableJson(options.journal, journal); journalWritten = true;
      await fs.rename(file.source, quarantine);
    }
    options.log('Checking Originals.zip against every original audio file.');
    await validateOriginalsZip(target, files);
    if (!sameStamp(await stamp(target), publishedStamp)) throw new Error('ZIP changed during verification.');
    for (const item of journal.files) if (!sameStamp(await stamp(item.quarantine, item.stamp.name), item.stamp)) throw new Error('Original changed during ZIP verification.');
    const archive: OriginalsArchive = { path: target, sourceKey: options.sourceKey, verifiedAt: new Date().toISOString(), stamp: publishedStamp, files };
    await options.commit(archive); committed = true;
    options.log('Originals.zip verified. Cleaning up original audio files.');
    // Only after all entries passed verification and the recovery record is durable.
    try {
      for (const item of journal.files) {
        await assertUnlinked(item.quarantine);
        if (!sameStamp(await stamp(item.quarantine, item.stamp.name), item.stamp) || !sameStamp(await stamp(target), publishedStamp)) throw new Error('Files changed before original cleanup.');
        await fs.unlink(item.quarantine);
      }
      await fs.unlink(options.journal); journalWritten = false;
    } catch (error: any) {
      await restoreArchivedSources(options.journal).then(() => { journalWritten = false; }).catch(() => {});
      return { archive, warning: 'Originals.zip was verified, but some originals could not be cleaned up and were retained: ' + error.message };
    }
    options.log('Originals.zip verified. Original audio files removed.');
    return { archive };
  } catch (error) {
    if (!committed && journalWritten) {
      try { await restoreArchivedSources(options.journal); journalWritten = false; }
      catch (recovery: any) { throw new Error(`${(error as Error).message} Originals were retained; recovery needs attention: ${recovery.message}`); }
    }
    throw error;
  } finally {
    await fs.unlink(staging).catch(() => {});
    if (published && !committed && !journalWritten && publishedStamp) {
      // Never remove a replaced archive or somebody else's collision.
      try { if (sameStamp(await stamp(target), publishedStamp)) await fs.unlink(target); } catch { /* Keep uncertain data. */ }
    }
  }
}
