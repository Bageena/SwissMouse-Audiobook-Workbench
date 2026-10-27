import fs from 'node:fs';
import path from 'node:path';
import type { AudiobookJob } from '../src/types';
import type { CatalogProject } from './catalog-projection';

const key = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const within = (root: string, file: string) => { const relative = path.relative(root,file); return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

export function catalogArchiveCurrent(archive: AudiobookJob['originalsArchive'], sourceKey: string | undefined, paths: string[]): boolean {
  if (!archive || archive.sourceKey !== sourceKey) return false;
  try {
    const info = fs.lstatSync(archive.path);
    const originals = new Map(archive.files.map(file => [key(file.source),file]));
    return info.isFile() && !info.isSymbolicLink() && `${info.dev}:${info.ino}` === archive.stamp.identity && info.size === archive.stamp.size && info.mtimeMs === archive.stamp.mtime && paths.every(file => {
      const original = originals.get(key(file));
      if (!original) return false;
      if (!fs.existsSync(file)) return true;
      const current = fs.lstatSync(file);
      return current.isFile() && !current.isSymbolicLink() && current.size === original.stamp.size && current.mtimeMs === original.stamp.mtime;
    });
  } catch { return false; }
}

export function findAvailableM4b(root: string, candidates: (string | undefined)[]): string | undefined {
  let realRoot: string;
  try { realRoot = fs.realpathSync(root); } catch { return; }
  for (const file of candidates) {
    if (!file || path.extname(file).toLowerCase() !== '.m4b') continue;
    try { if (fs.statSync(file).isFile() && within(realRoot,fs.realpathSync(file))) return file; } catch { /* Preserve unavailable records. */ }
  }
}

/** Run only during indexing, on the worker. Browse requests never probe source disks. */
export function observeCatalogProject(record: CatalogProject): CatalogProject {
  const observed = record.observation;
  if (!observed) return record;
  let missing = observed.invalidSource;
  const signatures: string[] = [];
  for (const file of observed.sourcePaths) {
    try { const info=fs.statSync(file); signatures.push(`${key(file)}:${info.size}:${info.mtimeMs}`); }
    catch { signatures.length=0; break; }
  }
  if (!missing && !catalogArchiveCurrent(observed.archive,observed.sourceKey,observed.sourcePaths)) {
    missing = observed.sourcePaths.some(file => { try { return !fs.statSync(file).isFile(); } catch { return true; } });
  }
  const available = missing ? findAvailableM4b(observed.libraryRoot,observed.m4bCandidates) : undefined;
  return { ...record, match:record.match && { ...record.match,sourceSignature:signatures.join('|') }, book: { ...record.book, sourceMissing: !available && (missing || !!record.book.sourceMissing),
    originalSourceMissing: missing && !!available, availableM4bPath:available,
    ...(available ? { formats:['M4B'], rootType:'library',rootTypes:['library'],sourceLocation:'managed',representations:record.book.representations?.map(item => ({ ...item,path:available,formats:['M4B'] })) } : {}),
  } };
}
