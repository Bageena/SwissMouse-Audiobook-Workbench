import type { Request } from 'express';
import type { FileCommandInput, FileReply } from '../packages/audiobooks/src/file-ports';
import { asyncRoute } from './api-route';

/** Preserve route/middleware placement while keeping Express outside the module. */
export const audiobookFileRoute = (command: (input: FileCommandInput) => FileReply | undefined | Promise<FileReply | undefined>) => asyncRoute(async (req: Request, res) => {
  const result = await command({ params: req.params, body: req.body || {}, query: req.query, files: req.files as FileCommandInput['files'], getHeader: name => req.get(name) });
  if (!result) throw new Error('Audiobook file command returned no result.');
  res.status(result.status).json(result.body);
});
