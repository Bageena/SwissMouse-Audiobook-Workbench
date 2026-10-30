import type { Express, Request } from 'express';
import { AudiobookCommandError, createAudiobookProjectService } from '../packages/audiobooks/src/project-service';
import type { EditableProject } from '../packages/audiobooks/src/project-metadata';
import { asyncRoute } from './api-route';

/** Transport compatibility only. Existing shared mutation/runtime middleware runs first. */
export function registerAudiobookProjectRoutes<J extends EditableProject, B>(app: Express, commands: ReturnType<typeof createAudiobookProjectService<J, B>>, afterMetadataSave?: () => Promise<boolean>) {
  const json = (run: (request: Request) => unknown, status = 200) => asyncRoute(async (req, res, next) => {
    try { res.status(status).json(await run(req)); }
    catch (error) {
      if (error instanceof AudiobookCommandError) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  });
  app.get('/api/jobs', json(req => commands.list(req.query.limit, req.query.cursor)));
  app.post('/api/jobs', json(req => commands.create(req.body), 201));
  app.get('/api/jobs/:id', json(req => commands.read(req.params.id)));
  app.delete('/api/jobs/:id', json(req => commands.remove(req.params.id)));
  app.post('/api/jobs/:id/metadata-draft', json(req => commands.saveDraft(req.params.id, req.body?.metadata, req.body?.expectedRevision)));
  app.post('/api/jobs/:id/metadata', json(async req => { const result = commands.saveMetadata(req.params.id, req.body?.metadata, req.body?.expectedRevision, req.body?.selection); return req.body?.selection && afterMetadataSave ? {...result,historyPending:await afterMetadataSave()} : result; }));
  app.post('/api/jobs/:id/metadata-json', json(req => commands.saveMetadataJson(req.params.id, req.body?.metadata, req.body?.expectedRevision)));
  app.post('/api/jobs/:id/chapters', json(req => commands.saveChapters(req.params.id, req.body?.chapters)));
  app.post('/api/jobs/:id/import/chapters-csv', json(req => commands.importChaptersCsv(req.params.id, req.body?.csvText)));
  app.post('/api/library/metadata', json(req => commands.saveLibraryMetadata(req.body?.changes)));
  for (const [suffix, format] of [['chapters-csv', 'csv'], ['ffmeta', 'ffmeta']] as const) {
    app.get(`/api/jobs/:id/export/${suffix}`, asyncRoute((req, res, next) => {
      try {
        const file = commands.exportChapters(req.params.id, format);
        res.setHeader('Content-Type', file.type);
        res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
        res.send(file.content);
      } catch (error) {
        if (error instanceof AudiobookCommandError) return res.status(error.status).send(error.message);
        next(error);
      }
    }));
  }
}
