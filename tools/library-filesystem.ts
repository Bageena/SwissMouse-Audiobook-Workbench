import { readExtendedMetadata, cleanMemberships } from '../src/utils/extendedMetadata';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { AudiobookMetadata, CoverArtInfo } from '../src/types';
import { metadataFromTags } from './audiobook-metadata';
import { probableBookGroups, isSequenceFolder } from '../src/utils/bookGroups';
import { mapScanWork } from './scan-work';

export const pathKey = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
export function within(root: string, file: string) {
  const relative = path.relative(pathKey(root), pathKey(file));
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export async function assertUnlinked(file: string) {
  let current = path.resolve(file);
  while (true) {
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Linked paths are not supported for managed file operations: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export type FileStamp = { name: string; size: number; mtime: number; identity: string };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const fileSignature = (files: FileStamp[]) => digest(files.map(({ name, size, mtime }) => [name, size, mtime]));
export async function stamp(file: string, name = path.basename(file)): Promise<FileStamp> {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular file: ${file}`);
  return { name, size: info.size, mtime: info.mtimeMs, identity: `${info.dev}:${info.ino}` };
}
export async function inventory(folder: string): Promise<FileStamp[]> {
  await assertUnlinked(folder);
  const files: FileStamp[] = [];
  const walk = async (directory: string) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Linked file or folder must be resolved before moving: ${file}`);
      if (entry.isDirectory()) await walk(file);
      else files.push(await stamp(file, path.relative(folder, file)));
    }
  };
  await walk(folder);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
export async function contentHash(file: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await fs.open(file, 'r');
  try { for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 1024 * 1024 })) hash.update(chunk); }
  finally { await handle.close(); }
  return hash.digest('hex');
}

export interface DiskBook {
  // path is the stable scan key. A loose multipart group uses its first file;
  // folder remains the base for all relative member paths.
  path: string; folder: string; mode: 'file' | 'folder'; files: FileStamp[];
  signature: string; identity: string; metadataFile?: string;
  associatedFiles?: { path: string; kind: 'metadata' | 'cover' }[];
  title?: string;
  grouped?: boolean;
}
// Walk asynchronously, never transcribe, decode audio, or follow directory links.
// Only numbered disc/chapter folders inherit ownership. Named book folders
// remain independent even when their parent also contains audio or metadata.
export async function scanRoot(root: string, extensions: Set<string>, excluded: string[] = [], observer?: { onFolder?: (folder: string) => void; onError?: (file: string, error: Error) => void }): Promise<DiskBook[]> {
  await assertUnlinked(root);
  const books: DiskBook[] = [];
  const exclusions = new Set(excluded.map(pathKey));
  const walk = async (folder: string, owner?: { folder: string; files: FileStamp[]; sidecars: FileStamp[] }) => {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    observer?.onFolder?.(folder);
    const regular = entries.filter(entry => entry.isFile());
    const audio = regular.filter(entry => extensions.has(path.extname(entry.name).slice(1).toLowerCase()));
    const metadata = regular.find(entry => entry.name.toLowerCase() === 'exmetadata.json') || regular.find(entry => entry.name.toLowerCase() === 'metadata.json');
    const children = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !exclusions.has(pathKey(path.join(folder, entry.name))));
    const chapterFolders = children.some(entry => isSequenceFolder(entry.name, path.basename(folder)));
    const own = (owner && !metadata ? owner : undefined) || (folder !== root && (audio.length || metadata || chapterFolders) ? { folder, files: [], sidecars: [] } : undefined);
    const loose: FileStamp[] = [];
    const observed = await mapScanWork(audio, 8, async entry => {
      const file = path.join(folder, entry.name);
      try {
        return await stamp(file, own ? path.relative(own.folder, file) : entry.name);
      } catch (error) { if (!observer?.onError) throw error; observer.onError(file, error as Error); }
    });
    (own ? own.files : loose).push(...observed.filter((file): file is FileStamp => !!file));
    if (own) for (const entry of regular.filter(entry => /^((?:exmetadata|metadata)\.json|cover\.(png|jpe?g|webp))$/i.test(entry.name))) {
      try { own.sidecars.push(await stamp(path.join(folder, entry.name), path.relative(own.folder, path.join(folder, entry.name)))); }
      catch (error) { if (!observer?.onError) throw error; observer.onError(path.join(folder, entry.name), error as Error); }
    }
    const beforeChildren = books.length;
    for (const entry of children) {
      try { await walk(path.join(folder, entry.name), isSequenceFolder(entry.name, path.basename(folder)) ? own : undefined); }
      catch (error) { if (!observer?.onError) throw error; observer.onError(path.join(folder, entry.name), error as Error); }
    }
    // SwissMouse's separate finished exports do not turn their source book
    // into a collection or take precedence over its own metadata sidecar.
    const finalized = path.join(folder, 'Finalized');
    const independentChildren = books.slice(beforeChildren).some(book => !(metadata && (pathKey(book.path) === pathKey(finalized) || within(finalized, book.path))));
    const addLooseGroups = async (files: FileStamp[], sidecars: FileStamp[] = []) => {
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const groups = probableBookGroups(files.map(file => ({ relativePath: file.name })), path.basename(folder));
      const byName = new Map(files.map(file => [file.name.replace(/\\/g, '/'), file]));
      for (const group of groups) {
        const members = group.files.map(name => byName.get(name)!);
        // A collection-level sidecar must not name every child book.
        const companions = groups.length === 1 && !independentChildren ? sidecars : [];
        books.push({ path: path.join(folder, members[0].name), folder, mode: members.length === 1 ? 'file' : 'folder', files: members,
          signature: fileSignature([...members, ...companions]), identity: digest(members.map(file => file.identity).sort()),
          metadataFile: companions.some(file => /^(exmetadata|metadata)\.json$/i.test(file.name)) ? path.join(folder, metadata!.name) : undefined,
          associatedFiles: companions.map(file => ({ path: path.join(folder, file.name), kind: /\.json$/i.test(file.name) ? 'metadata' : 'cover' })),
          title: group.title, grouped: true });
      }
    };
    if (loose.length) {
      const sidecar = !independentChildren ? await Promise.all(regular.filter(entry => /^((?:exmetadata|metadata)\.json|cover\.(png|jpe?g|webp))$/i.test(entry.name)).map(entry => stamp(path.join(folder, entry.name)))) : [];
      await addLooseGroups(loose, sidecar);
    }
    if (own && own !== owner && own.files.length) {
      own.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      own.sidecars.sort((a, b) => a.name.localeCompare(b.name));
      const mixedFormats = new Set(own.files.map(file => path.extname(file.name).toLowerCase())).size > 1;
      const looseCollection = independentChildren || ((mixedFormats || own.files.every(file => /\.m4b$/i.test(file.name))) && probableBookGroups(own.files.map(file => ({ relativePath: file.name })), path.basename(folder)).length > 1);
      if (looseCollection) { await addLooseGroups(own.files, own.sidecars); return; }
      books.push({ path: folder, folder, mode: 'folder', files: own.files,
        signature: fileSignature([...own.files, ...own.sidecars]), identity: digest(own.files.map(f => f.identity).sort()),
        metadataFile: metadata ? path.join(folder, metadata.name) : undefined,
        associatedFiles: own.sidecars.map(file => ({ path: path.join(folder, file.name), kind: /\.json$/i.test(file.name) ? 'metadata' : 'cover' })) });
    }
  };
  await walk(root);
  return books;
}

export async function identifyBook(book: DiskBook, probe: (file: string) => Promise<Record<string, unknown>>, existing?: AudiobookMetadata,
  readCover?: (file: string) => Promise<CoverArtInfo | undefined>) {
  const fallback = book.title || (book.mode === 'folder' ? path.basename(book.folder) : path.basename(book.path, path.extname(book.path)));
  let warning = '';
  let sidecar: Partial<AudiobookMetadata> = {};
  const sidecarPaths = book.metadataFile ? [...new Set([
    ...(book.associatedFiles || []).filter(file => file.kind === 'metadata' && pathKey(path.dirname(file.path)) === pathKey(book.folder) && /^(exmetadata|metadata)\.json$/i.test(path.basename(file.path))).map(file => file.path), ...(pathKey(path.dirname(book.metadataFile)) === pathKey(book.folder) ? [book.metadataFile] : []),
  ])].sort((a,b) => Number(path.basename(a).toLowerCase() === 'exmetadata.json') - Number(path.basename(b).toLowerCase() === 'exmetadata.json')) : [];
  for (const sidecarPath of sidecarPaths) {
    try {
      const info = await fs.stat(sidecarPath);
      if (info.size > 4 * 1024 * 1024) throw new Error('metadata.json is too large');
      const json = JSON.parse(await fs.readFile(sidecarPath, 'utf8'));
      const raw = path.basename(sidecarPath).toLowerCase() === 'exmetadata.json' ? readExtendedMetadata(json) : json.metadata || json;
      if (!raw || typeof raw !== 'object') throw new Error('Invalid metadata.json');
      // Accept SwissMouse fields as well as the existing ABS export mapping.
      for (const field of ['title', 'subtitle', 'author', 'narrator', 'seriesSequence', 'publishedYear', 'publisher', 'edition', 'description', 'isbn', 'asin', 'language', 'copyright', 'releaseDate'] as const)
        if (typeof raw[field] === 'string' || typeof raw[field] === 'number') (sidecar as any)[field] = String(raw[field]);
      for (const field of ['genres', 'tags'] as const) if (Array.isArray(raw[field])) sidecar[field] = raw[field].filter((v: unknown) => typeof v === 'string');
      for (const field of ['abridged', 'explicit'] as const) if (typeof raw[field] === 'boolean') sidecar[field] = raw[field];
      if (Array.isArray(raw.authors)) { sidecar.authors = raw.authors.filter((v: unknown) => typeof v === 'string'); if (!(path.basename(sidecarPath).toLowerCase() === 'exmetadata.json' && Object.hasOwn(raw,'author'))) sidecar.author = sidecar.authors!.join(', '); }
      if (Array.isArray(raw.narrators)) { sidecar.narrators = raw.narrators.filter((v: unknown) => typeof v === 'string'); if (!(path.basename(sidecarPath).toLowerCase() === 'exmetadata.json' && Object.hasOwn(raw,'narrator'))) sidecar.narrator = sidecar.narrators!.join(', '); }
      if (typeof raw.publishedDate === 'string' && !Object.hasOwn(raw,'releaseDate')) sidecar.releaseDate = raw.publishedDate;
      if (typeof raw.series === 'string') sidecar.series = raw.series;
      else if (Array.isArray(raw.series) && typeof raw.series[0] === 'string') {
        const match = /^(.*?)\s+#([^#]+)$/.exec(raw.series[0]);
        sidecar.series = match ? match[1] : raw.series[0];
        if (match) sidecar.seriesSequence = match[2];
      }
      if (typeof raw.seriesAddedAt === 'string') sidecar.seriesAddedAt = raw.seriesAddedAt;
      if (raw.collections !== undefined) sidecar.collections = cleanMemberships(raw.collections);
      if (raw.additionalSeries !== undefined) sidecar.additionalSeries = cleanMemberships(raw.additionalSeries);
      if (raw.cover === null) sidecar.cover = null;
    } catch (error: any) { warning += `${warning ? '; ' : ''}Could not read ${path.basename(sidecarPath)}: ${error.message}`; }
  }
  let tags: Record<string, unknown> = {};
  {
    try { tags = await probe(path.join(book.folder, book.files[0].name)); }
    catch { if (!sidecar.title || !sidecar.author) warning ||= 'Embedded metadata unavailable'; }
    if (book.files.length > 1) {
      try {
        const last = await probe(path.join(book.folder, book.files[book.files.length - 1].name));
        const firstTitle = metadataFromTags(tags, '', false).title;
        const lastTitle = metadataFromTags(last, '', false).title;
        if (firstTitle && lastTitle && firstTitle.trim().toLowerCase() !== lastTitle.trim().toLowerCase()) warning ||= 'Multiple possible book titles detected';
      } catch { /* First-file metadata remains usable. */ }
    }
  }
  const embedded = metadataFromTags(tags, '', book.files.length === 1);
  if (book.files.length === 1 && /\.m4b$/i.test(book.files[0].name)) {
    const title = Object.entries(tags).find(([key]) => key.toLowerCase() === 'title')?.[1];
    // Whole-book M4Bs often share a series ALBUM. A chapter label is not a
    // useful replacement, but a named whole-book TITLE is.
    if (typeof title === 'string' && title.trim() && !/^(?:chapter|track|part|disc|cd)\s*[\d.ivxlcdm]+$/i.test(title.trim())) embedded.title = title.trim();
  }
  const metadata = { ...metadataFromTags({}, fallback), ...existing };
  for (const [key, value] of Object.entries(embedded)) if (value && (!Array.isArray(value) || value.length)) (metadata as any)[key] = value;
  Object.assign(metadata, sidecar);
  if (!sidecar.title && !embedded.title && !existing?.title) warning ||= book.mode === 'folder' ? 'Book title inferred from folder name' : 'Book title inferred from filename';
  if (!metadata.title) metadata.title = fallback;
  if (!metadata.author) warning ||= 'Metadata incomplete: author is missing';
  for (const file of (sidecar.cover === null ? [] : book.associatedFiles || []).filter(file => file.kind === 'cover').map(file => file.path)) {
    try {
      const name = path.basename(file);
      const info = await fs.lstat(file);
      if (info.isFile() && info.size <= 10 * 1024 * 1024) metadata.cover = { source: 'local', filename: name, url: `data:image/${/\.png$/i.test(name) ? 'png' : /\.webp$/i.test(name) ? 'webp' : 'jpeg'};base64,${(await fs.readFile(file)).toString('base64')}` };
      break;
    } catch { /* Optional artwork. */ }
  }
  if (sidecar.cover !== null && !metadata.cover && readCover && book.files.length) {
    // Match the first/last metadata sample; avoid probing every chapter of a
    // large multipart book just to establish that it has no embedded artwork.
    for (const name of new Set([book.files[0].name, book.files[book.files.length - 1].name])) {
      try {
        const cover = await readCover(path.join(book.folder, name));
        if (cover) { metadata.cover = cover; break; }
      } catch { warning ||= 'Embedded cover unavailable'; }
    }
  }
  return { metadata, warning: warning || undefined };
}

export type MoveEntry = { source: string; name: string; stamp: FileStamp };
export type CopiedFile = { name: string; stamp: FileStamp; hash: string };
// Copy into a private staging directory. The caller commits paths to its existing
// project store before removing any originals. Failure leaves source untouched.
export async function verifiedCopy(root: string, target: string, entries: MoveEntry[], log: (message: string) => void, onReserved?: (owned: CopiedFile[]) => void, canLinkSource?: (entry: MoveEntry) => boolean) {
  if (!within(root, target)) throw new Error('Destination must be inside the Library folder.');
  await assertUnlinked(root);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('Library folder is unavailable.');
  let parent = root;
  for (const segment of path.relative(root, path.dirname(target)).split(path.sep).filter(Boolean)) {
    parent = path.join(parent, segment);
    try { await fs.mkdir(parent); } catch (error: any) { if (error.code !== 'EEXIST') throw error; }
    await assertUnlinked(parent);
  }
  try { await fs.lstat(target); throw new Error('A book already exists at the destination. Change the title or folder pattern before retrying.'); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  const stage = path.join(path.dirname(target), `.swissmouse-${randomUUID()}.partial`);
  await fs.mkdir(stage);
  let reserved = false;
  const owned: CopiedFile[] = [];
  try {
    const names = new Set<string>();
    for (const entry of entries) {
      const destination = path.resolve(stage, entry.name);
      if (!within(stage, destination) || names.has(pathKey(destination))) throw new Error(`Duplicate or unsafe destination filename: ${entry.name}`);
      names.add(pathKey(destination));
      await assertUnlinked(entry.source);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      // A same-volume move can publish a second name for the same file. Originals
      // stay accessible until commit and verified cleanup. Copies and shared files
      // must remain independent; unsupported/cross-volume links use verified copy.
      let linked = false;
      if (canLinkSource?.(entry)) {
        try { await fs.link(entry.source, destination); linked = true; }
        catch (error: any) { if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK'].includes(error.code)) throw error; }
      }
      if (!linked) {
        await fs.copyFile(entry.source, destination, fs.constants.COPYFILE_EXCL);
        await fs.utimes(destination, new Date(entry.stamp.mtime), new Date(entry.stamp.mtime));
      }
      const copied = await stamp(destination, entry.name);
      const source = await stamp(entry.source, entry.stamp.name);
      if (copied.size !== entry.stamp.size || source.identity !== entry.stamp.identity || fileSignature([source]) !== fileSignature([entry.stamp])) throw new Error(`File changed during copy: ${entry.name}`);
      const hash = await contentHash(destination);
      if (!linked && await contentHash(entry.source) !== hash) throw new Error(`Copy verification failed: ${entry.name}`);
      if (linked && copied.identity !== source.identity) throw new Error(`Move identity verification failed: ${entry.name}`);
      const checkedSource = await stamp(entry.source, entry.stamp.name);
      if (checkedSource.identity !== source.identity || fileSignature([checkedSource]) !== fileSignature([source])) throw new Error(`File changed during verification: ${entry.name}`);
      owned.push({ name: entry.name, stamp: await stamp(destination, entry.name), hash });
      const handle = await fs.open(destination, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
      log(`Transferred and SHA-256 verified: ${entry.source} -> ${entry.name}`);
    }
    const copied = await inventory(stage);
    if (copied.length !== entries.length) throw new Error('Destination file count differs from the source.');
    log(`Move verification passed: ${copied.length} accessible files; relative names and sizes match.`);
    // mkdir exclusively reserves the name; rename would overwrite on POSIX.
    await fs.mkdir(target); reserved = true;
    onReserved?.(owned);
    for (const file of owned) {
      const staged = path.join(stage, file.name), destination = path.join(target, file.name);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await assertUnlinked(path.dirname(destination));
      // Hard links publish without overwriting a late collision on any platform.
      // The private stage is on the same volume. FAT/network volumes can use an
      // exclusive copy instead, retaining the same no-overwrite guarantee.
      try { await fs.link(staged, destination); }
      catch (error: any) {
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(error.code)) throw error;
        await fs.copyFile(staged, destination, fs.constants.COPYFILE_EXCL);
        file.stamp = await stamp(destination, file.name);
        const handle = await fs.open(destination, 'r+');
        try { await handle.sync(); } finally { await handle.close(); }
        if (await contentHash(destination) !== file.hash) throw new Error(`Copy verification failed: ${file.name}`);
      }
      file.stamp = await stamp(destination, file.name);
    }
    await fs.rm(stage, { recursive: true });
    const final = await inventory(target);
    const expected = entries.map(entry => [path.normalize(entry.name), entry.stamp.size]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    if (JSON.stringify(final.map(file => [file.name, file.size])) !== JSON.stringify(expected)) throw new Error('Destination verification failed.');
    return owned;
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    if (reserved) await rollbackCopiedFiles(target, owned);
    throw error;
  }
}

// A reserved folder can still gain unrelated files while a copy is running.
// Roll back only unchanged files with the identities we actually published.
export async function rollbackCopiedFiles(target: string, owned: CopiedFile[]) {
  const directories = new Set([target]);
  for (const file of owned) {
    const destination = path.resolve(target, file.name);
    if (!within(target, destination)) continue;
    try {
      await assertUnlinked(destination);
      const current = await stamp(destination, file.name);
      if (current.identity !== file.stamp.identity || fileSignature([current]) !== fileSignature([file.stamp]) || await contentHash(destination) !== file.hash) continue;
      await fs.unlink(destination);
      for (let parent = path.dirname(destination); within(target, parent); parent = path.dirname(parent)) directories.add(parent);
    } catch { /* Retain changed files or unavailable paths for recovery. */ }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    try { await fs.rmdir(directory); } catch { /* Only empty folders are ours to remove. */ }
  }
}
