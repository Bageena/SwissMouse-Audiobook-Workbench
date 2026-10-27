import { useEffect, useState } from 'react';

export function LibraryMaintenance({ pathsChanged, onRebuilt }: { pathsChanged: boolean; onRebuilt: () => Promise<void> }) {
  const [sources, setSources] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState('');
  const label = sources.map(source => source === 'inbox' ? 'Inbox' : 'Library').join(' and ');
  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        const response = await fetch('/api/library/scan-status');
        if (!response.ok) return;
        const data = await response.json();
        if (!disposed && data.scanning) {
          const p = data.progress;
          setProgress(p ? `${p.source}: ${p.phase} · ${p.folders} folders scanned · ${p.discovered} books/projects discovered · ${p.processed} reviewed` : 'Scanning…');
        }
      } catch { /* The operation request reports errors; a missed progress poll is harmless. */ }
    };
    if (busy) void poll();
    const timer = busy ? window.setInterval(poll, 1000) : undefined;
    return () => { disposed = true; window.clearInterval(timer); };
  }, [busy]);
  const rebuild = async () => {
    setConfirming(false); setBusy(true); setMessage(''); setProgress(`Starting ${label} rebuild…`);
    try {
      const response = await fetch('/api/library/rebuild', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SwissMouse-Catalog':'1' }, body: JSON.stringify({ sources, confirmed: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not rebuild the library.');
      await onRebuilt();
      setMessage(data.warnings?.length ? `Rebuild finished with warnings: ${data.warnings.join(' ')}` : `${label} rebuilt.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not rebuild the library.'); }
    finally { setBusy(false); setProgress(''); }
  };
  return <fieldset className="space-y-3 rounded-lg border border-stone-200 p-3.5">
    <legend className="px-1 font-semibold text-stone-900">Rebuild Library</legend>
    <p>Recreate stored library information from the configured folders. Saved project work, manual metadata edits, and audiobook files are preserved.</p>
    <div className="flex gap-4">{['inbox', 'library'].map(source => <label key={source} className="flex items-center gap-2">
      <input type="checkbox" checked={sources.includes(source)} disabled={busy} onChange={event => { setConfirming(false); setSources(current => event.target.checked ? [...current, source] : current.filter(item => item !== source)); }} />
      {source === 'inbox' ? 'Inbox' : 'Library'}
    </label>)}</div>
    {pathsChanged && <p>Save folder settings before rebuilding.</p>}
    {confirming && !pathsChanged ? <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
      <p className="font-semibold">Rebuild {label}?</p>
      <p>SwissMouse will replace its stored library information for {label} by scanning the configured folders. Your audiobook files will not be deleted.</p>
      <button type="button" onClick={() => void rebuild()} className="rounded bg-amber-600 px-3 py-2 font-semibold text-white">Rebuild {label}</button>
      <button type="button" onClick={() => setConfirming(false)} className="ml-2 rounded border px-3 py-2">Cancel</button>
    </div> : <button type="button" disabled={!sources.length || busy || pathsChanged} onClick={() => setConfirming(true)} className="rounded border border-stone-300 px-3 py-2 font-semibold disabled:opacity-40">{busy ? 'Rebuilding…' : 'Rebuild Library'}</button>}
    {progress && <p role="status">{progress}</p>}
    {message && <p role="status" className="whitespace-pre-wrap">{message}</p>}
    <p className="text-stone-500">Details are recorded in the Library log. Unavailable folders retain their previous information.</p>
  </fieldset>;
}
