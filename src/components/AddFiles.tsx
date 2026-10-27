import { useState } from 'react';
import { DesktopWindow } from './DesktopWorkspace';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AudiobookJob } from '../types';
import type { BookGroup } from '../utils/bookGroups';
import { YouTubeAudioImport } from './YouTubeAudioImport';
import { LibriVoxImport } from './LibriVoxImport';

/** Imports use existing APIs; adding to an existing book preserves its manifest. */
export function AddFiles({ job, onChanged }: { job: AudiobookJob; onChanged: (job?: AudiobookJob) => Promise<void> }) {
  const [expanded, setExpanded] = useState(() => !job.parts.length);
  const [tab, setTab] = useState<string>(() => job.importPending && (job.inputMethod === 'youtube' || job.inputMethod === 'librivox') ? job.inputMethod : 'local'); const [local, setLocal] = useState('files');
  const [path, setPath] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [move, setMove] = useState(false);
  const [choice, setChoice] = useState<{ paths: string[]; groups: BookGroup[] }>();
  const [validated, setValidated] = useState<{ paths: string[]; count: number }>();
  const api = `/api/jobs/${encodeURIComponent(job.id)}`;
  const post = async (url: string, body: unknown) => { const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not add audio.'); return data; };
  const add = async (paths: string[], groupId?: string, validateOnly = false) => {
    setBusy(true); setError('');
    try {
      const fresh = !!job.importPending && !job.parts.length;
      const endpoint = fresh ? `${api}/local-source` : `${api}/book-files/discover`;
      const plan = await post(endpoint, { paths, move: fresh && move, groupId });
      if (plan.needsGroup) { setChoice({ paths, groups: plan.groups }); return; }
      if (validateOnly) { setValidated({ paths, count: plan.files.length }); return; }
      if (fresh && move && !window.confirm(`Move ${plan.files.length} selected audio files to Library?\n${plan.destination}\nOriginals are removed only after copies verify.`)) return;
      const result = await post(fresh ? `${api}/local-source` : `${api}/book-files/attach`, { paths, groupId, move: fresh && move, commit: true, destination: plan.destination });
      setChoice(undefined); setValidated(undefined); await onChanged(result.job);
      if (result.warning) setError(result.warning);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add audio.'); } finally { setBusy(false); }
  };
  const pick = async () => {
    setBusy(true); setError('');
    try {
      const result = await post(`/api/system/pick-audio-${local === 'folder' ? 'folder' : 'files'}`, {});
      const paths = local === 'folder' ? result.path ? [result.path] : [] : result.paths || [];
      if (paths.length) await add(paths);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not select audio.'); } finally { setBusy(false); }
  };
  const imported = async (updated: AudiobookJob) => { try { await onChanged(updated); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load imported audio.'); } };
  return <DesktopWindow id="add-files" title="Add Files"><section data-collapsed={!expanded} aria-label="Add Files" className="workspace-panel rounded-xl border border-stone-200 bg-white shadow-sm">
    <header className={`workspace-panel-header workspace-toolbar px-4 py-3 ${expanded ? 'border-b border-stone-200' : 'workspace-panel-header-collapsed'}`}>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="workspace-header-toggle flex w-full items-center justify-between text-sm font-bold"><span className={`workspace-panel-title ${expanded ? '' : 'workspace-panel-title-flat'}`}>Add Files</span>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
    </header>
    <div hidden={!expanded} className="space-y-4 p-4">
      <div role="tablist" aria-label="Import source" className="inline-flex flex-wrap gap-1 rounded-lg border border-stone-200 bg-stone-100 p-1">{[['local', 'Local Files'], ['youtube', 'YouTube'], ['librivox', 'LibriVox']].map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} disabled={busy || remoteBusy} onClick={() => setTab(value)} className={`rounded px-3 py-2 text-xs font-semibold ${tab === value ? 'bg-white shadow-sm' : ''}`}>{label}</button>)}</div>
      {tab === 'local' && <div className="space-y-3 text-xs"><fieldset disabled={busy} className="flex flex-wrap gap-4"><legend className="sr-only">Local file source</legend>{[['files', 'Select Files'], ['folder', 'Select Folder'], ['path', 'Add Audiobook by Path']].map(([value, label]) => <label key={value} className="flex items-center gap-2"><input type="radio" name="local-source" checked={local === value} onChange={() => { setLocal(value); setValidated(undefined); }} />{label}</label>)}</fieldset>
        {local === 'path' ? <div className="space-y-2"><label className="block">Audio file or folder path<input value={path} onChange={event => { setPath(event.target.value); setValidated(undefined); }} className="mt-1 w-full rounded border border-stone-300 p-2 font-mono" placeholder="Full local path" /></label><button type="button" disabled={busy || !path.trim()} onClick={() => void add([path.trim()], undefined, true)} className="file-command">Validate Path</button>{validated && <><span className="ml-2">{validated.count} supported audio files found.</span><button type="button" disabled={busy} onClick={() => void add(validated.paths)} className="file-command ml-2">Use Path</button></>}</div> : <button type="button" disabled={busy} onClick={() => void pick()} className="rounded border border-stone-300 px-3 py-2 font-semibold shadow-sm disabled:opacity-40">{busy ? 'Working…' : local === 'folder' ? 'Select Folder' : 'Select Files'}</button>}
        {!!job.importPending && !job.parts.length && <fieldset className="flex flex-wrap gap-4"><legend className="sr-only">File location</legend><label><input type="radio" checked={!move} onChange={() => setMove(false)} /> Use in current location</label><label><input type="radio" checked={move} onChange={() => setMove(true)} /> Move Audio to Library</label></fieldset>}
        {!!job.parts.length && <p className="text-stone-500">Selected files are added in their current location. Copy or move disk files explicitly with the File Manager toolbar.</p>}
      </div>}
      {tab !== 'local' && !job.importPending && <p className="text-xs text-stone-600">Use Import Book in the header to download a separate book. This project’s current source files stay attached.</p>}
      {tab === 'youtube' && job.importPending && <YouTubeAudioImport job={job} onAudioImported={imported} />}
      {tab === 'librivox' && job.importPending && <LibriVoxImport job={job} onAudioImported={imported} onBusyChange={setRemoteBusy} />}
      {choice && <section className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs"><p>Several probable books were found. Choose one group to add.</p><div className="max-h-56 overflow-auto">{choice.groups.map(group => <button key={group.id} type="button" disabled={busy} onClick={() => void add(choice.paths, group.id)} className="block w-full border-t p-2 text-left">{group.title} · {group.files.length} files · {group.author}</button>)}</div><button type="button" onClick={() => setChoice(undefined)}>Cancel</button></section>}
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </div>
  </section></DesktopWindow>;
}
