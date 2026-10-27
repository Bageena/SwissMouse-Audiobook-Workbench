import { readStored, writeStored } from '../utils/libraryWorkspace';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { File, FileText, Film, Folder, Image, Music, Plus } from 'lucide-react';
import { fileKind, type BrowserEntry, type FileDetails, type FileView, type MetadataColumn } from '../utils/bookFiles';
import { useLibraryVirtualRows, MeasuredLibraryRow } from './useLibraryVirtualRows';

export type EditColumn = 'name' | MetadataColumn;
const columns: { key: EditColumn; label: string }[] = [{ key: 'name', label: 'Filename' }, { key: 'title', label: 'Title' }, { key: 'author', label: 'Author' }, { key: 'narrator', label: 'Narrator' }, { key: 'year', label: 'Year' }];
export function FileTypeIcon({ entry, className = 'h-4 w-4' }: { entry: BrowserEntry; className?: string }) {
  const Icon = { audio: Music, video: Film, image: Image, document: FileText, folder: Folder, other: File }[fileKind(entry)];
  return <Icon aria-hidden="true" className={`shrink-0 text-stone-500 ${className}`} />;
}
const detailColumns = [...columns, { key: 'size', label: 'File Size' }, { key: 'modified', label: 'Date Modified' }];
const defaultWidths = [320, 160, 160, 160, 72, 90, 180];
const minimumWidths = [140, 90, 90, 90, 60, 75, 130];

const bytes = (size?: number) => size === undefined ? '—' : size >= 1024 ** 2 ? `${(size / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;

/** Presentation and windowing only. Commands and persistence belong to callers. */
export function FileBrowser({ entries, view, selected, details, busy, canEdit, onSelect, onOpen, onAdd, onContext, onVisible, onEdit, onKeyCommand, thumbnailUrl, positionKey, windowOffset, onWindow }: {
  entries: BrowserEntry[]; view: FileView; selected: Set<string>; details: Record<string, FileDetails>; busy: boolean; canEdit: boolean;
  onSelect: (entry: BrowserEntry, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onOpen: (entry: BrowserEntry) => void; onAdd: (entry: BrowserEntry) => void;
  onContext: (entry: BrowserEntry, event: React.MouseEvent) => void;
  onVisible: (entries: BrowserEntry[]) => void;
  onEdit: (entry: BrowserEntry, column: EditColumn, value: string) => Promise<boolean>;
  onKeyCommand: (event: React.KeyboardEvent) => void;
  thumbnailUrl?: (entry: BrowserEntry) => string;
  positionKey?: string; windowOffset?:number; onWindow?:(direction:'next'|'previous')=>void;
}) {
  const previousWindow=useRef(windowOffset), previousScroll=useRef(0), ignoreScroll=useRef(false);
  const [width, setWidth] = useState(700);
  const [columnWidths, setColumnWidths] = useState(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem('swissmouse-file-columns') || 'null');
      return Array.isArray(saved) && saved.length === defaultWidths.length && saved.every((value, i) => typeof value === 'number' && Number.isFinite(value) && value >= minimumWidths[i] && value <= 1200) ? saved as number[] : defaultWidths;
    } catch { return defaultWidths; }
  });
  useEffect(() => { const timer = setTimeout(() => { try { localStorage.setItem('swissmouse-file-columns', JSON.stringify(columnWidths)); } catch { /* Session sizing remains available. */ } }, 200); return () => clearTimeout(timer); }, [columnWidths]);
  const resize = useRef<{ index: number; x: number; width: number }>();
  const setColumnWidth = (index: number, value: number) => setColumnWidths(current => current.map((width, i) => i === index ? Math.max(minimumWidths[i], Math.min(1200, value)) : width));
  const detailsStyle = {
    gridTemplateColumns: `30px minmax(${columnWidths[0]}px, 1fr) ${columnWidths.slice(1).map(value => `${value}px`).join(' ')} 30px`,
    minWidth: columnWidths.reduce((sum, value) => sum + value, 76),
  };
  const grid = view === 'small' || view === 'large';
  const countPerRow = grid ? Math.max(1, Math.floor(width / (view === 'large' ? 160 : 100))) : 1;
  const rowCount = Math.ceil(entries.length / countPerRow);
  const virtual = useLibraryVirtualRows(rowCount, grid ? (view === 'large' ? 140 : 105) : 44, `${view}:${entries.length}:${entries[0]?.path || ''}`);
  useEffect(()=>{
    const element=virtual.scroller.current;
    if (!element || windowOffset===previousWindow.current) return;
    const backwards=(windowOffset || 0)<(previousWindow.current || 0);
    previousWindow.current=windowOffset; ignoreScroll.current=true;
    element.scrollTop=backwards?Math.max(0,element.scrollHeight-element.clientHeight-1):1;
    previousScroll.current=element.scrollTop; virtual.onScroll();
    const frame=requestAnimationFrame(()=>{ignoreScroll.current=false;}); return ()=>cancelAnimationFrame(frame);
  },[windowOffset,entries]);

  const restoredPosition = useRef('');
  useEffect(() => {
    const key = `${positionKey || ''}:${view}`;
    if (!positionKey || !entries.length || restoredPosition.current === key) return;
    const raw = readStored<number>(`swissmouse-file-scroll-${key}`, 0, true);
    const frame = requestAnimationFrame(() => { if (virtual.scroller.current) { restoredPosition.current = key; virtual.scroller.current.scrollTop = Number.isFinite(raw) ? Math.max(0, raw) : 0; virtual.onScroll(); } });
    return () => cancelAnimationFrame(frame);
  }, [positionKey, view, entries.length]);
  const [active, setActive] = useState<{ path: string; column: EditColumn }>();
  const [edit, setEdit] = useState<{ path: string; column: EditColumn; value: string; session: number }>();
  const session = useRef(0);
  const saving = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const element = virtual.scroller.current; if (!element) return; const observer = new ResizeObserver(() => setWidth(element.clientWidth)); observer.observe(element); return () => observer.disconnect(); }, []);
  useEffect(() => { if (edit) { input.current?.focus(); input.current?.select(); } }, [edit?.path, edit?.column]);
  const visible = useMemo(() => entries.slice(virtual.start * countPerRow, Math.min(entries.length, virtual.end * countPerRow)), [entries, virtual.start, virtual.end, countPerRow]);
  useEffect(() => onVisible(visible), [visible, onVisible]);
  const editable = (entry: BrowserEntry, column: EditColumn) => canEdit && !entry.unavailable && (column === 'name' || details[entry.path]?.writable.includes(column));
  const begin = (entry: BrowserEntry, column: EditColumn) => {
    if (busy || !editable(entry, column)) return;
    setActive({ path: entry.path, column }); setEdit({ path: entry.path, column, value: column === 'name' ? entry.name : details[entry.path]?.[column] || '', session: ++session.current });
  };
  const commit = async (direction?: 'row' | 'next' | 'previous') => {
    if (!edit || saving.current || edit.session !== session.current) return;
    const entry = entries.find(entry => entry.path === edit.path); if (!entry) { setEdit(undefined); return; }
    saving.current = true;
    let next: { entry: BrowserEntry; column: EditColumn } | undefined;
    const row = entries.indexOf(entry);
    if (direction === 'row') {
      const following = entries[row + 1];
      if (following) next = { entry: following, column: editable(following, edit.column) ? edit.column : 'name' };
    } else if (direction) {
      const cells = entries.flatMap(item => columns.filter(column => editable(item, column.key)).map(column => ({ entry: item, column: column.key })));
      const index = cells.findIndex(cell => cell.entry.path === edit.path && cell.column === edit.column);
      next = cells[index + (direction === 'previous' ? -1 : 1)];
    }
    const original = edit.column === 'name' ? entry.name : details[entry.path]?.[edit.column] || '';
    const ok = edit.value === original || await onEdit(entry, edit.column, edit.value);
    saving.current = false;
    if (ok) {
      session.current++;
      setEdit(undefined);
      if (next) {
        const nextRow = Math.floor(entries.indexOf(next.entry) / countPerRow);
        if (virtual.scroller.current) virtual.scroller.current.scrollTop = virtual.offsets[nextRow];
        begin(next.entry, next.column);
      } else virtual.scroller.current?.focus();
    } else { input.current?.focus(); }
  };
  const cell = (entry: BrowserEntry, column: EditColumn) => edit?.path === entry.path && edit.column === column ? <input ref={input} readOnly={busy} aria-label={`Edit ${column} for ${entry.name}`} value={edit.value} onClick={event => event.stopPropagation()} onChange={event => setEdit({ ...edit, value: event.target.value })} onBlur={() => void commit()} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); session.current++; setEdit(undefined); virtual.scroller.current?.focus(); }
    else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); void commit(event.key === 'Enter' ? 'row' : event.shiftKey ? 'previous' : 'next'); }
  }} className="w-full rounded border border-amber-500 bg-white px-1 py-1 text-xs" /> : <button type="button" className={`min-w-0 truncate px-1 py-2 text-left ${active?.path === entry.path && active.column === column ? 'ring-1 ring-inset ring-amber-500' : ''}`} onClick={event => { onSelect(entry, event); setActive({ path: entry.path, column }); }} onDoubleClick={event => { event.stopPropagation(); if (entry.type === 'folder' && column === 'name') onOpen(entry); else begin(entry, column); }} title={editable(entry, column) ? 'Double-click or F2 to edit' : 'Read only'}>
    {(column === 'name' ? entry.name : details[entry.path]?.[column]) || '—'}
  </button>;
  return <div ref={virtual.scroller} tabIndex={0} role="region" aria-label="File Browser" onScroll={event => { const element=event.currentTarget; if (onWindow && !busy && !ignoreScroll.current) { if (element.scrollTop>previousScroll.current && element.scrollTop+element.clientHeight>=element.scrollHeight-100) onWindow('next'); else if (element.scrollTop<previousScroll.current && element.scrollTop<50) onWindow('previous'); } previousScroll.current=element.scrollTop; virtual.onScroll(); if (positionKey) writeStored(`swissmouse-file-scroll-${positionKey}:${view}`, event.currentTarget.scrollTop, true); }} aria-busy={busy} className="h-[460px] overflow-auto focus-visible:outline-2 focus-visible:outline-amber-500" onKeyDown={event => {
    if (edit || (event.target as HTMLElement).tagName === 'INPUT') return;
    if (event.key === 'F2') { event.preventDefault(); const entry = entries.find(entry => entry.path === active?.path) || entries.find(entry => selected.has(entry.path)); if (entry) begin(entry, active?.column || 'name'); }
    else if (event.key === 'Enter') { const entry = entries.find(entry => entry.path === active?.path); if (entry) onOpen(entry); }
    else onKeyCommand(event);
  }}>
    {view === 'details' && <div style={detailsStyle} className="file-details-row sticky top-0 z-10 border-b border-stone-300 bg-stone-100 px-2 text-[11px] font-semibold"><span />{detailColumns.map((column, index) => <span key={column.key} className="relative min-w-0 p-2">
      {column.label}
      <span role="separator" aria-label={`Resize ${column.label} column`} aria-orientation="vertical" aria-valuemin={minimumWidths[index]} aria-valuemax={1200} aria-valuenow={columnWidths[index]} tabIndex={0} className="file-column-resizer"
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); const cell = event.currentTarget.parentElement!; resize.current = { index, x: event.clientX, width: cell.getBoundingClientRect().width }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (resize.current?.index === index) setColumnWidth(index, resize.current.width + event.clientX - resize.current.x); }}
        onPointerUp={event => { resize.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { resize.current = undefined; }} onLostPointerCapture={() => { resize.current = undefined; }}
        onDoubleClick={() => setColumnWidth(index, defaultWidths[index])}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setColumnWidth(index, columnWidths[index] + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 10)); } else if (event.key === 'Home') { event.preventDefault(); setColumnWidth(index, defaultWidths[index]); } }}
        title="Drag to resize; arrow keys adjust width; double-click to reset" />
    </span>)}<span /></div>}
    {!entries.length && <p className="p-6 text-xs text-stone-500">No files match this view.</p>}
    <div style={{ height: virtual.totalHeight, position: 'relative', minWidth: view === 'details' ? detailsStyle.minWidth : undefined }}>
      {Array.from({ length: virtual.end - virtual.start }, (_, offset) => virtual.start + offset).map(index => <MeasuredLibraryRow key={index} index={index} onMeasure={virtual.measure} style={{ position: 'absolute', width: '100%', top: virtual.offsets[index] }}>
        <div className={grid ? 'grid' : ''} style={grid ? { gridTemplateColumns: `repeat(${countPerRow}, minmax(0, 1fr))` } : undefined}>
          {entries.slice(index * countPerRow, (index + 1) * countPerRow).map(entry => <div key={entry.path} aria-selected={selected.has(entry.path)} role="row" style={view === 'details' ? detailsStyle : undefined} onContextMenu={event => onContext(entry, event)} onClick={event => { if (event.target === event.currentTarget) { onSelect(entry, event); setActive({ path: entry.path, column: 'name' }); } }} className={`${selected.has(entry.path) ? 'bg-amber-50' : 'hover:bg-stone-50'} ${view === 'details' ? 'file-details-row border-b border-stone-100 px-2' : grid ? 'flex flex-col items-center gap-1 rounded p-3 text-center' : 'flex items-center gap-2 border-b border-stone-100 px-3 py-1'} text-xs`}>
            <button type="button" aria-label={`${selected.has(entry.path) ? 'Deselect' : 'Select'} ${entry.name}`} onClick={event => { onSelect(entry, { ...event, ctrlKey: true }); setActive({ path: entry.path, column: 'name' }); }} onDoubleClick={() => onOpen(entry)} className="relative rounded p-1"><FileTypeIcon entry={entry} className={grid ? view === 'large' ? 'h-16 w-16' : 'h-10 w-10' : 'h-4 w-4'} />{grid && thumbnailUrl && (entry.audio || fileKind(entry) === 'image') && <img loading="lazy" alt="" src={thumbnailUrl(entry)} onError={event => { event.currentTarget.hidden = true; }} className="absolute inset-0 h-full w-full rounded bg-white object-contain" />}</button>
            {view === 'details' ? <>{columns.map(column => <React.Fragment key={column.key}>{cell(entry, column.key)}</React.Fragment>)}<span className="truncate p-2 tabular-nums">{entry.type === 'file' ? bytes(entry.sizeBytes) : '—'}</span><span className="truncate p-2">{entry.modifiedMs ? new Date(entry.modifiedMs).toLocaleString() : '—'}</span></> : <button type="button" className={`min-w-0 ${grid ? 'w-full' : 'flex-1'} truncate text-left`} onClick={event => { onSelect(entry, event); setActive({ path: entry.path, column: 'name' }); }} onDoubleClick={() => onOpen(entry)} title={entry.path}>{entry.name}</button>}
            {entry.audio && <button type="button" disabled={busy || entry.included} onClick={() => onAdd(entry)} title={entry.included ? 'In Project' : 'Add to Processing'} aria-label={entry.included ? `${entry.name} is in project` : `Add ${entry.name} to processing`} className="file-command disabled:opacity-30"><Plus className="h-3.5 w-3.5" /></button>}
          </div>)}
        </div>
      </MeasuredLibraryRow>)}
    </div>
  </div>;
}
