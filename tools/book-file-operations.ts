import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { assertUnlinked, contentHash, pathKey, within } from './library-filesystem';
import type { AudiobookJob } from '../src/types';
import { WINDOWS_RECYCLE_SCRIPT } from './windows-recycle';

const run = promisify(execFile);
export const sameOrInside = (root: string, file: string) => pathKey(root) === pathKey(file) || within(root, file);
export function validFileName(name: string) {
  if (!name || name.length > 240 || name.trim() !== name || /[\x00-\x1f\\/:*?"<>|]/.test(name) || /[. ]$/.test(name) || /^\.{1,2}$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name.startsWith('.swissmouse'))
    throw new Error('Enter one valid file or folder name.');
  return name;
}
export async function checkedPath(file: string, excluded: string[]) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Choose an absolute path.');
  const resolved = path.resolve(file);
  if (resolved.split(path.sep).some(segment => segment.startsWith('.swissmouse')) || excluded.some(root => sameOrInside(root, resolved))) throw new Error('SwissMouse working files cannot be managed here.');
  await assertUnlinked(resolved);
  return resolved;
}
export async function pathStamp(file: string) {
  const stat = await fs.lstat(file);
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}
export function planToken(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export async function mustNotExist(file: string) {
  try { await fs.lstat(file); } catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Destination already exists: ${file}`);
}

// Exclusive publication for files. Folder moves use a reserved directory and
// individual files, so an external race never permits overwriting another file.
export type OwnedCopy = { path: string; stamp: string; hash?: string };
export async function copyEntry(from: string, to: string, owned: OwnedCopy[] = []): Promise<OwnedCopy[]> {
  await assertUnlinked(from);
  const info = await fs.stat(from);
  if (info.isDirectory()) {
    await fs.mkdir(to); owned.push({ path: to, stamp: await pathStamp(to) });
    for (const name of await fs.readdir(from)) await copyEntry(path.join(from, name), path.join(to, name), owned);
  } else if (info.isFile()) {
    const before = await pathStamp(from);
    await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    const item = { path: to, stamp: await pathStamp(to), hash: await contentHash(to) }; owned.push(item);
    if (before !== await pathStamp(from) || await contentHash(from) !== item.hash || before !== await pathStamp(from)) throw new Error(`Copy verification failed: ${from}`);
    await fs.utimes(to, info.atime, info.mtime);
    item.stamp = await pathStamp(to);
  } else throw new Error('Only regular files and folders are supported.');
  return owned;
}
export async function rollbackCopies(owned: OwnedCopy[]) {
  // No recursive delete: remove only entries exclusively created by this call.
  for (const item of [...owned].reverse()) {
    try { await assertUnlinked(item.path); const stat = await fs.lstat(item.path);
      if (stat.isDirectory()) await fs.rmdir(item.path);
      else if (item.stamp === await pathStamp(item.path) && item.hash === await contentHash(item.path)) await fs.unlink(item.path);
    } catch { /* Retain changed/nonempty entries for recovery. */ }
  }
}
export async function renameExclusive(from: string, to: string) {
  await mustNotExist(to);
  await assertUnlinked(from); await assertUnlinked(path.dirname(to));
  const stat = await fs.stat(from);
  if (stat.isFile()) {
    await fs.link(from, to);
    try {
      const current = await fs.stat(from);
      if (current.dev !== stat.dev || current.ino !== stat.ino || current.size !== stat.size || current.mtimeMs !== stat.mtimeMs) throw new Error('Source changed during rename. Refresh before retrying.');
      await fs.unlink(from);
    } catch (error) {
      const target = await fs.lstat(to).catch(() => undefined);
      if (target?.dev === stat.dev && target?.ino === stat.ino) await fs.unlink(to);
      throw error;
    }
  } else {
    // Reserve the target name first. Node cannot rename a directory atomically
    // without replacement on every OS; refuse nonempty directory renames here.
    // A staged, verified copy retains originals until reference commit instead.
    throw new Error('Use Cut and Paste to move or rename a folder safely.');
  }
}

export async function recycleEntry(file: string) {
  await assertUnlinked(file);
  if (process.platform === 'win32') {
    // The path is data in an environment variable, never executable shell text.
    try { await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_RECYCLE_SCRIPT], { windowsHide: true, timeout: 120000, env: { ...process.env, SWISSMOUSE_RECYCLE_PATH: file } }); }
    catch (error: any) { const failure = new Error('Recycle Bin could not accept this item. No permanent deletion was requested.'); (failure as any).details = error.stderr || error.message; throw failure; }
  } else if (process.platform === 'linux') await run('gio', ['trash', '--', file]);
  else throw new Error('Recycle Bin/Trash is unavailable on this platform. The files were kept.');
}

/** Remap observations and explicit membership together, including descendants. */
export function remapSourceReferences(job: AudiobookJob, root: string, moves: { from: string; to: string }[]) {
  const absolute = (value: string) => {
    for (const move of moves) if (sameOrInside(move.from, value)) return path.join(move.to, path.relative(move.from, value));
    return value;
  };
  const nextRoot = absolute(root);
  const relative = (value: string) => path.relative(nextRoot, absolute(path.resolve(root, value))).replace(/\\/g, '/');
  for (const part of job.parts) { part.name = relative(part.name); if (part.sourceRelativePath) part.sourceRelativePath = relative(part.sourceRelativePath); }
  for (const file of new Set([...(job.discoveredFiles || []), ...(job.sourceInventory || []), ...(job.unsupportedFiles || [])])) {
    file.relativePath = relative(file.relativePath); file.fileName = path.basename(file.relativePath);
    if ('storedName' in file && file.storedName) file.storedName = relative(file.storedName);
    if ('chapterGroup' in file && file.chapterGroup) file.chapterGroup = relative(file.chapterGroup);
  }
  job.excludedSourceFiles = job.excludedSourceFiles?.map(relative);
  job.explicitlyAddedSourceFiles = job.explicitlyAddedSourceFiles?.map(relative);
  if (job.sourceFileStamps) job.sourceFileStamps = Object.fromEntries(Object.entries(job.sourceFileStamps).map(([key, value]) => [relative(key), value]));
  if (job.sourcePathIdentity) job.sourcePathIdentity = Object.fromEntries(Object.entries(job.sourcePathIdentity).map(([key, value]) => [relative(key), value]));
  if (job.bookScope?.directory) job.bookScope.directory = relative(job.bookScope.directory);
  // Remap declared path fields only. Metadata, chapter text, historical logs,
  // and logical fingerprint identities can themselves contain path-like text.
  for (const key of ['sourceFolderPath', 'outputFolderPath', 'previewPath', 'downloadedAudioFile'] as const) if (job[key]) job[key] = absolute(job[key]!);
  if (job.source) job.source.path = absolute(job.source.path);
  if (job.sourceSummary && path.isAbsolute(job.sourceSummary.sourcePath)) job.sourceSummary.sourcePath = absolute(job.sourceSummary.sourcePath);
  if (job.libraryScan) { job.libraryScan.root = absolute(job.libraryScan.root); job.libraryScan.path = absolute(job.libraryScan.path); }
  for (const output of [job.mergedMp3, job.outputM4b, ...(job.exports || [])]) if (output?.fullPath) {
    const next = absolute(output.fullPath); if (next !== output.fullPath) output.filename = path.basename(next); output.fullPath = next;
    if ('coverPath' in output && output.coverPath) output.coverPath = absolute(output.coverPath);
  }
  if (job.exportedFiles) job.exportedFiles = Object.fromEntries(Object.entries(job.exportedFiles).map(([key, value]) => [key, absolute(value)]));
  for (const file of [...(job.associatedFiles || []), ...(job.retainedSourceFiles || [])]) file.path = absolute(file.path);
  if (job.originalsArchive?.path) job.originalsArchive.path = absolute(job.originalsArchive.path);
  if (job.matchHashes) job.matchHashes = Object.fromEntries(Object.entries(job.matchHashes).map(([key, value]) => [absolute(key), value]));
  if (job.audioFingerprints) job.audioFingerprints = Object.fromEntries(Object.entries(job.audioFingerprints).map(([key, value]) => [absolute(key), value]));
  if (job.sourceFolderPath) job.sourceFolderPath = nextRoot;
}

export const operationId = () => randomUUID();
