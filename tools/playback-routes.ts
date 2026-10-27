import type { Express } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AudiobookJob } from '../src/types';
import { createBookmark, locatePosition, resolveBookmark } from '../src/playback/timeline';
import { buildBookPlaybackManifest, playbackFileSignature, type PlaybackMediaInspection } from './book-playback';
import { ListeningStore, type ListeningSequence } from './listening-store';
import { asyncRoute } from './api-route';

interface PlaybackServices {
  jobs: () => AudiobookJob[];
  getJob?: (id: string) => AudiobookJob | undefined;
  saveJobs: () => void;
  listening: ListeningStore;
  sourcePaths: (job: AudiobookJob) => string[];
  ffprobe: () => string;
  inspect: (ffprobe: string, file: string) => Promise<PlaybackMediaInspection>;
}

/** Authorize streams from explicit book manifests; never accept client file paths. */
export function registerPlaybackRoutes(app: Express, services: PlaybackServices): void {
  type Context = Awaited<ReturnType<typeof buildBookPlaybackManifest>> & { selection: string };
  const manifests = new Map<string, Context>();
  const selection = (job: AudiobookJob) => JSON.stringify({
    parts: job.parts.map(p => [p.id, p.name, p.sourceRelativePath, p.order]), source: [job.sourceFolderPath, job.source],
    outputs: (job.exports || []).map(e => [e.format, e.status, e.fullPath, e.playbackSourceSignature]),
    output: [job.outputM4b?.fullPath, job.outputM4b?.playbackSourceSignature],
    changed: job.sourceFilesChanged, stale: job.staleSteps?.includes('export'),
  });
  const remember = (context: Context) => {
    manifests.delete(context.manifest.signature);
    manifests.set(context.manifest.signature, context);
    while (manifests.size > 128) manifests.delete(manifests.keys().next().value!);
  };

  app.get('/api/jobs/:id/playback', asyncRoute(async (req, res) => {
    const job = (services.getJob ? services.getJob(req.params.id) : services.jobs().find(item => item.id === req.params.id));
    if (!job) return res.status(404).json({ error: 'Book not found.' });
    const selected = selection(job);
    let sourcePaths: string[] = [];
    try { sourcePaths = services.sourcePaths(job); } catch { /* A valid finalized output can survive missing sources. */ }
    try {
      const result = await buildBookPlaybackManifest(job, { sourcePaths, ffprobe: services.ffprobe(), inspect: services.inspect });
      if (selection(job) !== selected) return res.status(409).json({ error: 'The selected audio changed. Try Play again.' });
      const bookmark = services.listening.get(job.id);
      remember({ ...result, selection: selected });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ manifest: result.manifest, bookmark: bookmark || null, resume: resolveBookmark(result.manifest, bookmark) });
    } catch (error: any) { res.status(422).json({ error: error.message || 'This book cannot be played.' }); }
  }));

  app.get('/api/jobs/:id/playback/segments/:segmentId', asyncRoute(async (req, res) => {
    const context = typeof req.query.signature === 'string' ? manifests.get(req.query.signature) : undefined;
    const job = (services.getJob ? services.getJob(req.params.id) : services.jobs().find(item => item.id === req.params.id));
    if (!job || !context || context.manifest.bookId !== job.id) return res.status(404).json({ error: 'Playback session expired. Try Play again.' });
    if (selection(job) !== context.selection) return res.status(409).json({ error: 'The selected audio changed. Try Play again.' });
    const index = context.manifest.segments.findIndex(segment => segment.id === req.params.segmentId);
    if (index < 0) return res.status(404).json({ error: 'Audio segment not found.' });
    const segment = context.manifest.segments[index];
    const file = context.files[index];
    try {
      const stamp = await fs.stat(file);
      if (!stamp.isFile() || playbackFileSignature(segment.id, stamp.size, stamp.mtimeMs, segment.durationSeconds) !== segment.signature)
        return res.status(409).json({ error: 'Audio changed since playback started. Try Play again.' });
    } catch { return res.status(404).json({ error: 'This audio file is no longer available.' }); }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (/\.(m4b|m4a)$/i.test(file)) res.type('audio/mp4');
    res.sendFile(path.resolve(file));
  }));

  app.get('/api/jobs/:id/listening', (req, res) => {
    if (!services.jobs().some(job => job.id === req.params.id)) return res.status(404).json({ error: 'Book not found.' });
    try { res.setHeader('Cache-Control', 'no-store'); res.json({ bookmark: services.listening.get(req.params.id) || null }); }
    catch (error: any) { res.status(500).json({ error: error.message }); }
  });
  app.post('/api/jobs/:id/listening', (req, res) => {
    if (!services.jobs().some(job => job.id === req.params.id)) return res.status(404).json({ error: 'Book not found.' });
    const body = req.body || {};
    const context = typeof body.mediaSignature === 'string' ? manifests.get(body.mediaSignature) : undefined;
    if (!context || context.manifest.bookId !== req.params.id) return res.status(409).json({ error: 'Playback session expired. Reload this book before continuing.' });
    const manifest = context.manifest;
    if (typeof body.positionSeconds !== 'number' || !Number.isFinite(body.positionSeconds) || body.positionSeconds < 0 ||
        body.positionSeconds > manifest.totalDurationSeconds + 0.1 || typeof body.completed !== 'boolean' ||
        typeof body.segmentOffsetSeconds !== 'number' || !Number.isFinite(body.segmentOffsetSeconds))
      return res.status(400).json({ error: 'Invalid listening position.' });
    const position = locatePosition(manifest, body.positionSeconds);
    if (manifest.segments[position.segmentIndex]?.id !== body.segmentId || Math.abs(position.offsetSeconds - body.segmentOffsetSeconds) > 0.15 ||
        (body.completed && body.positionSeconds < manifest.totalDurationSeconds - 0.15))
      return res.status(400).json({ error: 'The listening position does not match this book.' });
    let sequence: ListeningSequence | undefined;
    if (body.clientSessionId !== undefined || body.clientSequence !== undefined) {
      if (typeof body.clientSessionId !== 'string' || !/^[\w-]{1,128}$/.test(body.clientSessionId) ||
          !Number.isSafeInteger(body.clientSequence) || body.clientSequence < 0) return res.status(400).json({ error: 'Invalid checkpoint sequence.' });
      sequence = { clientSessionId: body.clientSessionId, clientSequence: body.clientSequence };
    }
    try { res.json({ bookmark: services.listening.save(createBookmark(manifest, body.positionSeconds, body.completed), sequence) }); }
    catch (error: any) { res.status(500).json({ error: error.message || 'Could not save the listening position.' }); }
  });

  app.post('/api/jobs/:id/personal-rating', (req, res) => {
    const job = (services.getJob ? services.getJob(req.params.id) : services.jobs().find(item => item.id === req.params.id));
    if (!job) return res.status(404).json({ error: 'Book not found.' });
    const rating = req.body?.rating;
    if (rating !== null && (!Number.isInteger(rating) || rating < 0 || rating > 10))
      return res.status(400).json({ error: 'A personal rating must be null or an integer from 0 to 10.' });
    const previous = job.personalRating;
    try { job.personalRating = rating; services.saveJobs(); res.json({ bookId: job.id, rating }); }
    catch (error: any) { job.personalRating = previous; res.status(500).json({ error: error.message || 'Could not save the rating.' }); }
  });
}
