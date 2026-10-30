import type { CompletionInput, CompletionReply } from '../packages/audiobooks/src/completion-ports';
import { asyncRoute } from './api-route';

/** Keep Express and download headers at the host boundary. */
export const audiobookCompletionRoute = (command: (input: CompletionInput) => CompletionReply | Promise<CompletionReply>) => asyncRoute(async (req, res) => {
  const result = await command({ params: req.params, body: req.body || {}, query: req.query, getHeader: name => req.get(name) });
  if (result.headers) res.set(result.headers);
  if (result.text !== undefined) res.status(result.status).send(result.text);
  else res.status(result.status).json(result.body);
});
