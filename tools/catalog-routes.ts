import type { Express } from 'express';
import type { CatalogService } from './catalog-service';
import { coreResourceKinds, resourceContractVersion } from '../src/core/resources';
import { catalogSorts } from '../src/core/catalog';
import { CUSTOM_THEME_TOKENS } from './custom-themes';

// These POSTs carry search/filter payloads; they never change project files.
const readOnlyCatalogPosts = new Set([
  '/catalog/library/query', '/catalog/matches', '/catalog/suggestions',
  '/catalog/membership-suggestions', '/catalog/selections/page', '/catalog/selections/members',
]);
export function isReadOnlyCatalogRequest(method: string, requestPath: string): boolean {
  return method === 'POST' && readOnlyCatalogPosts.has(requestPath.replace(/\/$/, ''));
}

export function registerCatalogRoutes(app: Express, catalog: CatalogService, onCollectionsChanged?: (ids:string[])=>Promise<void>) {
  const route = (handler: (req: any) => Promise<unknown>) => async (req: any,res: any) => {
    try { res.json(await handler(req)); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); res.status(/Catalog changed|Selection expired/.test(message) ? 409 : /unavailable|worker|indexing/i.test(message) ? 503 : 400).json({ error:message }); }
  };
  app.get('/api/catalog/contract', (_req,res) => res.json({ version:resourceContractVersion, resourceKinds:coreResourceKinds, sorts:catalogSorts, maxPageSize:500,
    theme: { tokens:[...CUSTOM_THEME_TOKENS], resourceAttribute:'data-resource-id', kindAttribute:'data-resource-kind', surfaceAttribute:'data-sm-surface' },
    extensions: { runtimePlugins:false, resourceApi:'/api/resources', libraryQuery:'/api/catalog/library/query' } }));
  app.get('/api/catalog/status', route(async () => ({ revision:await catalog.call('revision'), ...catalog.status() })));
  app.post('/api/catalog/matches',route(req => catalog.call('matches',req.body || {})));
  app.post('/api/catalog/library/query',route(req => catalog.call('query',req.body || {})));
  app.get('/api/resources',route(req => catalog.call('resources',{ kind:req.query.kind, cursor:req.query.cursor, limit:req.query.limit === undefined ? undefined : Number(req.query.limit) })));
  app.get('/api/resources/:id/relations',route(req => catalog.call('relations',{ id:req.params.id,cursor:req.query.cursor,limit:req.query.limit === undefined ? undefined : Number(req.query.limit) })));
  app.get('/api/resources/:id',async (req,res) => {
    try { const result = await catalog.call('getResource',req.params.id); if (!result) { res.status(404).json({ error:'Resource not found.' }); return; } res.json(result); }
    catch (error) { res.status(503).json({ error:error instanceof Error ? error.message : String(error) }); }
  });
  app.post('/api/catalog/selections',route(req => catalog.call('selection',req.body || {})));
  app.post('/api/catalog/selections/page',route(req => catalog.call('selectionPage',req.body || {})));
  app.post('/api/catalog/selections/members',route(req => catalog.call('selectionMembers',req.body || {})));
  app.get('/api/catalog/collections',route(() => catalog.call('collections')));
  app.post('/api/catalog/collections',route(async req => {
    const input=req.body || {};
    const affected = onCollectionsChanged ? await catalog.call('collectionAffectedProjects',input) as string[] : [];
    const result=await catalog.call('saveCollection',input);
    if(onCollectionsChanged) await onCollectionsChanged(affected);
    return result;
  }));
  app.post('/api/catalog/membership-suggestions',route(req => catalog.call('membershipSuggestions',req.body || {})));
  app.post('/api/catalog/suggestions',route(req => catalog.call('suggestions',req.body || {})));
}
