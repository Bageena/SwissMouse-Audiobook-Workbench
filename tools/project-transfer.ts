import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertUnlinked, contentHash, fileSignature, inventory, pathKey, stamp, verifiedCopy, rollbackCopiedFiles, within, type MoveEntry, type CopiedFile } from './library-filesystem';

export type TransferJournal = {
  version: 2; id: string; source: string; target: string; mode: 'copy' | 'move';
  entries: MoveEntry[]; pending?: { source: string; quarantine: string };
  operation?: 'project' | 'exports' | 'import';
  destinationRoot?: string;
  copied?: CopiedFile[];
  reusedTarget?: boolean;
};

export async function writeTransferJournal(file: string, value: TransferJournal) {
  const temporary = file + '.tmp';
  const handle = await fs.open(temporary, 'w');
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, file);
}

// Rollback owns only the files in this plan. A late destination collision, or
// files added by another process, never authorizes recursive directory removal.
export async function transferProjectFiles(options: {
  root: string; journal: string; intent: TransferJournal; cleanupEntries?: MoveEntry[];
  existingTarget?: CopiedFile[];
  boundaries: string[]; protectedFiles: Set<string>;
  commit: () => Promise<void> | void; rollback: () => void;
  log: (message: string) => void;
}): Promise<string | undefined> {
  const { root, journal, intent, log } = options;
  let copied: Awaited<ReturnType<typeof verifiedCopy>> | undefined, committed = false, journalOwned = false;
  try {
    const reserved = (owned: CopiedFile[]) => {
      // Reservation is exclusive; only now does this journal own the target.
      journalOwned = true;
      intent.copied = owned;
      requireJournal(journal, intent);
    };
    copied = options.existingTarget
      ? await copyIntoOwnedTarget(root, journal, intent, options.existingTarget, log, reserved)
      : await verifiedCopy(root, intent.target, intent.entries, log, reserved, entry => intent.mode === 'move' && !options.protectedFiles.has(pathKey(entry.source)) &&
        (options.cleanupEntries || intent.entries).some(original => pathKey(original.source) === pathKey(entry.source)));
    intent.copied = copied;
    await writeTransferJournal(journal, intent);
    await verifyTransferredFiles(intent.target, intent.entries, false);
    await options.commit(); committed = true;
    if (intent.mode === 'move') {
      try {
        await cleanTransferredFiles({ journal, intent, entries: options.cleanupEntries || intent.entries,
          boundaries: options.boundaries, protectedFiles: options.protectedFiles, log });
      } catch (error: any) {
        const warning = `Library files were saved, but source cleanup is incomplete. Remaining originals were kept: ${error.message}`;
        log(warning); return warning;
      }
    }
    await fs.unlink(journal).catch(error => log(`Recovery journal retained: ${error.message}`));
  } catch (error) {
    if (!committed) {
      options.rollback();
      if (copied) await rollbackCopiedFiles(intent.target, copied);
      if (journalOwned) {
        try { await fs.stat(intent.target); } catch (missing: any) { if (missing.code === 'ENOENT') await fs.unlink(journal).catch(() => {}); }
      }
    }
    throw error;
  }
}

/** Publish only missing files beside an already verified export. Existing files
 * never belong to this transaction's rollback or source cleanup. */
async function copyIntoOwnedTarget(root: string, journal: string, intent: TransferJournal, existing: CopiedFile[], log: (message: string) => void, reserve: (files: CopiedFile[]) => void) {
  if (!within(root, intent.target)) throw new Error('Destination must be inside the Library folder.');
  await assertUnlinked(intent.target);
  const current = await inventory(intent.target);
  const signature = (files: CopiedFile[] | typeof current) => JSON.stringify(files.map(file => 'stamp' in file ? file.stamp : file).map(file => [pathKey(file.name), file.identity, file.size, file.mtime]).sort());
  if (!existing.length || signature(current) !== signature(existing)) throw new Error('Existing Library folder changed or is not owned by this project.');
  for (const file of existing) if (await contentHash(path.join(intent.target, file.name)) !== file.hash) throw new Error('Existing Library file changed.');
  const pending = intent.entries.filter(entry => pathKey(entry.source) !== pathKey(path.join(intent.target, entry.name)));
  for (const entry of pending) {
    const destination = path.resolve(intent.target, entry.name);
    if (!within(intent.target, destination) || current.some(file => pathKey(path.join(intent.target, file.name)) === pathKey(destination))) throw new Error(`A file already exists at the destination: ${entry.name}`);
  }
  const stage = path.join(path.dirname(intent.target), `.swissmouse-finalize-${randomUUID()}`);
  let copied: CopiedFile[] = [];
  try {
    if (pending.length) copied = await verifiedCopy(root, stage, pending, log);
    // Hard links publish exclusively and preserve the staged identity, allowing
    // the journal to record every owned filename before it becomes visible.
    intent.reusedTarget = true;
    reserve(copied);
    for (const file of copied) {
      const destination = path.resolve(intent.target, file.name);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await assertUnlinked(path.dirname(destination));
      try { await fs.link(path.join(stage, file.name), destination); }
      catch (error: any) {
        if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK'].includes(error.code)) throw error;
        // Filesystems without hard links still publish exclusively. An interruption
        // before recording the new identity retains that file for manual recovery.
        await fs.copyFile(path.join(stage, file.name), destination, fs.constants.COPYFILE_EXCL);
        file.stamp = await stamp(destination, file.name);
        await writeTransferJournal(journal, intent);
      }
    }
    await verifyTransferredFiles(intent.target, intent.entries);
    return copied;
  } catch (error) {
    await rollbackCopiedFiles(intent.target, copied);
    throw error;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

// verifiedCopy's reservation callback is synchronous so no unjournaled await
// separates destination reservation from publication of the transfer intent.
import fsSync from 'node:fs';
function requireJournal(file: string, intent: TransferJournal) {
  const descriptor = fsSync.openSync(file, 'wx');
  try { fsSync.writeFileSync(descriptor, JSON.stringify(intent)); fsSync.fsyncSync(descriptor); }
  finally { fsSync.closeSync(descriptor); }
}

// An interrupted transfer owns individual published files, never its entire
// destination folder. Unknown or replaced files remain for manual review.
export async function recoverTransferCopies(target: string, copied: CopiedFile[]) {
  await assertUnlinked(target);
  const recovery = path.join(path.dirname(target), `.swissmouse-recovered-${randomUUID()}`);
  const directories = new Set([target]);
  let recovered = false;
  for (const file of copied) {
    const currentPath = path.resolve(target, file.name);
    if (!within(target, currentPath)) throw new Error('Unsafe recovery filename.');
    try {
      await assertUnlinked(currentPath);
      const current = await stamp(currentPath, file.name);
      if (current.identity !== file.stamp.identity || fileSignature([current]) !== fileSignature([file.stamp]) || await contentHash(currentPath) !== file.hash) continue;
      const destination = path.join(recovery, file.name);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rename(currentPath, destination);
      recovered = true;
      for (let parent = path.dirname(currentPath); within(target, parent); parent = path.dirname(parent)) directories.add(parent);
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    try { await fs.rmdir(directory); } catch { /* Preserve every nonempty folder. */ }
  }
  return recovered ? recovery : undefined;
}

export async function verifyTransferredFiles(target: string, entries: MoveEntry[], compareContent = true) {
  for (const entry of entries) {
    try {
      await assertUnlinked(entry.source);
      const destination = path.resolve(target, entry.name);
      if (!within(target, destination)) throw new Error('Unsafe destination');
      await assertUnlinked(destination);
      const source = await stamp(entry.source, entry.stamp.name);
      const copied = await stamp(destination);
      if (source.identity !== entry.stamp.identity || fileSignature([source]) !== fileSignature([entry.stamp]) ||
        copied.size !== source.size || (compareContent && copied.identity !== source.identity && await contentHash(entry.source) !== await contentHash(destination)))
        throw new Error('Source changed or destination verification failed');
      if (fileSignature([await stamp(entry.source, entry.stamp.name)]) !== fileSignature([source])) throw new Error('Source changed during verification');
    } catch (error: any) { throw new Error(`${entry.source}: ${error.message}`); }
  }
}

// Only explicit files are removed. Every file is checked again immediately before
// removal, and an interrupted per-file rename is recoverable from the journal.
export async function cleanTransferredFiles(options: {
  journal: string; intent: TransferJournal; entries: MoveEntry[]; boundaries: string[];
  protectedFiles: Set<string>; log: (message: string) => void;
}) {
  const { journal, intent, entries, boundaries, protectedFiles, log } = options;
  await verifyTransferredFiles(intent.target, entries);
  log(`Cleanup verification passed for ${entries.length} files.`);
  const directories = new Set<string>();
  for (const entry of entries) {
    if (pathKey(entry.source) === pathKey(path.join(intent.target, entry.name))) continue;
    if (protectedFiles.has(pathKey(entry.source))) { log(`Kept file referenced by another project: ${entry.source}`); continue; }
    await verifyTransferredFiles(intent.target, [entry], false);
    const quarantine = path.join(path.dirname(entry.source), `.swissmouse-${randomUUID()}.moved`);
    intent.pending = { source: entry.source, quarantine };
    await writeTransferJournal(journal, intent);
    await fs.rename(entry.source, quarantine);
    try {
      await verifyTransferredFiles(intent.target, [{ ...entry, source: quarantine }]);
      await fs.unlink(quarantine);
    } catch (error) {
      // Never overwrite a replacement source created by another application.
      try { await fs.link(quarantine, entry.source); await fs.unlink(quarantine); } catch { /* Journal retains recovery location. */ }
      throw error;
    }
    directories.add(path.dirname(entry.source));
    log(`Removed verified original: ${entry.source}`);
    delete intent.pending;
    await writeTransferJournal(journal, intent);
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    let current = directory;
    // Stay within a configured root; external output folders get no ancestor cleanup.
    while (boundaries.some(root => within(root, current)) && !boundaries.some(root => pathKey(root) === pathKey(current))) {
      try {
        await assertUnlinked(current);
        await fs.rmdir(current); // Hidden/system files count; never recursive.
        log(`Removed empty source directory: ${current}`);
        current = path.dirname(current);
      } catch (error: any) {
        if (error.code !== 'ENOENT') log(`Kept source directory: ${current} (${error.code || error.message})`);
        break;
      }
    }
  }
}
