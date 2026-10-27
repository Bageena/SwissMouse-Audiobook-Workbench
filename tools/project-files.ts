import fs from 'node:fs';
import path from 'node:path';
import type { AudiobookJob } from '../src/types';
import { pathKey, within } from './library-filesystem';

export type ProjectFileRole = 'source' | 'output' | 'metadata' | 'cover' | 'chapters' | 'sidecar';
export type ProjectFile = { path: string; roles: ProjectFileRole[] };

// The existing persisted associations remain authoritative. A containing folder
// is only a path base, never permission to transfer everything inside it.
export function projectFiles(job: AudiobookJob, sourceFiles: string[]): ProjectFile[] {
  const files = new Map<string, ProjectFile>();
  const add = (file: string | undefined, role: ProjectFileRole) => {
    if (!file) return;
    const key = pathKey(file), entry = files.get(key) || { path: path.resolve(file), roles: [] };
    if (!entry.roles.includes(role)) entry.roles.push(role);
    files.set(key, entry);
  };
  sourceFiles.forEach(file => add(file, 'source'));
  Object.values(job.exportedFiles || {}).forEach(file => add(file, 'output'));
  add(job.outputM4b?.fullPath, 'output');
  for (const output of job.exports || []) if (output.status === 'success') { add(output.fullPath, 'output'); add(output.coverPath, 'cover'); }
  for (const file of job.associatedFiles || []) add(file.path, file.kind);
  add(job.originalsArchive?.path, 'sidecar');
  return [...files.values()];
}

export function assertSidecarOwnership(job: AudiobookJob, folder: string, jobs: AudiobookJob[],
  sources: (job: AudiobookJob) => string[], extensions: Set<string>) {
  const target = path.join(folder, 'exmetadata.json');
  const owned = new Set(projectFiles(job, sources(job)).map(file => pathKey(file.path)));
  const conflicting = jobs.some(other => other.id !== job.id && !other.libraryScan?.superseded &&
    projectFiles(other, sources(other)).some(file => (pathKey(file.path) === pathKey(target) || pathKey(file.path) === pathKey(path.join(folder, 'metadata.json'))) ||
      (extensions.has(path.extname(file.path).slice(1).toLowerCase()) && pathKey(path.dirname(file.path)) === pathKey(folder))));
  const unassigned = fs.readdirSync(folder, { withFileTypes: true }).some(entry =>
    entry.isFile() && extensions.has(path.extname(entry.name).slice(1).toLowerCase()) && !owned.has(pathKey(path.join(folder, entry.name))));
  if (conflicting || unassigned) throw new Error(`Book details are kept in SwissMouse. metadata.json was not changed; exmetadata.json was not written because ${folder} contains audio or a sidecar belonging to another book. Organize this book into its own folder first.`);
  if (!within(folder, target)) throw new Error('Unsafe metadata location.');
}
