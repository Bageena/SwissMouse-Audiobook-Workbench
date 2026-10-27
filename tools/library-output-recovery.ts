import fs from 'node:fs/promises';
import path from 'node:path';
import type { AudiobookJob } from '../src/types';
import { assertUnlinked, pathKey, stamp, fileSignature, within, type DiskBook } from './library-filesystem';

type OutputInspection = { durationSeconds: number; codec: string; chapters: unknown[] };

// Recover an exported file moved inside its own book folder. Source membership
// is deliberately untouched: a finished audiobook is not its original tracks.
export async function recoverRelocatedOutput(job: AudiobookJob, disk: DiskBook,
  probe: (file: string) => Promise<OutputInspection>, claimed: (file: string) => boolean = () => false): Promise<string | undefined> {
  const output = job.outputM4b, previous = output?.fullPath;
  if (!output || !previous || !within(disk.folder, previous) || !output.sizeBytes || !output.duration) return;
  try { await fs.lstat(previous); return; } catch (error: any) { if (error.code !== 'ENOENT') return; }
  const candidates = disk.files.filter(file => (output.fileIdentity ? file.identity === output.fileIdentity : path.basename(file.name).toLowerCase() === path.basename(previous).toLowerCase()) &&
    file.size === output.sizeBytes && !claimed(path.join(disk.folder, file.name)));
  if (candidates.length !== 1) return;
  const candidate = path.join(disk.folder, candidates[0].name);
  await assertUnlinked(candidate);
  const before = await stamp(candidate);
  const media = await probe(candidate);
  if (Math.abs(media.durationSeconds - output.duration) > .15 || media.codec !== output.codec || media.chapters.length !== output.chaptersCount) return;
  const after = await stamp(candidate);
  if (before.identity !== after.identity || fileSignature([before]) !== fileSignature([after])) return;

  const mapping = new Map([[pathKey(previous), candidate]]);
  // Known companions can follow the same directory relocation, but only when
  // their old path is gone and the new path is a regular, unclaimed file.
  for (const file of job.associatedFiles || []) {
    if (pathKey(path.dirname(file.path)) !== pathKey(path.dirname(previous))) continue;
    try { await fs.lstat(file.path); continue; } catch (error: any) { if (error.code !== 'ENOENT') continue; }
    const next = pathKey(file.path) === pathKey(previous + '.cue') ? candidate + '.cue' : path.join(path.dirname(candidate), path.basename(file.path));
    if (claimed(next)) continue;
    try { await assertUnlinked(next); await stamp(next); mapping.set(pathKey(file.path), next); } catch { /* Missing companions remain recoverable. */ }
  }
  const remap = (file?: string) => file ? mapping.get(pathKey(file)) || file : file;
  output.fullPath = candidate;
  output.filename = path.basename(candidate);
  output.fileIdentity = after.identity;
  for (const item of job.exports || []) { item.fullPath = remap(item.fullPath); item.coverPath = remap(item.coverPath); if (item.fullPath === candidate) item.filename = path.basename(candidate); }
  if (job.originalsArchive && mapping.has(pathKey(job.originalsArchive.path))) {
    job.originalsArchive = { ...job.originalsArchive, path: remap(job.originalsArchive.path)! };
    job.originalsArchive.stamp = await stamp(job.originalsArchive.path);
  }
  for (const format of Object.keys(job.exportedFiles || {}) as (keyof NonNullable<AudiobookJob['exportedFiles']>)[]) job.exportedFiles![format] = remap(job.exportedFiles![format]);
  job.associatedFiles = [...new Map((job.associatedFiles || []).map(file => {
    const next = { ...file, path: remap(file.path)! }; return [pathKey(next.path), next] as const;
  })).values()];
  job.processingStatus = 'incomplete';
  job.staleSteps = [...new Set([...(job.staleSteps || []), 'validation' as const])];
  job.logs = [...job.logs, { timestamp: new Date().toISOString(), level: 'INFO', message: `Located relocated audiobook: ${previous} -> ${candidate}. Original source membership retained; run the final check again.` }];
  return candidate;
}
