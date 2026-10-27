import { ToolbarPanel } from './ToolbarPanel';
import { readStored, writeStored } from '../utils/libraryWorkspace';
import { X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ClipboardPaste, Copy, Scissors, FolderOpen, FolderPlus, Pencil, Trash2, Plus, BookPlus, Undo2, RefreshCw, Info, Play, Link } from 'lucide-react';
import type { AudiobookJob, WorkbenchConfig } from '../types';
import type { BookGroup } from '../utils/bookGroups';
import { fileKind, fileViews, selectFile, visibleSelection, type BrowserEntry, type FileDetails, type FileView } from '../utils/bookFiles';
import { libraryRelativePath, DEFAULT_LIBRARY_TEMPLATE } from '../utils/libraryPath';
import { quickPlayback } from '../playback/QuickPlaybackController';
import { WorkspacePanel, WorkspaceSplit } from './WorkspacePanel';
import { FileBrowser, type EditColumn } from './FileBrowser';
import { ProcessingOrder, type QueueReadiness } from './ProcessingOrder';
import { SlideOutPanel } from './SlideOutPanel';
import { DirectoryTree } from './DirectoryTree';

type Tree = { total:number; indexing:boolean; error?:string; nextCursor?:string; previousCursor?:string; directory: string; root: string; parent?: string; canManage: boolean; entries: BrowserEntry[]; groups: BookGroup[]; readiness: QueueReadiness };
type CommandId = 'open' | 'preview' | 'copy' | 'cut' | 'paste' | 'rename' | 'mkdir' | 'delete' | 'create' | 'path' | 'properties' | 'include' | 'replace' | 'folder' | 'undo' | 'refresh' | 'copy-audio';
type Command = { id: CommandId; label: string; icon: React.ElementType; enabled: boolean };
const checking: QueueReadiness = { status: 'Checking', issues: [], durationSeconds: 0, durationComplete: false };
async function request(url: string, body?: unknown) {
  const response = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not complete the file operation.'); return data;
}
function FileDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose} aria-label={title} className="file-dialog m-auto max-h-[85vh] w-[min(600px,95vw)] overflow-auto rounded-xl border border-stone-300 bg-white p-5 text-stone-900 shadow-xl backdrop:bg-black/40"><div className="mb-4 flex items-center justify-between"><h3 className="font-bold">{title}</h3><button type="button" onClick={onClose} aria-label="Close dialog" className="file-command"><X className="h-4 w-4" aria-hidden="true" /></button></div>{children}</dialog>;
}

/** Canonical controller for browsing, selection, commands, and the manifest. */
export function SourceFileBrowser({ job, sourcePath, config, onChanged, onReadiness }: {
  job: AudiobookJob; sourcePath: string; config: WorkbenchConfig;
  onChanged: (job: AudiobookJob) => Promise<void>; onReadiness?: (state: QueueReadiness) => void;
}) {
  const [savedPosition] = useState(() => {
    const value = readStored<Record<string, unknown>>(`swissmouse-file-workspace-${job.id}`, {}, true);
    return value && typeof value === 'object' ? value : {};
  });
  const [tree, setTree] = useState<Tree>();
  const previousSource = useRef({ id: job.id, path: sourcePath });
  const [folderRevision, setFolderRevision] = useState(0);
  const folderRoots = useMemo(() => [
    { path: tree?.root || sourcePath, label: 'Project folder' },
    { path: config.inbox_folder || '', label: 'Inbox' },
    { path: config.library_folder || '', label: 'Library' },
  ].filter(root => root.path), [tree?.root, sourcePath, config.inbox_folder, config.library_folder]);
  const [queueState, setQueueState] = useState<QueueReadiness>(checking);
  const [address, setAddress] = useState('');
  const [history, setHistory] = useState<{ paths: string[]; index: number }>({ paths: [], index: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string>();
  const [view, setView] = useState<FileView>(['details', 'list', 'small', 'large'].includes(String(savedPosition.view)) ? savedPosition.view as FileView : 'details');
  const [search, setSearch] = useState(typeof savedPosition.search === 'string' ? savedPosition.search : ''); const [filter, setFilter] = useState(['all', 'audio', 'video', 'image', 'document'].includes(String(savedPosition.filter)) ? String(savedPosition.filter) : 'all');
  const [sort, setSort] = useState<'name' | 'size' | 'modified'>(['name', 'size', 'modified'].includes(String(savedPosition.sort)) ? savedPosition.sort as 'name' | 'size' | 'modified' : 'name');
  const [filePageSize,setFilePageSize] = useState<number|'all'>(100);
  const [filePage,setFilePage] = useState(0);
  const windowRequest = useRef<{cursor?:string;before?:boolean}>({});
  const [details, setDetails] = useState<Record<string, FileDetails>>({});
  const cache = useRef(new Map<string, FileDetails>()); const pending = useRef(new Set<string>());
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [undoAvailable, setUndoAvailable] = useState(false);
  const [clipboard, setClipboard] = useState<{ action: 'copy' | 'cut'; files: string[]; directory: string }>();
  const [context, setContext] = useState<{ x: number; y: number }>(); const [dialog, setDialog] = useState<'create' | 'properties'>();
  const [plan, setPlan] = useState<any>(); const [title, setTitle] = useState(''); const [author, setAuthor] = useState('');
  const [destinationType, setDestinationType] = useState('inbox'); const [destination, setDestination] = useState(''); const [customDestination, setCustomDestination] = useState(false);
  const requestId = useRef(0); const api = `/api/jobs/${encodeURIComponent(job.id)}`;
  const live = useRef({ jobId: job.id, directory: tree?.directory }); live.current = { jobId: job.id, directory: tree?.directory };
  const load = async (directory?: string, navigation: 'push' | 'stay' = 'push', window: {cursor?:string;before?:boolean;refresh?:boolean} = {}) => {
    const id = ++requestId.current; setLoading(true); setError('');
    const validating = { ...(tree?.readiness || checking), status: 'Checking' as const }; setQueueState(validating); onReadiness?.(validating);
    try {
      // Refresh is a one-shot command; polling only rereads the current window.
      windowRequest.current={cursor:window.cursor,before:window.before};
      const params = new URLSearchParams({limit:String(filePageSize==='all'?500:filePageSize),query:search,filter,sort,...(directory?{directory}:{}),...(window.cursor?{cursor:window.cursor}:{}),...(window.before?{before:'true'}:{}),...(window.refresh?{refresh:'true'}:{})});
      const data: Tree = await request(`${api}/book-files?${params}`);
      if (id !== requestId.current) return false;
      setTree(data); setAddress(data.directory); setQueueState(data.readiness); onReadiness?.(data.readiness);
      setDetails(Object.fromEntries(data.entries.filter(entry=>entry.metadata).map(entry=>[entry.path,entry.metadata!])));
      if (!window.cursor) setFilePage(0);
      const available = new Set(data.entries.map(entry => entry.path)); setSelected(current => new Set([...current].filter(file => available.has(file))));
      if (navigation === 'push') setHistory(current => current.paths[current.index] === data.directory ? current : { paths: [...current.paths.slice(0, current.index + 1), data.directory], index: current.index + 1 });
      return true;
    } catch (cause) { if (id === requestId.current) { const message = cause instanceof Error ? cause.message : 'Could not browse files.'; setError(message); const attention = { ...validating, status: 'Attention Required' as const, issues: [message] }; setQueueState(attention); onReadiness?.(attention); } return false; }
    finally { if (id === requestId.current) setLoading(false); }
  };
  useEffect(() => {
    const relocated = previousSource.current.id === job.id && previousSource.current.path !== sourcePath;
    previousSource.current = { id: job.id, path: sourcePath };
    cache.current.clear(); pending.current.clear(); setDetails({}); setTree(undefined); setSelected(new Set(Array.isArray(savedPosition.selected) ? savedPosition.selected.filter((path): path is string => typeof path === 'string') : [])); setHistory({ paths: [], index: -1 }); setClipboard(undefined); setUndoAvailable(false); setError(''); setNotice(''); setPlan(undefined); setDialog(undefined);
    void (async () => { const directory = relocated ? sourcePath : typeof savedPosition.directory === 'string' ? savedPosition.directory : undefined; if (!await load(directory) && directory) await load(); })(); return () => { requestId.current++; };
  }, [job.id, sourcePath]);
  useEffect(() => { if (tree) writeStored(`swissmouse-file-workspace-${job.id}`, { directory: tree.directory, view, search, filter, sort, selected: [...selected] }, true); }, [job.id, tree?.directory, view, search, filter, sort, selected]);
  useEffect(() => {
    if (!tree) return;
    const timer=setTimeout(()=>void load(tree.directory,'stay'),150); return ()=>clearTimeout(timer);
  },[search,filter,sort,filePageSize]);
  useEffect(() => {
    if (!tree?.indexing || loading) return;
    const timer=setTimeout(()=>void load(tree.directory,'stay',windowRequest.current),1500); return ()=>clearTimeout(timer);
  },[tree,loading]);
  const listing = tree?.entries || [];
  const turnFilePage = (direction:'next'|'previous') => {
    const cursor=direction==='next'?tree?.nextCursor:tree?.previousCursor;
    if (!cursor || loading || busy) return;
    void load(tree?.directory,'stay',{cursor,before:direction==='previous'}).then(ok => { if (ok) setFilePage(page=>Math.max(0,page+(direction==='next'?1:-1))); });
  };
  const chosen = visibleSelection(listing, selected); const audio = chosen.filter(entry => entry.audio && !entry.unavailable); const locked = busy || loading;
  const refresh = async () => { cache.current.clear(); setDetails({}); setFolderRevision(value => value + 1); await load(tree?.directory, 'stay',{refresh:true}); };
  const update = async (data: any) => {
    if (data.job) await onChanged(data.job);
    if (data.createdBook) setNotice(`Created ${data.createdBook.name}. Open it from Library Manager.`);
    await refresh(); if (data.warning) setError(data.warning);
  };
  const perform = async (action: () => Promise<void>) => {
    if (locked) return; setBusy(true); setError(''); setContext(undefined);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'File operation failed.'); }
    finally { setBusy(false); }
  };
  const membership = async (action: string, files: string[]) => update(await request(`${api}/source-files`, { action, files, view: 'directory', directory: tree?.directory }));
  const onVisible = useCallback((entries: BrowserEntry[]) => {
    const windowId = requestId.current;
    const directory = live.current.directory, jobId = live.current.jobId; if (!directory) return;
    if (pending.current.size) return;
    const wanted = entries.filter(entry => entry.audio && !entry.metadata && !cache.current.has(`${entry.path}:${entry.modifiedMs}:${entry.sizeBytes}`)).slice(0, 12);
    if (!wanted.length) return; wanted.forEach(entry => pending.current.add(entry.path));
    void request(`/api/jobs/${encodeURIComponent(jobId)}/book-files/details`, { directory, files: wanted.map(entry => entry.path) }).then(data => {
      if (requestId.current !== windowId || live.current.jobId !== jobId || live.current.directory !== directory) return;
      for (const entry of wanted) cache.current.set(`${entry.path}:${entry.modifiedMs}:${entry.sizeBytes}`, data[entry.path] || { writable: [] });
      while (cache.current.size>500) cache.current.delete(cache.current.keys().next().value!);
      setDetails(previous => ({ ...previous, ...data }));
    }).catch(() => { if (live.current.jobId === jobId) for (const entry of wanted) cache.current.set(`${entry.path}:${entry.modifiedMs}:${entry.sizeBytes}`, { writable: [] }); }).finally(() => { wanted.forEach(entry => pending.current.delete(entry.path)); if (live.current.jobId === jobId) setDetails(previous => ({ ...previous })); });
  }, []);
  const preview = async (entry: BrowserEntry) => {
    const metadata = details[entry.path]?.durationSeconds ? details[entry.path] : (await request(`${api}/book-files/details`, { directory: tree!.directory, files: [entry.path] }))[entry.path];
    await quickPlayback().previewFile(job.id, entry.name, tree!.directory, metadata?.durationSeconds || entry.durationSeconds || 0);
  };
  const open = (entry: BrowserEntry) => { if (locked) return; if (entry.type === 'folder') void load(entry.path); else if (entry.audio) void perform(() => preview(entry)); };
  const fileOperation = async (action: string, files: string[], directory: string, extra: Record<string, unknown> = {}) => {
    const payload = { action, files, directory, ...extra }; const plan = await request(`${api}/book-files/operation`, payload);
    const operation = action === 'delete' ? 'Move these actual disk items to Recycle Bin/Trash' : action === 'copy' ? 'Copy these disk items' : 'Move these actual disk items';
    if (action !== 'rename-folder' && !window.confirm(`${operation}?\n${plan.moves.map((move: any) => `${move.from}\n → ${move.to}`).join('\n') || files.join('\n')}\n${action === 'delete' ? 'Membership will be updated for successfully recycled files. This cannot be undone in SwissMouse.' : 'Existing destination files will never be overwritten.'}`)) return false;
    const data = await request(`${api}/book-files/operation`, { ...payload, commit: true, token: plan.token }); setUndoAvailable(false); await update(data);
    if (action === 'cut' && !data.warning) setClipboard(undefined);
    return true;
  };
  const editFile = async (entry: BrowserEntry, field: EditColumn, value: string) => {
    setBusy(true); setError('');
    try { await quickPlayback().stop();
      if (entry.type === 'folder') return await fileOperation('rename-folder', [entry.path], tree!.directory, { name: value });
      const data = await request(`${api}/book-files/edit`, { directory: tree!.directory, file: entry.path, field, value, stamp: entry.stamp }); await update(data); setUndoAvailable(!!data.undoAvailable); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Edit failed.'); return false; } finally { setBusy(false); }
  };
  const commands: Command[] = [
    { id: 'folder', label: 'Open Project Folder', icon: FolderOpen, enabled: !!tree },
    { id: 'open', label: 'Open', icon: FolderOpen, enabled: chosen.length === 1 && (chosen[0].type === 'folder' || !!chosen[0].audio) },
    { id: 'preview', label: 'Preview', icon: Play, enabled: chosen.length === 1 && audio.length === 1 },
    { id: 'copy', label: 'Copy', icon: Copy, enabled: !!chosen.length },
    { id: 'cut', label: 'Cut', icon: Scissors, enabled: !!tree?.canManage && !!chosen.length },
    { id: 'paste', label: 'Paste', icon: ClipboardPaste, enabled: !!tree?.canManage && !!clipboard?.files.length },
    { id: 'rename', label: 'Rename', icon: Pencil, enabled: !!tree?.canManage && chosen.length === 1 },
    { id: 'mkdir', label: 'New Folder', icon: FolderPlus, enabled: !!tree?.canManage },
    { id: 'delete', label: 'Delete from Disk', icon: Trash2, enabled: !!tree?.canManage && !!chosen.length },
    { id: 'include', label: 'Add to Processing', icon: Plus, enabled: audio.some(entry => !entry.included) },
    { id: 'create', label: 'Create New Book from Selected', icon: BookPlus, enabled: !!audio.length && audio.length === chosen.length },
    { id: 'path', label: 'Copy Path', icon: Link, enabled: !!chosen.length },
    { id: 'properties', label: 'Properties', icon: Info, enabled: !!chosen.length },
    { id: 'undo', label: 'Undo last file edit', icon: Undo2, enabled: undoAvailable },
    { id: 'replace', label: 'Use selected as this book', icon: BookPlus, enabled: !!audio.length },
    { id: 'copy-audio', label: 'Copy audio into project by path', icon: Plus, enabled: !!tree?.canManage },
    { id: 'refresh', label: 'Refresh', icon: RefreshCw, enabled: !!tree },
  ];
  const run = (id: CommandId) => {
    if (locked || !commands.find(command => command.id === id)?.enabled) return;
    void perform(async () => {
      const files = chosen.map(entry => entry.path);
      if (id === 'open') { if (chosen[0].type === 'folder') await load(chosen[0].path); else await preview(chosen[0]); }
      if (id === 'preview') await preview(audio[0]);
      if (id === 'copy' || id === 'cut') { setClipboard({ action: id, files, directory: tree!.directory }); setNotice(`${files.length} items ready to ${id}. Navigate to a destination and Paste.`); }
      if (id === 'paste' && clipboard) await fileOperation(clipboard.action, clipboard.files, clipboard.directory, { destination: tree!.directory });
      if (id === 'delete') { await quickPlayback().stop(); await fileOperation('delete', files, tree!.directory); }
      if (id === 'rename') { const name = window.prompt('New filename or folder name', chosen[0].name); if (!name || name === chosen[0].name) return; if (chosen[0].type === 'folder') await fileOperation('rename-folder', files, tree!.directory, { name }); else await editFile(chosen[0], 'name', name); }
      if (id === 'mkdir') { const name = window.prompt('New folder name'); if (name) await update(await request(`${api}/book-files/mkdir`, { name, directory: tree!.directory })); }
      if (id === 'include') await membership('include', audio.filter(entry => !entry.included).map(entry => entry.relativePath));
      if (id === 'path') { await navigator.clipboard.writeText(files.join('\n')); setNotice('Paths copied.'); }
      if (id === 'properties') setDialog('properties');
      if (id === 'create') { setPlan(undefined); setTitle(''); setAuthor(job.metadataDraft?.author || job.metadata?.author || job.author || ''); setCustomDestination(false); setDialog('create'); }
      if (id === 'folder') await request(`${api}/source-folder/open`, { directory: tree!.root });
      if (id === 'undo') { await quickPlayback().stop(); await update(await request(`${api}/book-files/undo`, {})); setUndoAvailable(false); }
      if (id === 'refresh') await update(await request(`${api}/book-files/check`, {}));
      if (id === 'copy-audio') { const file = window.prompt('Absolute audio file path to copy into the project root'); if (file) await update(await request(`${api}/source-files`, { action: 'add', file, destination: '', view: 'directory', directory: tree!.directory })); }
      if (id === 'replace') {
        const payload = { action: 'replace', files: audio.map(entry => entry.relativePath), view: 'directory', directory: tree!.directory }; const plan = await request(`${api}/source-selection`, payload);
        if (window.confirm(`Replace this book’s membership with ${plan.files.length} selected files?\n${plan.removed.length} current files will be excluded.\n${plan.transfers.map((owner: any) => `${owner.name}: reassign ${owner.files.length} files`).join('\n')}\nFiles remain on disk. Processing results will need to be rerun.`)) await update(await request(`${api}/source-selection`, { ...payload, commit: true, token: plan.token }));
      }
    });
  };
  const keyCommand = (event: React.KeyboardEvent) => {
    const control = event.ctrlKey || event.metaKey;
    if (control && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(new Set(listing.map(entry => entry.path))); return; }
    const id = control ? ({ c: 'copy', x: 'cut', v: 'paste', z: 'undo' } as const)[event.key.toLowerCase()] : event.key === 'Delete' ? 'delete' : undefined;
    if (id) { event.preventDefault(); run(id); }
  };
  useEffect(() => { if (dialog !== 'create' || customDestination) return; const root = destinationType === 'inbox' ? config.inbox_folder : config.library_folder; if (!root) return;
    const components = libraryRelativePath(config.library_template || DEFAULT_LIBRARY_TEMPLATE, { title: title || 'Untitled Audiobook', author: author || 'Unknown Author', narrator: '', genres: [], language: 'eng', abridged: false, explicit: false }); const separator = root.includes('\\') ? '\\' : '/';
    setDestination(root.replace(/[\\/]+$/, '') + separator + components.join(separator));
  }, [title, author, destinationType, dialog, customDestination, config]);
  const createBook = async (commit = false) => perform(async () => {
    const result = await request(`${api}/book-files/create`, { directory: tree!.directory, files: plan?.files || audio.map(entry => entry.path), title, author, destinationType, destination, commit, token: plan?.token });
    if (commit) { setDialog(undefined); setPlan(undefined); await update(result); } else { setPlan(result); setDestination(result.destination); }
  });
  const historyMove = async (offset: number) => { const index = history.index + offset; const path = history.paths[index]; if (path && await load(path, 'stay')) setHistory(current => ({ ...current, index })); };
  const renderCommand = (command: Command, text = false) => <button key={command.id} type="button" role={text ? 'menuitem' : undefined} disabled={locked || !command.enabled} title={command.label} aria-label={command.label} data-paper-action={command.id === 'include' ? '' : undefined} data-ui-action={command.id === 'include' ? 'primary' : undefined} onClick={() => run(command.id)} className={text ? 'flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs hover:bg-stone-100 disabled:opacity-40' : 'file-command'}><command.icon className="h-4 w-4" />{(text || command.id === 'include') && command.label}</button>;
  return <div className="space-y-3">
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}{notice && <p role="status" className="text-xs text-stone-600">{notice}</p>}
    <WorkspaceSplit main={<WorkspacePanel id="panel-File Manager" collapsible resizable title="File Manager">
      <form aria-label="Directory navigation" onSubmit={event => { event.preventDefault(); if (!locked) void load(address.trim()); }} className="workspace-toolbar flex flex-wrap items-center gap-1 border-b border-stone-200 p-2">
        <button type="button" aria-label="Back" title="Back" disabled={locked || history.index <= 0} onClick={() => void historyMove(-1)} className="file-command"><ArrowLeft className="h-4 w-4" /></button>
        <button type="button" aria-label="Forward" title="Forward" disabled={locked || history.index >= history.paths.length - 1} onClick={() => void historyMove(1)} className="file-command"><ArrowRight className="h-4 w-4" /></button>
        <button type="button" aria-label="Up Directory" title="Up Directory" disabled={locked || !tree?.parent} onClick={() => void load(tree?.parent)} className="file-command"><ArrowUp className="h-4 w-4" /></button>
        <input aria-label="Current Directory Path" value={address} onChange={event => setAddress(event.target.value)} className="min-h-8 min-w-36 flex-1 rounded border border-stone-300 px-2 font-mono text-xs shadow-inner" />
        <select aria-label="View Selector" value={view} onChange={event => setView(event.target.value as FileView)} className="min-h-8 rounded border border-stone-300 bg-white px-1 text-xs">{fileViews.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      </form>
      <ToolbarPanel id="file-manager-toolbar" title="File Toolbar" homeWindow="panel-File Manager">{commands.filter(command => ['folder', 'copy', 'cut', 'paste', 'rename', 'include', 'refresh'].includes(command.id)).map(command => renderCommand(command))}<details className="relative"><summary className="file-command cursor-pointer text-xs">More</summary><div role="menu" className="absolute left-0 top-full z-20 w-60 rounded-lg border border-stone-300 bg-white p-1 shadow-lg">{commands.filter(command => ['mkdir', 'delete', 'create', 'path', 'undo', 'replace', 'properties', 'copy-audio'].includes(command.id)).map(command => renderCommand(command, true))}</div></details></ToolbarPanel>
      <SlideOutPanel id="file-manager-folders" title="Folders" homeWindow="panel-File Manager" main={<>
      <div className="workspace-toolbar flex flex-wrap items-center gap-2 border-b border-stone-200 p-2 text-xs"><input aria-label="Search filenames and indexed metadata" placeholder="Search files and indexed metadata" value={search} onChange={event => setSearch(event.target.value)} className="min-h-8 min-w-32 flex-1 rounded border border-stone-300 px-2" /><select aria-label="File type filter" value={filter} onChange={event => setFilter(event.target.value)} className="min-h-8 rounded border bg-white px-1">{[['all', 'All Files'], ['audio', 'Audio'], ['video', 'Video'], ['image', 'Images'], ['document', 'Documents']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Sort files" value={sort} onChange={event => setSort(event.target.value as typeof sort)} className="min-h-8 rounded border bg-white px-1"><option value="name">Filename</option><option value="size">File Size</option><option value="modified">Date Modified</option></select></div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"><label>Files per page <select aria-label="Files per page" value={filePageSize} onChange={event=>setFilePageSize(event.target.value==='all'?'all':Number(event.target.value))} className="rounded border p-1">{[25,50,100,250,500,'all'].map(size=><option key={size} value={size}>{size==='all'?'All':size}</option>)}</select></label><button type="button" disabled={locked || !tree?.previousCursor} onClick={()=>turnFilePage('previous')} className="rounded border px-2 py-1 disabled:opacity-40">Previous</button><button type="button" disabled={locked || !tree?.nextCursor} onClick={()=>turnFilePage('next')} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>{filePageSize==='all' && <span>Continuous browsing</span>}{tree?.error && <span role="status">{tree.error}</span>}</div>
      <FileBrowser windowOffset={filePage} onWindow={filePageSize==='all'?turnFilePage:undefined} positionKey={`${job.id}:${tree?.directory || sourcePath}`} thumbnailUrl={entry => `${api}/book-files/thumbnail?${new URLSearchParams({ directory: tree!.directory, file: entry.path, version: String(entry.modifiedMs || 0) })}`} entries={listing} view={view} selected={selected} details={details} busy={locked} canEdit={!!tree?.canManage} onSelect={(entry, event) => { setSelected(current => selectFile(listing, current, entry.path, anchor.current, event.ctrlKey || event.metaKey, event.shiftKey)); if (!event.shiftKey) anchor.current = entry.path; }} onOpen={open} onAdd={entry => void perform(() => membership('include', [entry.relativePath]))} onContext={(entry, event) => { event.preventDefault(); if (!selected.has(entry.path)) setSelected(new Set([entry.path])); setContext({ x: Math.max(0, Math.min(event.clientX, window.innerWidth - 270)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 500)) }); }} onVisible={onVisible} onEdit={editFile} onKeyCommand={keyCommand} />
      <p className="border-t border-stone-200 px-3 py-2 text-[11px] text-stone-500">{chosen.length} selected · {listing.length} visible · {tree?.total || 0} items{tree?.indexing?' - Updating index...':''}{selected.size > chosen.length ? ' · Hidden selections are excluded from commands' : ''}</p>
      {!!tree?.groups.length && <details className="m-3 rounded border border-stone-200 p-2 text-xs"><summary className="cursor-pointer font-semibold">{tree.groups.length} probable book groups on disk</summary><p className="py-2 text-stone-500">Grouping is a suggestion. Selecting a group does not attach it.</p><div className="max-h-48 overflow-auto">{tree.groups.map(group => <button key={group.id} type="button" disabled={locked} onClick={() => setSelected(new Set(tree.entries.filter(entry => group.files.includes(entry.relativePath)).map(entry => entry.path)))} className="block w-full border-t p-2 text-left hover:bg-stone-50">{group.title} · {group.files.length} files <span className="text-stone-500">{group.author} · {group.evidence}</span></button>)}</div></details>}
      </>}>{open => <DirectoryTree key={job.id} jobId={job.id} directory={tree?.directory || sourcePath} roots={folderRoots} active={open} disabled={locked} revision={folderRevision} onNavigate={path => { if (!locked) void load(path); }} />}</SlideOutPanel>
    </WorkspacePanel>} aside={<ProcessingOrder key={job.id} job={job} readiness={queueState} busy={locked} onGroup={(files, title) => void perform(async () => update(await request(`${api}/source-files`, { action: title === undefined ? 'ungroup' : 'group', files, title, view: 'directory', directory: tree?.directory })))} onOrder={files => void perform(() => membership('reorder', files))} onRemove={file => void perform(() => membership('remove', [file]))} />} />
    {context && <><div className="fixed inset-0 z-40" onClick={() => setContext(undefined)} onContextMenu={event => { event.preventDefault(); setContext(undefined); }} /><div role="menu" aria-label="File context menu" tabIndex={-1} ref={element => element?.focus()} onKeyDown={event => { if (event.key === 'Escape') setContext(undefined); }} style={{ left: context.x, top: context.y }} className="fixed z-50 max-h-[80vh] w-64 overflow-auto rounded-lg border border-stone-300 bg-white p-1 text-stone-900 shadow-xl">{commands.filter(command => ['open', 'preview', 'copy', 'cut', 'paste', 'rename', 'delete', 'path', 'properties', 'include', 'create'].includes(command.id)).map(command => renderCommand(command, true))}</div></>}
    {dialog === 'properties' && <FileDialog title="Properties" onClose={() => setDialog(undefined)}><p className="mb-3 text-xs">{chosen.length} selected items. Showing up to 50 individual properties.</p><ul className="space-y-3 text-xs">{chosen.slice(0, 50).map(entry => <li key={entry.path}><strong>{entry.name}</strong><p className="break-all font-mono">{entry.path}</p><p>{fileKind(entry)} · {entry.sizeBytes ?? 'Unknown'} bytes · {entry.modifiedMs ? new Date(entry.modifiedMs).toLocaleString() : 'Modified date unknown'}</p><p>{entry.included ? 'In Project' : 'On disk'}</p>{details[entry.path]?.error && <p>{details[entry.path].error}</p>}</li>)}</ul></FileDialog>}
    {dialog === 'create' && <FileDialog title="Create New Book from Selected" onClose={() => { if (!busy) { setDialog(undefined); setPlan(undefined); } }}><form onSubmit={event => { event.preventDefault(); void createBook(!!plan); }} className="space-y-3 text-xs">
      <label className="block">Book Title<input required value={title} disabled={busy} onChange={event => { setTitle(event.target.value); setPlan(undefined); }} className="mt-1 w-full rounded border p-2" /></label>
      <label className="block">Author<input required value={author} disabled={busy} onChange={event => { setAuthor(event.target.value); setPlan(undefined); }} className="mt-1 w-full rounded border p-2" /></label>
      <label className="block">Destination<select value={destinationType} disabled={busy} onChange={event => { setDestinationType(event.target.value); setCustomDestination(false); setPlan(undefined); }} className="ml-2 rounded border bg-white p-2"><option value="inbox">Inbox</option><option value="library">Library</option></select></label>
      <label className="block">Destination location<input required value={destination} disabled={busy} onChange={event => { setDestination(event.target.value); setCustomDestination(true); setPlan(undefined); }} className="mt-1 w-full rounded border p-2 font-mono" /></label>
      <p>{plan?.files.length || audio.length} selected audio files will move into this new book folder. Embedded metadata is preserved. Files will never be overwritten. Up to 100 paths are shown below; all selected files will move.</p><ul className="max-h-36 overflow-auto break-all">{(plan?.files || audio.map(entry => entry.path)).slice(0, 100).map((file: string) => <li key={file}>{file}</li>)}</ul>
      {plan && <div className="rounded border border-amber-300 bg-amber-50 p-3"><p className="font-semibold">Confirm move to {plan.destination}</p>{plan.transfers.map((owner: any) => <p key={owner.name}>{owner.name}: {owner.files.length} files will leave its membership; {owner.remaining} remain. Processing results will need to be rerun.</p>)}</div>}{error && <p role="alert" className="text-rose-700">{error}</p>}
      <button type="submit" disabled={busy || !title.trim() || !author.trim()} className="rounded bg-amber-800 px-3 py-2 font-semibold text-white disabled:opacity-40">{busy ? 'Working…' : plan ? 'Confirm Move and Create Book' : 'Review Move'}</button>
    </form></FileDialog>}
  </div>;
}
