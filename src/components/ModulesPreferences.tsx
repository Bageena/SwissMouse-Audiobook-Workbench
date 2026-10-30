import { useEffect, useState } from 'react';
import { InstalledModulePanel, type InstalledModule } from '../modules/installed';

export function ModulesPreferences({ resourceId }: { resourceId?: string }) {
  const [modules, setModules] = useState<InstalledModule[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState('');
  const update = (data: { modules: InstalledModule[]; registryError?: string }) => { setModules(data.modules); setError(data.registryError || ''); };
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/modules', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load installed modules.');
      update(data);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  const change = async (id?: string, action?: 'enable' | 'disable' | 'remove') => {
    setBusy(true); setError(''); setNotice(''); setOpen('');
    try {
      const data = new FormData(); if (file) data.append('package', file); data.append('confirmed', 'true');
      const response = await fetch(id ? `/api/modules/${encodeURIComponent(id)}/${action}` : '/api/modules/install', id ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
      } : { method: 'POST', body: data });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Module change failed.');
      update(result); setNotice('Change saved. Restart SwissMouse to activate the new module state. Projects and settings are preserved.');
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <section aria-label="Installed modules" className="space-y-4 text-sm">
    <p>Install a prebuilt module approved by this installation’s administrator. This initial loader uses a local trust catalog and requires a SwissMouse restart after changes.</p>
    <div className="space-y-2 rounded-lg border border-stone-200 bg-white p-4">
      <label className="block font-semibold" htmlFor="module-package">Module package (.smmodule)</label>
      <input id="module-package" type="file" accept=".smmodule" disabled={busy} onChange={event => setFile(event.target.files?.[0] || null)} />
      <p className="text-xs text-stone-500">Only exactly approved packages are accepted. The read-only Audiobook proof does not replace the built-in audiobook workflow yet.</p>
      <button type="button" disabled={!file || busy || loading} onClick={() => change()} className="rounded border border-stone-300 px-3 py-2 font-semibold disabled:opacity-50">Install approved package</button>
    </div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading && <p role="status">Loading modules…</p>}
    {!loading && !modules.length && <p>No separately installed modules.</p>}
    {modules.map(module => <section key={module.id} className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="font-semibold">{module.name} · {module.version}</h2>
      <p className="text-xs">{module.publisher} · {module.active ? 'Active' : module.enabled ? 'Pending activation' : module.installed ? 'Disabled' : 'Removal pending restart'}</p>
      {module.restartRequired && <p>Restart SwissMouse to finish this change.</p>}
      {module.error && <p role="alert">{module.error}</p>}
      <div className="flex flex-wrap gap-2">
        {module.active && module.panels.map(panel => <button key={panel.id} type="button" disabled={busy} onClick={() => setOpen(open === panel.id ? '' : panel.id)} className="rounded border border-stone-300 px-3 py-1.5">{open === panel.id ? 'Close' : 'Open'} {panel.title}</button>)}
        {module.installed && <>
          <button type="button" disabled={busy} onClick={() => change(module.id, module.enabled ? 'disable' : 'enable')} className="rounded border border-stone-300 px-3 py-1.5">{module.enabled ? 'Disable' : 'Enable'}</button>
          <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Remove ${module.name} from installed modules? User data and recovery package copies will be kept. A restart is required.`)) void change(module.id, 'remove'); }} className="rounded border border-stone-300 px-3 py-1.5">Remove module</button>
        </>}
      </div>
      {module.active && module.panels.some(panel => panel.id === open) && <InstalledModulePanel key={`${module.browser}:${open}:${resourceId}`} module={module} panelId={open} resourceId={resourceId} />}
    </section>)}
  </section>;
}
