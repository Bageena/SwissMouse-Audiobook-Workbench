import type { Express } from 'express';
import type { CatalogPage, CatalogQuery } from '../src/core/catalog';
import { coreInformationBundle } from '../src/core/information-builtins';
import { createInformationRegistry } from '../src/core/information-registry';
import { informationPreviewPage } from '../src/core/information-preview';
import { audiobookInformationBundle, audiobookInformationItem } from '../packages/audiobooks/src/information';
import type { CatalogService } from './catalog-service';

/** Development-only read surface. Durable storage is enabled separately; no writable SDK grants. */
export function registerInformationPreviewRoutes(app: Express, catalog: CatalogService) {
  const registry = createInformationRegistry(); registry.activate(coreInformationBundle); registry.activate(audiobookInformationBundle);
  if (process.env.SWISSMOUSE_INFORMATION_DURABLE === '1') {
    app.get('/api/information-preview/durable-resources', async (req, res) => {
      try {
        if (Object.keys(req.query).some(key => !['limit', 'cursor', 'includeRetired'].includes(key)) || Object.values(req.query).some(value => typeof value !== 'string') || (req.query.includeRetired !== undefined && !['true', 'false'].includes(String(req.query.includeRetired)))) throw new Error('Invalid durable information query.');
        const result = await catalog.call('informationPage', { limit: req.query.limit === undefined ? 50 : Number(req.query.limit), cursor: req.query.cursor, includeRetired: req.query.includeRetired === 'true' });
        const body = JSON.stringify(result); if (Buffer.byteLength(body) > 4 * 1024 * 1024) { res.status(413).json({ error: 'Request a smaller durable page.' }); return; }
        res.type('json').send(body);
      } catch (error) { const message = error instanceof Error ? error.message : String(error); res.status(/changed/.test(message) ? 409 : 400).json({ error: message }); }
    });
  }
  app.get('/api/information-preview/definitions', (_req, res) => res.json({ prototypeVersion: 1, readOnly: true, persistence: 'session-only', definitions: registry.list() }));
  app.get('/api/information-preview/library', async (req, res) => {
    try {
      const allowed = ['limit', 'query', 'cursor', 'sort', 'root'];
      if (Object.keys(req.query).some(key => !allowed.includes(key)) || Object.values(req.query).some(value => typeof value !== 'string')) throw new Error('Unsupported preview query.');
      const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || String(req.query.query || '').length > 256 || String(req.query.cursor || '').length > 8192) throw new Error('Preview query exceeds its bounds.');
      const input: CatalogQuery = { limit, query: req.query.query as string, cursor: req.query.cursor as string, sort: req.query.sort as CatalogQuery['sort'], root: req.query.root as CatalogQuery['root'] };
      const page = await catalog.call<CatalogPage>('query', input);
      const result = { ...informationPreviewPage(registry, { ...page, items: page.items.map(book => audiobookInformationItem(book, page.revision)) }), status: catalog.status(), capabilities: { taxonomyQueries: false, autocompleteQueries: false, writes: false } };
      const body = JSON.stringify(result);
      if (Buffer.byteLength(body) > 2 * 1024 * 1024) { res.status(413).json({ error: 'Preview payload is too large. Request a smaller page.' }); return; }
      res.type('json').send(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(/Catalog changed/.test(message) ? 409 : /worker|unavailable/i.test(message) ? 503 : 400).json({ error: message });
    }
  });
  return registry;
}
