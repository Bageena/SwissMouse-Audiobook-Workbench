import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Download, Loader2, Search } from 'lucide-react';
import type { AudiobookJob } from '../types';
import type { LibriVoxBook, LibriVoxProgress, LibriVoxSearchField, LibriVoxSearchResult } from '../librivox';
import { useDependencyStatus } from '../dependency-status';

const button = 'px-3 py-2 rounded-lg border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 disabled:opacity-50 disabled:cursor-not-allowed text-sm';
async function json(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'The request failed. Please try again.');
  return data;
}
export function LibriVoxImport({ job, onAudioImported, onBusyChange }: {
  job: AudiobookJob; onAudioImported: (job: AudiobookJob) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const { feature } = useDependencyStatus();
  const readiness = feature('file_import');
  const [field, setField] = useState<LibriVoxSearchField>('title');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<{ field: LibriVoxSearchField; query: string }>();
  const [results, setResults] = useState<LibriVoxSearchResult>();
  const [book, setBook] = useState<LibriVoxBook>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<LibriVoxProgress>();
  const [polling, setPolling] = useState(true);
  const [replaceMetadata, setReplaceMetadata] = useState(false);
  const [starting, setStarting] = useState(false);
  const request = useRef<AbortController>();
  const callbacks = useRef({ onAudioImported, onBusyChange });
  callbacks.current = { onAudioImported, onBusyChange };
  const activeObserved = useRef(false);
  const busy = starting || progress?.status === 'downloading';
  useEffect(() => { callbacks.current.onBusyChange?.(busy); }, [busy]);
  useEffect(() => () => { request.current?.abort(); callbacks.current.onBusyChange?.(false); }, []);
  useEffect(() => {
    if (!polling) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status: LibriVoxProgress = await json('/api/librivox/import/' + job.id, { signal: controller.signal });
        setProgress(status);
        if (status.status === 'downloading') activeObserved.current = true;
        else {
          if (status.status === 'completed' && activeObserved.current) {
            const updated = await json('/api/jobs/' + job.id, { signal: controller.signal });
            callbacks.current.onAudioImported(updated); activeObserved.current = false;
          }
          setPolling(false); return;
        }
      } catch (e: any) {
        if (controller.signal.aborted) return;
        setError('Cannot read import progress. Retrying… ' + e.message);
      }
      timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [job.id, polling]);

  const browse = async (page: number, selected = { field, query }) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(''); setBook(undefined);
    try {
      const data = await json('/api/librivox/search?' + new URLSearchParams({ field: selected.field, q: selected.query, page: String(page) }), { signal: controller.signal });
      setResults(data); setSearch(selected);
    } catch (e: any) { if (!controller.signal.aborted) setError(e.message); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const details = async (id: string) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(''); setBook(undefined);
    try { setBook(await json('/api/librivox/books/' + id, { signal: controller.signal })); }
    catch (e: any) { if (!controller.signal.aborted) setError(e.message); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const start = async () => {
    if (!book) return;
    const confirmReplaceSource = !!job.parts.length;
    if (confirmReplaceSource && !window.confirm('Replace this project’s source audio and processing results? Existing source files will be kept.')) return;
    setStarting(true); setError(''); setPolling(false);
    try {
      await json('/api/librivox/import/' + job.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: book.id, confirmReplaceSource, replaceMetadata }) });
      activeObserved.current = true;
      setProgress({ status: 'downloading', section: 0, totalSections: book.sections.length, title: 'Loading sections…', bytes: 0, sectionBytes: 0 });
      setPolling(true);
    } catch (e: any) { setError(e.message); setPolling(true); }
    finally { setStarting(false); }
  };
  return <section aria-label="LibriVox import" className="space-y-4 text-stone-800">
    <p className="text-sm text-stone-600">Find a free audiobook from LibriVox. These recordings are public domain in the United States; check copyright rules in your country before downloading or using them.</p>
    <form onSubmit={e => { e.preventDefault(); void browse(1); }} className="flex flex-wrap gap-2">
      <select aria-label="Search LibriVox by" value={field} onChange={e => setField(e.target.value as LibriVoxSearchField)} className={button} disabled={busy}>
        <option value="title">Title</option><option value="author">Author</option><option value="genre">Genre</option>
      </select>
      <input aria-label="LibriVox search" placeholder={field === 'author' ? 'Author last name' : 'Search ' + field} maxLength={200} value={query} onChange={e => setQuery(e.target.value)} disabled={busy} className="flex-1 min-w-40 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" />
      <button type="submit" className={button + ' flex items-center gap-2'} disabled={loading || busy || !query.trim()}><Search size={16} />Search</button>
    </form>
    <p className="text-xs text-stone-500">Matches the beginning of a title, author’s last name, or genre. 20 books per page; requests are spaced a few seconds apart.</p>
    {error && <p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
    {loading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />Loading LibriVox…</p>}
    {results && !book && <>
      <p className="text-xs text-stone-500">Results for {search?.field}: {search?.query}</p>
      {!results.books.length && <p role="status">No matching books. Try a shorter title, an author’s last name, or another genre.</p>}
      {results.skipped > 0 && <p className="text-sm text-amber-700">Some incomplete catalog entries could not be displayed.</p>}
      <div className="grid md:grid-cols-2 gap-3">
        {results.books.map(result => <article key={result.id} className="flex gap-3 min-w-0 rounded-xl border border-stone-200 bg-white p-3">
          <div className="relative flex shrink-0 items-center justify-center w-16 h-24 bg-stone-100 rounded text-stone-400 overflow-hidden">
            <BookOpen size={26} />{result.coverUrl && <img src={result.coverThumbnailUrl || result.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-contain" onError={e => { e.currentTarget.style.display = 'none'; }} />}
          </div>
          <div className="min-w-0 space-y-1 text-xs text-stone-600">
            <h4 className="text-sm font-semibold text-stone-900 break-words">{result.title}</h4>
            <p className="break-words">{result.authors.join('; ') || 'Author unavailable'}</p>
            <p>{result.language || 'Language unavailable'} · {result.runtime || 'Runtime unavailable'} · {result.sectionCount || '?'} sections</p>
            <p className="break-words">{result.genres.join(', ') || 'Genre unavailable'}</p>
            <button type="button" className={button} disabled={loading || busy} onClick={() => void details(result.id)}>View details</button>
          </div>
        </article>)}
      </div>
      <nav aria-label="LibriVox pages" className="flex items-center justify-center gap-3">
        <button type="button" className={button} disabled={loading || busy || results.page === 1} onClick={() => void browse(results.page - 1, search)}>Previous</button>
        <span className="text-sm">Page {results.page}</span>
        <button type="button" className={button} disabled={loading || busy || !results.hasNext} onClick={() => void browse(results.page + 1, search)}>Next</button>
      </nav>
    </>}
    {book && <section aria-label="Selected LibriVox book" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
      <button type="button" className={button} disabled={busy} onClick={() => setBook(undefined)}>Back to results</button>
      <h3 className="font-semibold break-words">{book.title}</h3>
      {book.coverUrl && <img src={book.coverUrl} alt={'Cover of ' + book.title} referrerPolicy="no-referrer" className="max-w-28 max-h-40 object-contain rounded" onError={e => { e.currentTarget.style.display = 'none'; }} />}
      <p className="text-sm break-words">{book.authors.join('; ')} · {book.language} · {book.runtime} · {book.sections.length} sections</p>
      {book.genres.length > 0 && <p className="text-sm break-words">{book.genres.join(', ')}</p>}
      <p className="text-sm break-words max-h-48 overflow-auto">{book.description || 'No description supplied.'}</p>
      <p className="text-sm break-words"><span className="font-semibold">Readers: </span>{[...new Set(book.sections.flatMap(s => s.readers))].join('; ') || 'Reader information not supplied.'}</p>
      <ol className="max-h-64 overflow-auto list-decimal pl-6 text-sm space-y-1">
        {book.sections.map((s, i) => <li key={s.id + '-' + i} className="break-words">{s.title}{s.readers.length > 0 && <span className="text-stone-500"> — {s.readers.join('; ')}</span>}{!s.url && ' (Audio link unavailable)'}</li>)}
      </ol>
      {book.projectUrl && <a className="inline-block text-sm text-amber-800 underline" href={book.projectUrl} target="_blank" rel="noopener noreferrer">Open LibriVox project page</a>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={replaceMetadata} disabled={busy} onChange={e => setReplaceMetadata(e.target.checked)} className="mt-1" />Replace existing metadata with available LibriVox details. Leave unchecked to fill only empty fields.</label>
      <p className="text-xs text-stone-600">Sections stay in recording order. Their titles and boundaries are kept as source hints; use the normal chapter-detection and review steps after importing.</p>
      <button type="button" className={button + ' flex items-center gap-2'} title={readiness.tooltip} disabled={loading || busy || !readiness.ready || !book.sections.length || book.sections.some(s => !s.url) || (!!book.sectionCount && book.sections.length !== book.sectionCount)} onClick={() => void start()}><Download size={16} />Import audiobook</button>
      {!readiness.ready && <p className="text-xs text-amber-700">{readiness.tooltip}</p>}
    </section>}
    {progress && progress.status !== 'idle' && <div role="status" className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm space-y-2">
      {progress.status === 'downloading' && <><p>Downloading section {progress.section} of {progress.totalSections}: {progress.title}</p><p>{(progress.bytes / 1024 / 1024).toFixed(1)} MiB downloaded{progress.sectionTotalBytes ? ' · current section ' + Math.round(progress.sectionBytes / progress.sectionTotalBytes * 100) + '%' : ''}</p>
        <button type="button" className={button} onClick={() => { void json('/api/librivox/import/' + job.id + '/cancel', { method: 'POST' }).catch(e => setError(e.message)); }}>Cancel import</button></>}
      {progress.status === 'completed' && <p>Import complete. Continue with the normal processing and chapter-review steps.</p>}
      {progress.status === 'cancelled' && <p>Import cancelled. Incomplete downloads were removed; your previous source was kept.</p>}
      {progress.status === 'error' && <p role="alert" className="text-red-700 break-words">{progress.error} Your previous source was kept.</p>}
    </div>}
  </section>;
}
