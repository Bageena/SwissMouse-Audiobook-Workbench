import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AudiobookJob } from '../src/types';
import type { PlaybackManifest, PlaybackSegment } from '../src/playback/types';
import { parseChapterTimestamp } from '../src/utils/chapters';
import { inspectAsync } from './audio-engine';
import { MediaCache } from './media-cache';

export interface PlaybackMediaInspection {
  durationSeconds: number;
  chapters?: { start: string; title: string }[];
}

export interface FinalizedPlaybackAlternative {
  id: string;
  /** Multiple files here are one ordered export; separate formats are alternatives. */
  files: { id: string; path: string; title?: string }[];
  sourceTimelineSignature?: string;
}

export interface BookPlaybackOptions {
  /** Resolved from job.parts, in its persisted processing order. Never directory inventory. */
  sourcePaths: string[];
  ffprobe: string;
  inspect?: (ffprobe: string, file: string) => Promise<PlaybackMediaInspection>;
  finalizedAlternatives?: FinalizedPlaybackAlternative[];
  preferFinalized?: boolean;
}

const observations = new MediaCache<PlaybackMediaInspection>(inspectAsync, 3);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Millisecond stamps match verified copies, which preserve mtime through Date. */
export function playbackFileSignature(id: string, size: number, modifiedMs: number, durationSeconds: number) {
  return digest([id, size, Math.trunc(modifiedMs), durationSeconds]);
}

function recordedAlternatives(job: AudiobookJob): FinalizedPlaybackAlternative[] {
  const successful = (job.exports || []).filter(item => item.status === 'success' && item.fullPath);
  const preference = ['m4b', 'm4a', 'mp3', 'flac', 'opus', 'ogg', 'wav'];
  successful.sort((a, b) => preference.indexOf(a.format) - preference.indexOf(b.format));
  const alternatives: FinalizedPlaybackAlternative[] = successful.map(item => ({ id: item.format, sourceTimelineSignature: item.playbackSourceSignature,
    files: [{ id: 'finalized-' + item.format, path: item.fullPath!, title: job.metadata?.title || job.name }] }));
  const output = job.outputM4b;
  if (output?.fullPath && ['built', 'validated'].includes(job.status) &&
      !alternatives.some(item => path.resolve(item.files[0].path) === path.resolve(output.fullPath!))) {
    const format = output.format || path.extname(output.fullPath).slice(1) || 'audio';
    alternatives.push({ id: format, sourceTimelineSignature: output.playbackSourceSignature,
      files: [{ id: 'finalized-' + format, path: output.fullPath, title: job.metadata?.title || job.name }] });
  }
  return alternatives;
}

/** Header inspection is cached and bounded. Absolute media paths never enter the client manifest. */
export async function buildBookPlaybackManifest(job: AudiobookJob, options: BookPlaybackOptions): Promise<{ manifest: PlaybackManifest; files: string[] }> {
  const inspect = options.inspect || ((tool, file) => observations.read(tool, file));
  const observe = async (entries: { id: string; path: string; title?: string }[], kind: PlaybackManifest['kind'], sourceTimelineSignature?: string) => {
    if (!entries.length) throw new Error('This book has no associated audio files to play.');
    if (new Set(entries.map(entry => entry.id)).size !== entries.length || entries.some(entry => !entry.id)) throw new Error('The book contains invalid audio identities. Review its source files.');
    const values = await Promise.all(entries.map(async entry => {
      try {
        const before = await fs.stat(entry.path);
        if (!before.isFile()) throw new Error('Not a regular audio file');
        const media = await inspect(options.ffprobe, entry.path);
        const after = await fs.stat(entry.path);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error('Audio changed during inspection');
        if (!Number.isFinite(media.durationSeconds) || media.durationSeconds <= 0) throw new Error('No readable audio duration');
        return { entry, media, signature: playbackFileSignature(entry.id, after.size, after.mtimeMs, media.durationSeconds) };
      } catch (error: unknown) {
        throw new Error(`Cannot play ${entry.title || path.basename(entry.path)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
    let elapsed = 0;
    const chapters: NonNullable<PlaybackManifest['chapters']> = [];
    const segments: PlaybackSegment[] = values.map(({ entry, media, signature }) => {
      const startSeconds = elapsed;
      for (const chapter of media.chapters || []) {
        const start = parseChapterTimestamp(chapter.start);
        if (start !== null && start >= 0 && start / 1000 < media.durationSeconds) chapters.push({ startSeconds: startSeconds + start / 1000, title: chapter.title });
      }
      elapsed += media.durationSeconds;
      return { id: entry.id, title: entry.title || path.basename(entry.path), durationSeconds: media.durationSeconds, startSeconds, signature, url: '' };
    });
    const signature = digest([job.id, kind, segments.map(({ id, signature }) => [id, signature])]);
    if (kind === 'source' && !job.sourceFilesChanged && !job.staleSteps?.includes('chapter_review')) {
      const reviewed = (job.chapters || []).flatMap(chapter => {
        const start = chapter.isMissing ? null : parseChapterTimestamp(chapter.start);
        return start !== null && start >= 0 && start / 1000 < elapsed ? [{ title: chapter.title, startSeconds: start / 1000 }] : [];
      });
      if (reviewed.length) chapters.splice(0, chapters.length, ...reviewed);
    }
    chapters.sort((a, b) => a.startSeconds - b.startSeconds);
    for (const segment of segments) segment.url = `/api/jobs/${encodeURIComponent(job.id)}/playback/segments/${encodeURIComponent(segment.id)}?signature=${signature}`;
    return { manifest: { bookId: job.id, signature, kind, segments, totalDurationSeconds: elapsed,
      ...(chapters.length ? { chapters } : {}), ...(sourceTimelineSignature ? { sourceTimelineSignature } : {}) }, files: entries.map(entry => entry.path) };
  };

  let outputError: unknown;
  if (options.preferFinalized !== false && !job.sourceFilesChanged && !job.staleSteps?.includes('export')) {
    for (const alternative of options.finalizedAlternatives ?? recordedAlternatives(job)) {
      try { return await observe(alternative.files, 'finalized', alternative.sourceTimelineSignature); }
      catch (error) { outputError = error; }
    }
  }
  if (!job.parts.length && outputError) throw outputError;
  if (options.sourcePaths.length !== job.parts.length) throw new Error('The book’s source selection changed. Refresh it before playing.');
  return observe(job.parts.map((part, index) => ({ part, file: options.sourcePaths[index] }))
    .sort((a, b) => (a.part.order || 0) - (b.part.order || 0))
    .map(({ part, file }) => ({ id: part.id, path: file, title: part.sourceRelativePath || part.name })), 'source');
}
