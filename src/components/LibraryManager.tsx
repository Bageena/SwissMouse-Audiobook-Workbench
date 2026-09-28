import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Grid2X2, List, Pencil, Plus, Search } from 'lucide-react';
import type { AudiobookMetadata, LibraryBook } from '../types';

type View = 'cover' | 'list' | 'edit';
type SortKey = 'title' | 'author' | 'narrator' | 'series' | 'seriesSequence' | 'publishedYear' | 'createdAt' | 'metadataUpdatedAt';
type Field = 'title' | 'subtitle' | 'author' | 'narrator' | 'series' | 'seriesSequence' | 'description' | 'genres' | 'publishedYear' | 'publisher' | 'language' | 'isbn' | 'asin' | 'releaseDate' | 'copyright';
const columns: { key: Field; label: string; width: string }[] = [
  { key: 'title', label: 'Title', width: 'min-w-52' }, { key: 'subtitle', label: 'Subtitle', width: 'min-w-44' },
  { key: 'author', label: 'Author', width: 'min-w-40' }, { key: 'narrator', label: 'Narrator', width: 'min-w-40' },
  { key: 'series', label: 'Series', width: 'min-w-40' }, { key: 'seriesSequence', label: 'Series No.', width: 'min-w-24' },
  { key: 'description', label: 'Description', width: 'min-w-72' }, { key: 'genres', label: 'Genre', width: 'min-w-40' },
  { key: 'publishedYear', label: 'Year', width: 'min-w-24' }, { key: 'publisher', label: 'Publisher', width: 'min-w-40' },
  { key: 'language', label: 'Language', width: 'min-w-24' }, { key: 'isbn', label: 'ISBN', width: 'min-w-40' },
  { key: 'asin', label: 'ASIN', width: 'min-w-32' }, { key: 'releaseDate', label: 'Release date', width: 'min-w-32' },
  { key: 'copyright', label: 'Copyright', width: 'min-w-40' },
];
const sortOptions: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' }, { key: 'author', label: 'Author' }, { key: 'narrator', label: 'Narrator' },
  { key: 'series', label: 'Series and number' }, { key: 'seriesSequence', label: 'Series number' },
  { key: 'publishedYear', label: 'Year' }, { key: 'createdAt', label: 'Recently added' }, { key: 'metadataUpdatedAt', label: 'Recently modified' },
];
const suggestedFields = new Set<Field>(['author', 'narrator', 'series', 'genres', 'publisher', 'language']);
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
const fieldValue = (book: LibraryBook, field: Field) => field === 'genres' ? (book.metadata.genres || []).join(', ') : String(book.metadata[field] || '');
const seriesNumber = (value?: string) => {
  const match = String(value || '').match(/^\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

interface Props {
  books: LibraryBook[];
  onOpen: (id: string) => void;
  onAdd: () => void;
  onSave: (changes: { id: string; fields: Partial<AudiobookMetadata> }[]) => Promise<void>;
  onWriteAudioMetadata: (ids: string[]) => Promise<{ written: string[]; failures: string[] }>;
  onDelete: (id: string, name: string) => Promise<void>;
  onDeleteMany: (ids: string[]) => Promise<void>;
}

export const LibraryManager: React.FC<Props> = ({ books, onOpen, onAdd, onSave, onWriteAudioMetadata, onDelete, onDeleteMany }) => {
  const [view, setView] = useState<View>(() => (['cover', 'list', 'edit'].includes(localStorage.getItem('swissmouse_library_view') || '') ? localStorage.getItem('swissmouse_library_view') as View : 'cover'));
  const [sort, setSort] = useState<SortKey>('title');
  const [descending, setDescending] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<Field, string>>>>({});
  const [bulkFields, setBulkFields] = useState<Field[]>([]);
  const [bulkValues, setBulkValues] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileMessage, setFileMessage] = useState('');
  const pendingCellSaves = useRef(new Set<Promise<void>>());
  useEffect(() => setSelected(current => current.filter(id => books.some(book => book.id === id))), [books]);
  const suggestions = useMemo(() => Object.fromEntries([...suggestedFields].map(field => {
    const seen = new Set<string>();
    return [field, books.flatMap(book => fieldValue(book, field).split(field === 'genres' ? ',' : '\u0000')).map(value => value.trim()).filter(value => { const key = normalize(value); if (!key || seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => a.localeCompare(b))];
  })) as Record<string, string[]>, [books]);
  const filtered = useMemo(() => {
    const term = normalize(query);
    const result = books.filter(book => !term || normalize([book.metadata.title, book.metadata.author, book.metadata.narrator, book.metadata.series, book.metadata.description].join(' ')).includes(term));
    result.sort((a, b) => {
      let comparison = 0;
      if (sort === 'series' || sort === 'seriesSequence') {
        if (sort === 'series') comparison = (a.metadata.series || '').localeCompare(b.metadata.series || '', undefined, { sensitivity: 'base' });
        if (!comparison) comparison = seriesNumber(a.metadata.seriesSequence) - seriesNumber(b.metadata.seriesSequence);
        if (!Number.isFinite(comparison)) comparison = 0;
      } else if (sort === 'createdAt') comparison = a.createdAt.localeCompare(b.createdAt);
      else if (sort === 'metadataUpdatedAt') comparison = (a.metadataUpdatedAt || a.createdAt).localeCompare(b.metadataUpdatedAt || b.createdAt);
      else comparison = String(a.metadata[sort] || '').localeCompare(String(b.metadata[sort] || ''), undefined, { numeric: true, sensitivity: 'base' });
      return (descending ? -comparison : comparison) || a.metadata.title.localeCompare(b.metadata.title);
    });
    return result;
  }, [books, query, sort, descending]);
  const pageSize = view === 'cover' ? 48 : 75;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(Math.min(page, pageCount - 1) * pageSize, (Math.min(page, pageCount - 1) + 1) * pageSize);
  const chooseView = (next: View) => { setView(next); setPage(0); localStorage.setItem('swissmouse_library_view', next); };
  const chooseSort = (next: SortKey) => { if (next === sort) setDescending(!descending); else { setSort(next); setDescending(next === 'createdAt' || next === 'metadataUpdatedAt'); } setPage(0); };
  const toggleSelected = (id: string) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const saveCell = async (book: LibraryBook, field: Field) => {
    const value = drafts[book.id]?.[field];
    if (value === undefined || value === fieldValue(book, field)) return;
    setError('');
    setFileMessage('');
    const save = onSave([{ id: book.id, fields: { [field]: field === 'genres' ? value.split(',').map(item => item.trim()).filter(Boolean) : value } }]);
    pendingCellSaves.current.add(save);
    try {
      await save;
      setDrafts(current => { const next = { ...current, [book.id]: { ...current[book.id] } }; delete next[book.id][field]; return next; });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save metadata.'); }
    finally { pendingCellSaves.current.delete(save); }
  };
  const writeFiles = async () => {
    if (!selected.length) return;
    setBusy(true); setError(''); setFileMessage('');
    try {
      await Promise.all([...pendingCellSaves.current]);
      const result = await onWriteAudioMetadata(selected);
      if (result.written.length) setFileMessage(`Wrote metadata to ${result.written.length} exported audio file${result.written.length === 1 ? '' : 's'}: ${result.written.join('; ')}`);
      if (result.failures.length) setError(result.failures.join('; '));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not write metadata to audio files.'); }
    finally { setBusy(false); }
  };
  const saveBulk = async () => {
    if (!selected.length || !bulkFields.length) return;
    const fields = Object.fromEntries(bulkFields.map(field => [field, field === 'genres' ? (bulkValues[field] || '').split(',').map(item => item.trim()).filter(Boolean) : bulkValues[field] || ''])) as Partial<AudiobookMetadata>;
    if ('title' in fields && !fields.title?.trim()) { setError('Title cannot be empty.'); return; }
    setBusy(true); setError(''); setFileMessage('');
    try { await onSave(selected.map(id => ({ id, fields }))); setBulkFields([]); setBulkValues({}); setSelected([]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save selected books.'); }
    finally { setBusy(false); }
  };
  const cover = (book: LibraryBook, size: string) => book.coverUrl
    ? <img src={book.coverUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className={`${size} rounded-lg object-cover bg-stone-100`} />
    : <span className={`${size} flex items-center justify-center rounded-lg bg-stone-200 text-stone-500`}><BookOpen className="h-7 w-7" /></span>;

  return <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Your library</p><h1 className="text-2xl font-bold text-stone-950">Library Manager</h1><p className="text-sm text-stone-500">{books.length} books · Browse and update your local audiobook details.</p></div>
      <button onClick={onAdd} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-semibold text-white hover:bg-amber-800"><Plus className="h-4 w-4" />Add book</button>
    </div>
    {!!selected.length && <div className="flex items-center gap-3 rounded-lg bg-amber-50 p-2 text-xs"><span className="font-semibold">{selected.length} selected</span><button type="button" onClick={() => { void onDeleteMany(selected); }} className="font-semibold text-red-700 underline">Delete selected</button><button type="button" onClick={() => setSelected([])} className="text-stone-600 underline">Clear</button></div>}
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-xl border border-stone-200 bg-stone-50 p-1">{([['cover', Grid2X2, 'Cover View'], ['list', List, 'List View'], ['edit', Pencil, 'Edit View']] as const).map(([key, Icon, label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => chooseView(key)} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold ${view === key ? 'bg-white text-amber-800 shadow-sm' : 'text-stone-600'}`}><Icon className="h-3.5 w-3.5" />{label}</button>)}</div>
      <label className="relative min-w-48 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" /><input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Search books" className="w-full rounded-xl border border-stone-200 py-2 pl-9 pr-3 text-sm" /></label>
      <label className="text-xs text-stone-600">Sort <select value={sort} onChange={event => chooseSort(event.target.value as SortKey)} className="ml-1 rounded-lg border border-stone-200 bg-white px-2 py-2 text-xs">{sortOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
      <button type="button" onClick={() => setDescending(!descending)} aria-label={descending ? 'Sort ascending' : 'Sort descending'} className="rounded-lg border border-stone-200 px-2.5 py-2 text-xs font-semibold text-stone-700">{descending ? '↓ Desc' : '↑ Asc'}</button>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {fileMessage && <p role="status" className="break-all rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{fileMessage}</p>}
    {view === 'edit' && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600"><p>Changes save to the library when you leave a field. Select a book to update its exported audio file.</p><button type="button" disabled={busy || !selected.length} onClick={() => void writeFiles()} className="rounded-lg bg-amber-700 px-3 py-2 font-bold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Writing metadata…' : `Write metadata to audiobook file${selected.length === 1 ? '' : 's'}${selected.length ? ` (${selected.length} selected)` : ''}`}</button></div>}
    {view === 'edit' && <details className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-stone-900">Bulk edit · {selected.length} selected</summary>
      <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => setSelected(visible.map(book => book.id))} className="text-xs font-semibold text-amber-800 underline">Select visible</button><button type="button" onClick={() => setSelected([])} className="text-xs font-semibold text-stone-600 underline">Clear selection</button></div>
      <p className="text-xs text-stone-600">Choose each field to overwrite. All other metadata stays as it is. Checked fields with empty values will be cleared.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{columns.map(({ key, label }) => <label key={key} className="rounded-lg bg-white p-2 text-xs ring-1 ring-stone-200"><span className="flex items-center gap-1.5 font-semibold"><input type="checkbox" checked={bulkFields.includes(key)} onChange={() => setBulkFields(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])} />{label}</span><input value={bulkValues[key] || ''} disabled={!bulkFields.includes(key)} onChange={event => setBulkValues(current => ({ ...current, [key]: event.target.value }))} list={suggestedFields.has(key) ? `library-suggestions-${key}` : undefined} className="mt-1 w-full rounded border border-stone-200 px-2 py-1.5 disabled:bg-stone-100" /></label>)}</div>
      <button type="button" disabled={busy || !selected.length || !bulkFields.length} onClick={saveBulk} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : `Apply to ${selected.length} books`}</button>
      </div>
    </details>}
    {Object.entries(suggestions).map(([field, values]) => <datalist key={field} id={`library-suggestions-${field}`}>{values.map(value => <option key={value} value={value} />)}</datalist>)}
    {!books.length ? <div className="rounded-xl border border-dashed border-stone-300 p-12 text-center text-sm text-stone-600">Add your first book to start your library.</div>
      : !filtered.length ? <p className="rounded-xl bg-stone-50 p-8 text-center text-sm text-stone-500">No books match that search.</p>
      : view === 'cover' ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(340px,1fr))]">{visible.map(book => <article key={book.id} className="relative flex gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
        <button type="button" onClick={() => onOpen(book.id)} className="shrink-0 self-start">{cover(book, 'h-32 w-32 sm:h-40 sm:w-40')}</button>
        <div className="min-w-0 flex-1"><button type="button" onClick={() => onOpen(book.id)} className="text-left text-sm font-bold text-stone-950 hover:text-amber-800">{book.metadata.title || book.name}</button><p className="mt-1 text-xs font-medium text-stone-700">{book.metadata.author || 'Unknown author'}</p>{book.metadata.series && <p className="mt-1 text-xs text-amber-800">{book.metadata.series}{book.metadata.seriesSequence ? ` · #${book.metadata.seriesSequence}` : ''}</p>}<p className="mt-2 text-[11px] text-stone-500">{[book.metadata.narrator, book.metadata.publishedYear].filter(Boolean).join(' · ')}</p>{book.metadata.description && <details className="mt-2 text-xs text-stone-600"><summary className="cursor-pointer line-clamp-2">{book.metadata.description}</summary><p className="mt-1 whitespace-pre-wrap">{book.metadata.description}</p></details>}<div className="mt-2 flex items-center gap-3"><label className="text-[11px] text-stone-500"><input type="checkbox" checked={selected.includes(book.id)} onChange={() => toggleSelected(book.id)} /> Select</label><button type="button" onClick={() => void onDelete(book.id, book.name)} className="text-[11px] text-red-700 hover:underline">Delete</button></div></div>
      </article>)}</div> : <div className="overflow-x-auto rounded-xl border border-stone-200"><table className="w-full border-collapse text-left text-xs"><thead className="sticky top-0 bg-stone-100 text-stone-700"><tr><th className="p-2">Select</th><th className="p-2">Cover</th>{(view === 'list' ? [{ key: 'title', label: 'Title' }, { key: 'author', label: 'Author' }, { key: 'narrator', label: 'Narrator' }, { key: 'series', label: 'Series' }, { key: 'seriesSequence', label: 'Series No.' }, { key: 'publishedYear', label: 'Year' }] : columns).map(column => <th key={column.key} className="whitespace-nowrap p-2"><button type="button" onClick={() => sortOptions.some(option => option.key === column.key) && chooseSort(column.key as SortKey)} className="font-semibold hover:text-amber-800">{column.label}{sort === column.key ? descending ? ' ↓' : ' ↑' : ''}</button></th>)}<th className="p-2">Actions</th></tr></thead><tbody>{visible.map(book => <tr key={book.id} className="border-t border-stone-100 hover:bg-stone-50"><td className="p-2"><input type="checkbox" aria-label={`Select ${book.metadata.title}`} checked={selected.includes(book.id)} onChange={() => toggleSelected(book.id)} /></td><td className="p-2">{cover(book, 'h-12 w-9')}</td>{view === 'list' ? <><td className="min-w-52 p-2"><button type="button" className="font-semibold text-stone-900 hover:text-amber-800" onClick={() => onOpen(book.id)}>{book.metadata.title || book.name}</button></td>{(['author', 'narrator', 'series', 'seriesSequence', 'publishedYear'] as const).map(field => <td key={field} className="min-w-28 p-2 text-stone-600">{fieldValue(book, field)}</td>)}</> : <>{columns.map(({ key, label, width }) => <td key={key} className={`p-1 ${width}`}><input aria-label={`${label} for ${book.metadata.title}`} value={drafts[book.id]?.[key] ?? fieldValue(book, key)} onChange={event => setDrafts(current => ({ ...current, [book.id]: { ...current[book.id], [key]: event.target.value } }))} onBlur={() => void saveCell(book, key)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} list={suggestedFields.has(key) ? `library-suggestions-${key}` : undefined} className="w-full rounded border border-transparent bg-transparent px-2 py-1.5 focus:border-amber-400 focus:bg-white" /></td>)}</>}<td className="whitespace-nowrap p-2"><button type="button" onClick={() => onOpen(book.id)} className="font-semibold text-amber-800">Open</button> <button type="button" onClick={() => void onDelete(book.id, book.name)} className="ml-2 text-red-700">Delete</button></td></tr>)}</tbody></table></div>}
    {pageCount > 1 && <div className="flex items-center justify-between text-xs text-stone-600"><span>Showing {visible.length} of {filtered.length} matching books</span><div className="flex items-center gap-2"><button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border border-stone-200 px-2 py-1 disabled:opacity-40">Previous</button><span>{Math.min(page, pageCount - 1) + 1} / {pageCount}</span><button disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)} className="rounded border border-stone-200 px-2 py-1 disabled:opacity-40">Next</button></div></div>}
  </section>;
};
