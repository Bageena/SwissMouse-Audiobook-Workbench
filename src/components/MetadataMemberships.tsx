import { useEffect, useId, useState, useRef } from 'react';
import type { MetadataMembership } from '../types';

type Suggestions = { matches:MetadataMembership[]; quick:MetadataMembership[]; selected:MetadataMembership[] };
export function MetadataMemberships({ kind, value, author, authors, jobId, onChange }: {
  kind:'collections'|'additionalSeries'; value?:MetadataMembership[]; author:string; authors?:string[]; jobId:string;
  onChange:(value:MetadataMembership[])=>void;
}) {
  const latest = useRef({value,onChange}); latest.current = {value,onChange};
  const [query,setQuery] = useState(''), [sequence,setSequence] = useState('');
  const [suggestions,setSuggestions] = useState<Suggestions>({ matches:[],quick:[],selected:[] });
  const [error,setError] = useState('');
  const [loading,setLoading]=useState(true);
  const listId = useId(), label = kind === 'collections' ? 'Collections' : 'Additional Series';
  const current = value || suggestions.selected;
  useEffect(() => {
    setLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/catalog/membership-suggestions',{ method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({kind,query,author,authors,jobId}) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load suggestions.');
        setSuggestions(data); setError(''); setLoading(false);
        if (kind === 'collections' && latest.current.value === undefined && data.selected.length) latest.current.onChange(data.selected);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load suggestions.'); }
    },200);
    return () => { clearTimeout(timer); controller.abort(); };
  },[kind,query,author,JSON.stringify(authors),jobId]);
  const add = (candidate?:MetadataMembership) => {
    if(!candidate && loading) return;
    const name = (candidate?.name || query).trim().slice(0,100); if (!name) return;
    if (current.some(item => item.name.toLowerCase() === name.toLowerCase())) { setQuery(''); return; }
    const known = candidate || suggestions.matches.find(item=>item.name.toLowerCase() === name.toLowerCase());
    onChange([...current,{id:known?.id || crypto.randomUUID(),name,addedAt:new Date().toISOString(),...(kind === 'additionalSeries' && sequence.trim() ? {sequence:sequence.trim()} : {})}]);
    setQuery('');setSequence('');
  };
  return <section className="space-y-2 border-t border-stone-200 pt-3" aria-label={label}>
    <h4 className="text-xs font-bold">{label}</h4>
    <p className="text-[11px] text-stone-500">{kind === 'collections' ? 'Group related media without changing its primary series.' : 'Add other series this book belongs to, each with its own number.'} Saved in exmetadata.json; not embedded in audio tags.</p>
    <div className="flex flex-wrap gap-2">{current.map(item=><span key={item.id} className="inline-flex max-w-full items-center gap-2 rounded border border-stone-300 px-2 py-1 text-xs"><span className="break-words">{item.name}</span>{kind === 'additionalSeries' && <input form="metadata-fields" aria-label={`${item.name} series number`} value={item.sequence || ''} onChange={event=>onChange(current.map(entry=>entry.id===item.id?{...entry,sequence:event.target.value}:entry))} className="metadata-membership-sequence w-16 rounded border border-stone-300 px-1" placeholder="No." />}<button type="button" onClick={()=>onChange(current.filter(entry=>entry.id!==item.id))} aria-label={`Remove ${item.name} from ${label}`}>×</button></span>)}</div>
    <div className="metadata-membership-entry flex flex-wrap gap-2">
      <input form="metadata-fields" list={listId} aria-label={`Add to ${label}`} placeholder={`Find or create ${kind === 'collections' ? 'a collection' : 'a series'}…`} maxLength={100} value={query} onChange={event=>{setLoading(true);setQuery(event.target.value);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();add();}}} className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1.5 text-xs" />
      <datalist id={listId}>{suggestions.matches.map(item=><option key={item.id} value={item.name} />)}</datalist>
      {kind==='additionalSeries' && <input form="metadata-fields" aria-label="New additional series number" placeholder="No." value={sequence} onChange={event=>setSequence(event.target.value)} className="metadata-membership-sequence w-16 rounded border border-stone-300 px-2 text-xs" />}
      <button type="button" disabled={!query.trim() || loading} onClick={()=>add()} className="rounded border border-stone-300 px-3 py-1 text-xs disabled:opacity-40">Add</button>
    </div>
    <details className="text-xs"><summary className="cursor-pointer py-1">Quick Add · {label}</summary><p className="text-[11px] text-stone-500">Five most recent, plus matches for this author.</p><div className="mt-2 flex flex-wrap gap-2">{suggestions.quick.filter(item=>!current.some(entry=>entry.name.toLowerCase()===item.name.toLowerCase())).map(item=><button key={item.id} type="button" onClick={()=>add(item)} className="rounded border border-stone-300 px-2 py-1">{item.name}</button>)}</div>{!suggestions.quick.length && <p className="text-stone-500">No recent or author-related suggestions yet. Search above to find any saved name.</p>}</details>
    {error && <p role="status" className="text-xs text-amber-800">{error}</p>}
  </section>;
}
