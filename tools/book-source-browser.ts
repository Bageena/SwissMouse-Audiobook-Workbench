import fs from 'node:fs';
import path from 'node:path';
import type { AudiobookJob } from '../src/types';

export interface SourceTreeEntry {
  name: string;
  relativePath: string;
  type: 'file' | 'folder';
  sizeBytes?: number;
  audio?: boolean;
  unavailable?: boolean;
}

const hiddenWorkspaces = new Set(['.swissmouse-work', '.swissmouse']);
const relative = (value: string) => value.replace(/\\/g, '/');
function assertBookRoot(root: string) {
  const resolved = path.resolve(root);
  if (!fs.statSync(resolved).isDirectory() || fs.realpathSync(resolved).toLowerCase() !== resolved.toLowerCase())
    throw new Error('The book root must be an existing, unlinked folder.');
  return resolved;
}
function child(root: string, value: string) {
  if (!value || path.isAbsolute(value) || value.includes('\0')) throw new Error('Choose a path inside this book.');
  if (relative(value).split('/').some(segment => hiddenWorkspaces.has(segment.toLowerCase()))) throw new Error('SwissMouse workspace folders cannot be changed here.');
  const target = path.resolve(root, value);
  const rel = path.relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Choose a path inside this book.');
  for (let current = target; current !== root; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked paths cannot be managed in the source browser.');
  }
  return target;
}
export function listBookTree(root: string, extensions: Set<string>, excludedRoots: string[] = []): SourceTreeEntry[] {
  root = assertBookRoot(root);
  const entries: SourceTreeEntry[] = [];
  const walk = (folder: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || hiddenWorkspaces.has(entry.name.toLowerCase())) continue;
      const file = path.join(folder, entry.name);
      if (excludedRoots.some(excluded => path.resolve(excluded).toLowerCase() === path.resolve(file).toLowerCase())) continue;
      const relativePath = relative(path.relative(root, file));
      if (entry.isDirectory()) {
        entries.push({ name: entry.name, relativePath, type: 'folder' });
        walk(file);
      } else if (entry.isFile()) {
        entries.push({ name: entry.name, relativePath, type: 'file', sizeBytes: fs.statSync(file).size,
          audio: extensions.has(path.extname(file).slice(1).toLowerCase()) });
      }
    }
  };
  walk(root);
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'en', { numeric: true, sensitivity: 'base' }));
}

// Navigation reads one directory, not every audiobook below an author or drive.
export function listBookDirectory(directory: string, extensions: Set<string>, excludedRoots: string[] = []) {
  if (!path.isAbsolute(directory)) throw new Error('Enter an absolute folder path.');
  directory = assertBookRoot(directory);
  const blocked = (file: string) => relative(file).split('/').some(segment => hiddenWorkspaces.has(segment.toLowerCase())) ||
    excludedRoots.some(root => { const rel = path.relative(path.resolve(root), file); return !rel || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); });
  if (blocked(directory)) throw new Error('SwissMouse processing folders are not browse sources.');
  const entries: SourceTreeEntry[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || blocked(file)) continue;
    if (entry.isDirectory()) entries.push({ name: entry.name, relativePath: entry.name, type: 'folder' });
    else if (entry.isFile()) {
      try { entries.push({ name: entry.name, relativePath: entry.name, type: 'file', sizeBytes: fs.statSync(file).size,
        audio: extensions.has(path.extname(entry.name).slice(1).toLowerCase()) }); }
      catch { entries.push({ name: entry.name, relativePath: entry.name, type: 'file', unavailable: true }); }
    }
  }
  entries.sort((a, b) => Number(b.type === 'folder') - Number(a.type === 'folder') || a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  return { directory, parent: path.dirname(directory) === directory ? undefined : path.dirname(directory), entries };
}

// Broaden the relative-path base only after explicit attachment. Physical files,
// source identity, metadata, chapters and transcript state stay in place.
export function rebaseBookMembership(job: AudiobookJob, previousRoot: string, files: string[]): string {
  let root = path.resolve(previousRoot);
  for (const file of files) {
    if (path.parse(file).root.toLowerCase() !== path.parse(root).root.toLowerCase()) throw new Error('Select files on the same drive as this project.');
    while (true) {
      const rel = path.relative(root, file);
      if (rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) break;
      const parent = path.dirname(root);
      if (parent === root) throw new Error('Could not find a shared source folder.');
      root = parent;
    }
  }
  if (root === path.resolve(previousRoot)) return root;
  const remap = (value: string) => relative(path.relative(root, path.resolve(previousRoot, value)));
  for (const part of job.parts) { part.name = remap(part.name); if (part.sourceRelativePath) part.sourceRelativePath = remap(part.sourceRelativePath); }
  for (const file of new Set([...(job.discoveredFiles || []), ...(job.sourceInventory || []), ...(job.unsupportedFiles || [])])) {
    file.relativePath = remap(file.relativePath);
    if ('storedName' in file && file.storedName) file.storedName = remap(file.storedName);
    if ('chapterGroup' in file && file.chapterGroup) file.chapterGroup = remap(file.chapterGroup);
  }
  job.excludedSourceFiles = job.excludedSourceFiles?.map(remap);
  job.explicitlyAddedSourceFiles = job.explicitlyAddedSourceFiles?.map(remap);
  if (job.sourceFileStamps) job.sourceFileStamps = Object.fromEntries(Object.entries(job.sourceFileStamps).map(([key, value]) => [remap(key), value]));
  if (job.sourcePathIdentity) job.sourcePathIdentity = Object.fromEntries(Object.entries(job.sourcePathIdentity).map(([key, value]) => [remap(key), value]));
  if (job.bookScope?.directory !== undefined) job.bookScope.directory = remap(job.bookScope.directory);
  job.sourceFolderPath = root;
  return root;
}
export function resolveBookAudio(root: string, relativePath: string, extensions: Set<string>) {
  const file = child(assertBookRoot(root), relativePath);
  if (!extensions.has(path.extname(file).slice(1).toLowerCase()) || !fs.statSync(file).isFile())
    throw new Error('Choose an audio file inside the browse root.');
  return file;
}
export function createBookFolder(root: string, parent: string, name: string) {
  root = assertBookRoot(root);
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name) || name.trim() !== name || name.endsWith('.'))
    throw new Error('Enter one valid folder name.');
  const folder = parent ? child(root, parent) : root;
  if (!fs.statSync(folder).isDirectory()) throw new Error('The parent folder is unavailable.');
  const target = child(root, path.join(parent, name));
  fs.mkdirSync(target);
  return relative(path.relative(root, target));
}
export function moveBookFiles(root: string, files: string[], destination: string) {
  root = assertBookRoot(root);
  if (!files.length || new Set(files).size !== files.length) throw new Error('Select one or more distinct files.');
  const folder = destination ? child(root, destination) : root;
  if (!fs.statSync(folder).isDirectory()) throw new Error('The destination folder is unavailable.');
  const moves = files.map(value => {
    const from = child(root, value);
    if (!fs.statSync(from).isFile()) throw new Error(`Source file is unavailable: ${value}`);
    const to = child(root, path.relative(root, path.join(folder, path.basename(from))));
    if (from === to) throw new Error(`File is already in that folder: ${value}`);
    if (fs.existsSync(to)) throw new Error(`Destination already contains ${path.basename(to)}.`);
    return { from, to, oldRelativePath: relative(path.relative(root, from)), relativePath: relative(path.relative(root, to)) };
  });
  if (new Set(moves.map(item => item.to.toLowerCase())).size !== moves.length) throw new Error('Selected files would collide in the destination.');
  const completed: typeof moves = [];
  try {
    for (const move of moves) { fs.renameSync(move.from, move.to); completed.push(move); }
  } catch (error) {
    for (const move of completed.reverse()) fs.renameSync(move.to, move.from);
    throw error;
  }
  return moves;
}
