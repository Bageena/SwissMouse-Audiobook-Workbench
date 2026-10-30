import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { outputFormats } from './audio-formats';
import { audiobookTags } from './audio-metadata';
import { planChapterExport } from './chapter-export';
import type { AudiobookCompletionPorts, CompletionInput, CompletionReply } from './completion-ports';
import { completionReply as reply } from './completion-ports';
import type { ChapterEntry } from './domain';
import type { AudiobookJob, OutputAudioFormat } from './legacy-domain';
import { writeMetadataSidecars } from './metadata-sidecars';
const execFileAsync = promisify(execFile);

export function createCompletionMetadata(host: AudiobookCompletionPorts) {
  const state = host.state;
  function savedAudiobookshelfPaths(job: AudiobookJob): string[] {
    const exports = host.source.exportedAudioPaths(job);
    return exports.length ? exports : host.source.sourceLocation(job) === 'managed' ? host.source.sourceFilePaths(job).filter(file => fs.existsSync(file)) : [];
  }

  function writeAudiobookshelfJson(job: AudiobookJob, files = host.source.exportedAudioPaths(job)): string[] {
    if (!job.metadata)
      throw new Error('Save book metadata before updating exmetadata.json.');
    if (!files.length)
      throw new Error('Export an audiobook before updating exmetadata.json.');
    let chapters: ChapterEntry[] = [];
    try {
      chapters = planChapterExport(job.chapters, job.totalDurationSeconds).chapters as ChapterEntry[];
    }
    catch { /* Metadata remains usable if chapter edits have not been finalized. */ }
    return writeMetadataSidecars(job.metadata, chapters, files.map(file => path.dirname(path.resolve(file))), {
      audiobookshelf: host.config.audiobookshelf_metadata, resourceId: job.id,
      assertOwnership: folder => host.files.assertSidecarOwnership(job, folder, host.store.projects, host.source.sourceFilePaths, host.files.extensions),
      associate: file => host.source.associateProjectFile(job, file, 'metadata'),
    });
  }

  async function writeCoverImage(folder: string, url: string, basename: string): Promise<string> {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(url);
    if (!match)
      throw new Error('Save a PNG, JPEG or WebP cover before exporting.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
      throw new Error('Cover image is empty or too large.');
    await fs.promises.mkdir(folder, { recursive: true });
    const output = path.join(folder, basename + (match[1] === 'jpeg' ? '.jpg' : '.png'));
    const stage = output + '.' + randomUUID() + '.tmp';
    const input = path.join(folder, '.swissmouse-cover-' + randomUUID() + '.webp');
    try {
      if (match[1] === 'webp') {
        await fs.promises.writeFile(input, bytes, { flag: 'wx' });
        await execFileAsync(host.media.ffmpeg(), ['-v', 'error', '-i', input, '-frames:v', '1', '-c:v', 'png', '-f', 'image2', stage], { windowsHide: true, timeout: 30000 });
      }
      else
        await fs.promises.writeFile(stage, bytes, { flag: 'wx' });
      await fs.promises.rename(stage, output);
      return output;
    }
    finally {
      await fs.promises.unlink(input).catch(() => { });
      await fs.promises.unlink(stage).catch(() => { });
    }
  }

  async function postLibraryWriteAudioMetadata(input: CompletionInput): Promise<CompletionReply> {
    const job = host.store.get(input.params.id);
    if (!job)
      return reply(404, { error: 'Book not found.' });
    if (!job.metadata)
      return reply(400, { error: 'Save book metadata before writing an audio file.' });
    if (host.work.processing || host.work.imports.size || state.validating || job.exports?.some(item => item.status === 'queued' || item.status === 'running'))
      return reply(409, { error: 'Wait for current processing to finish.' });
    if (state.metadataWriters.has(job.id))
      return reply(409, { error: 'Metadata is already being written to this book.' });
    const exported = (job.exports || []).filter(item => item.status === 'success' && item.fullPath);
    const writingSources = !exported.length;
    const originalPaths = host.source.sourceFilePaths(job);
    const sourceWasCurrent = !writingSources || !job.sourceKey || job.sourceKey === await host.source.sourceFingerprint(job, originalPaths).catch(() => undefined);
    const outputs = exported.length ? exported : originalPaths.filter(file => fs.existsSync(file)).map(file => ({ fullPath: file, format: path.extname(file).slice(1).toLowerCase() as OutputAudioFormat, status: 'success' as const }));
    if (!outputs.length)
      return reply(400, { error: 'No audiobook file is available for metadata writing.' });
    state.metadataWriters.add(job.id);
    const written: string[] = [];
    const failures: string[] = [];
    try {
      for (const item of outputs) {
        const file = path.resolve(item.fullPath!);
        try {
          if (host.store.projects.some(other => other.id !== job.id && host.source.sourceFilePaths(other).some(source => host.files.pathKey(source) === host.files.pathKey(file))))
            throw new Error('This file is shared with another project. Keep it unchanged or export a separate copy first.');
          if (job.mergedMp3?.fullPath && file === path.resolve(job.mergedMp3.fullPath) && !writingSources)
            throw new Error('The processing master cannot be changed here.');
          const tagFormat = item.format === ('mp4' as string) ? 'm4b' : item.format;
          if (!outputFormats.includes(tagFormat))
            throw new Error('This source format does not support metadata writing.');
          const original = host.media.inspect(host.media.ffprobe(), file);
          const tags = audiobookTags(job.metadata, undefined, Object.fromEntries(Object.entries(original.tags).map(([key, value]) => [key, String(value)])), tagFormat);
          if (writingSources && outputs.length > 1 && original.tags.title)
            tags[['flac', 'ogg', 'opus'].includes(tagFormat) ? 'TITLE' : 'title'] = String(original.tags.title);
          let cover: string | null | undefined;
          if (['m4b', 'm4a', 'mp3', 'flac'].includes(tagFormat))
            cover = job.metadata.cover?.url ? await writeCoverImage(host.source.projectIntermediatesDir(job), job.metadata.cover.url, 'tag-cover-' + randomUUID()) : job.metadata.cover === null ? null : undefined;
          let result: Awaited<ReturnType<typeof host.media.writeMetadata>>;
          try {
            result = await host.media.writeMetadata({ ffmpeg: host.media.ffmpeg(), ffprobe: host.media.ffprobe(), file, format: tagFormat, tags, cover });
          }
          finally {
            if (typeof cover === 'string')
              fs.rmSync(cover, { force: true });
          }
          const outputStamp = await host.files.stamp(file);
          if ('fileIdentity' in item)
            item.fileIdentity = outputStamp.identity;
          if (job.outputM4b?.fullPath === file)
            job.outputM4b.fileIdentity = outputStamp.identity;
          if (writingSources) {
            const index = originalPaths.findIndex(source => host.files.pathKey(source) === host.files.pathKey(file));
            if (index >= 0) {
              job.parts[index].sizeBytes = result.sizeBytes;
              const root = host.source.bookSourceRoot(job);
              const relative = host.source.sourceRelative(job, job.parts[index]);
              if (root) {
                const observed = host.source.bookFileStamp(root, relative);
                if (observed) {
                  job.sourceFileStamps ||= {};
                  job.sourceFileStamps[relative] = observed;
                }
              }
            }
            if (job.mergedMp3?.fullPath && host.files.pathKey(job.mergedMp3.fullPath) === host.files.pathKey(file))
              job.mergedMp3.sizeBytes = result.sizeBytes;
          }
          if ('verifiedTags' in item)
            item.verifiedTags = result.verifiedTags;
          if (job.outputM4b?.fullPath === item.fullPath)
            job.outputM4b.sizeBytes = result.sizeBytes;
          written.push(file);
          job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'INFO', message: `Wrote metadata to audiobook file: ${file}` });
        }
        catch (error: any) {
          failures.push(`${item.format.toUpperCase()}: ${error.message}`);
          job.logs.push({ timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19), level: 'ERROR', message: `Could not write metadata to ${file}: ${error.message}` });
        }
        host.store.save();
      }
      if (written.length) {
        job.validation = null;
        job.processingStatus = 'incomplete';
        if (writingSources && sourceWasCurrent) {
          job.sourceKey = await host.source.sourceFingerprint(job, originalPaths);
          if (job.retainedWaveform)
            job.retainedWaveform.sourceKey = job.sourceKey;
        }
        job.staleSteps = failures.length ? job.staleSteps : (job.staleSteps || []).filter(step => step !== 'export');
        host.store.save();
      }
      return reply(written.length ? 200 : 500, { written, failures, error: failures.length ? failures.join('; ') : undefined });
    }
    finally {
      state.metadataWriters.delete(job.id);
    }
  }
  return { savedAudiobookshelfPaths, writeAudiobookshelfJson, writeCoverImage, postLibraryWriteAudioMetadata };
}
export type CompletionMetadata = ReturnType<typeof createCompletionMetadata>;
