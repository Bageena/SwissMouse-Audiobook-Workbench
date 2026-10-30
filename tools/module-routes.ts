import type { Express, Request } from 'express';
import multer from 'multer';
import { ModuleHost } from './module-host';

export function registerModuleRoutes(app: Express, host: ModuleHost, busy: () => string | undefined) {
  let changing=false;
  const sameOrigin = (req: Request) => {
    try { return !req.get('origin') || new URL(req.get('origin')).origin === `${req.protocol}://${req.get('host')}`; }
    catch { return false; }
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: host.packageByteLimit(), files: 1, fields: 1 } }).single('package');
  app.get('/api/modules', (_req, res) => res.json(host.list()));
  app.post('/api/modules/inspect', (req,res)=>{
    if(!sameOrigin(req))return res.status(403).json({error:'Module inspection must come from this installation.'});
    upload(req,res,error=>{
      if(error)return res.status(400).json({error:error.message});
      try{if(!req.file)throw new Error('Choose a trusted module package.');res.json(host.install(req.file.buffer,true));}
      catch(error){res.status(400).json({error:(error as Error).message});}
    });
  });
  app.post('/api/modules/install', (req, res) => {
    const reason = busy(); if (reason) return res.status(409).json({ error: reason });
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Module changes must come from this SwissMouse installation.' });
    upload(req, res, async error => {
      if (error) return res.status(400).json({ error: error.message });
      if(changing)return res.status(409).json({error:'Wait for the current module change.'});
      changing=true;
      try {
        const reason = busy(); if (reason) return res.status(409).json({ error: reason });
        if (!req.file || req.body.confirmed !== 'true') throw new Error('Choose and confirm a trusted module package.');
        await host.prepareInstall(req.file.buffer);
        res.json(host.install(req.file.buffer));
      } catch (error) { res.status(400).json({ error: (error as Error).message }); }
      finally{changing=false;}
    });
  });
  app.post('/api/modules/:id/:action', async (req, res) => {
    if(changing)return res.status(409).json({error:'Wait for the current module change.'});
    changing=true;
    try {
      const reason = busy(); if (reason) return res.status(409).json({ error: reason });
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Module changes must come from this installation.' });
      if (req.body.confirmed !== true || !['enable', 'disable', 'remove'].includes(req.params.action)) throw new Error('Choose and confirm a supported module action.');
      await host.prepareChange(req.params.id,req.params.action);
      res.json(host.change(req.params.id, req.params.action as 'enable' | 'disable' | 'remove'));
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
    finally{changing=false;}
  });
  app.get('/api/modules/:id/read/:operation', async (req, res) => {
    try {
      const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
      if (resourceId && resourceId.length > 200) throw new Error('Invalid resource identifier.');
      res.setHeader('Cache-Control', 'no-store');
      res.json(await host.read(req.params.id, req.params.operation, { resourceId }));
    } catch (error) { res.status(404).json({ error: (error as Error).message }); }
  });
  app.get('/api/modules/:id/assets/:sha/*', (req, res) => {
    try {
      const file = host.asset(req.params.id, req.params.sha, req.params[0]);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(file);
    } catch (error) { res.status(404).json({ error: (error as Error).message }); }
  });
}
