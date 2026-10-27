import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import { containsDirectory, directoryKey, directoryTrail, filesystemRoot } from '../utils/directoryTree';

type FolderEntry = { path: string; name: string; unavailable?: boolean };
type Branch = { directory?: string; entries: FolderEntry[]; total: number; nextCursor?: string; indexing?: boolean; error?: string; loading?: boolean };
export type DirectoryRoot = { path: string; label: string };

/** Shallow, folder-only pages; expanding never probes audio or changes membership. */
export function DirectoryTree({ jobId, directory, roots, active, disabled, revision, onNavigate }: {
  jobId: string; directory: string; roots: DirectoryRoot[]; active: boolean; disabled: boolean; revision: number;
  onNavigate: (directory: string) => void;
}) {
  const locations = useMemo(() => {
    const unique = new Map<string, DirectoryRoot>();
    for (const root of [...roots, { path: filesystemRoot(directory), label: filesystemRoot(directory) }])
      if (root.path && !unique.has(directoryKey(root.path))) unique.set(directoryKey(root.path), root);
    return [...unique.values()];
  }, [roots, directory]);
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const current = useRef(branches); current.current = branches;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState(directoryKey(directory));
  const tree = useRef<HTMLDivElement>(null);
  const treeId = useId();
  const inFlight = useRef(new Map<string, AbortController>());
  const publish = (key: string, branch: Branch) => {
    current.current = { ...current.current, [key]: branch };
    setBranches(current.current);
  };
  const load = useCallback(async (path: string, append = false, refresh = false) => {
    const key = directoryKey(path), previous = current.current[key];
    if (inFlight.current.has(key)) return;
    const controller = new AbortController(); inFlight.current.set(key, controller);
    publish(key, { ...previous, entries: previous?.entries || [], total: previous?.total || 0, loading: true, error: undefined });
    try {
      // Expanded IDs are case-folded on Windows. Cursor identities must keep
      // the server's exact directory spelling across polling and later pages.
      const params = new URLSearchParams({ directory: previous?.directory || path, limit: '100', ...(append && previous?.nextCursor ? { cursor: previous.nextCursor } : {}), ...(refresh ? { refresh: 'true' } : {}) });
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/book-files/folders?${params}`, { signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not list folders.');
      if (controller.signal.aborted) return;
      const entries = append ? [...(previous?.entries || []), ...data.entries] : data.entries;
      publish(key, { ...data, entries: [...new Map(entries.map((entry: FolderEntry) => [directoryKey(entry.path), entry])).values()] as FolderEntry[], loading: false });
    } catch (error) {
      if (!controller.signal.aborted) publish(key, { ...previous, entries: previous?.entries || [], total: previous?.total || 0, error: error instanceof Error ? error.message : 'Could not list folders.', loading: false });
    } finally { if (inFlight.current.get(key) === controller) inFlight.current.delete(key); }
  }, [jobId]);
  useEffect(() => () => { for (const controller of inFlight.current.values()) controller.abort(); }, [jobId]);
  useEffect(() => {
    if (!active || !directory) return;
    const root = locations.filter(root => containsDirectory(root.path, directory)).sort((a, b) => b.path.length - a.path.length)[0];
    const trail = root ? directoryTrail(root.path, directory) : [];
    setExpanded(previous => new Set([...previous, ...trail.map(directoryKey)]));
    const selected = [...(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') || [])].find(row => row.getAttribute('aria-selected') === 'true');
    setFocused(selected?.dataset.path || directoryKey(locations[0]?.path || directory));
    for (const path of trail) if (!current.current[directoryKey(path)]) void load(path);
  }, [active, directory, locations, load]);
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (active) for (const path of expanded) if (!current.current[path]) void load(path);
  }, [active, expanded, load]);
  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    // Invalidate collapsed observations too, so renamed/deleted folders cannot linger.
    for (const controller of inFlight.current.values()) controller.abort();
    inFlight.current.clear();
    current.current = {}; setBranches({});
    if (active) for (const path of expanded) void load(path, false, true);
  }, [revision, active, expanded, load]);
  useEffect(() => {
    if (!active) return;
    const pending = Object.entries(branches).filter(([path, branch]) => expanded.has(path) && branch.indexing && !branch.loading && !branch.error);
    if (!pending.length) return;
    const timer = setTimeout(() => { for (const [path] of pending) void load(path); }, 1500);
    return () => clearTimeout(timer);
  }, [active, branches, expanded, load]);
  const toggle = (path: string) => {
    const key = directoryKey(path);
    setExpanded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    if (!current.current[key]) void load(path);
  };
  const focus = (element?: HTMLElement) => { if (element) { setFocused(element.dataset.path!); element.focus(); } };
  const render = (entry: FolderEntry, level: number, parent?: string): React.ReactNode => {
    const key = directoryKey(entry.path), branch = branches[key], isOpen = expanded.has(key), selected = key === directoryKey(directory);
    const rowId = parent ? `${parent}|${key}` : key;
    const children = [...(branch?.entries || [])];
    // Keep the active route visible even when its name falls on a later page.
    const descendant = directoryTrail(entry.path, directory)[1];
    if (descendant && !children.some(child => directoryKey(child.path) === directoryKey(descendant)))
      children.unshift({ path: descendant, name: descendant.split(/[\\/]/).filter(Boolean).at(-1)! });
    const empty = !!branch && !branch.loading && !branch.indexing && !branch.error && !children.length;
    const groupId = `${treeId}-${encodeURIComponent(rowId)}`;
    return <div role="none" key={key}>
      <div role="treeitem" aria-label={entry.name} aria-level={level} aria-selected={selected} aria-current={selected ? 'location' : undefined}
        aria-expanded={empty ? undefined : isOpen} aria-owns={isOpen ? groupId : undefined} aria-disabled={disabled || entry.unavailable || undefined} data-path={rowId} data-parent={parent}
        tabIndex={focused === rowId ? 0 : -1} className="directory-tree-row" style={{ '--tree-level': level } as React.CSSProperties}
        title={entry.path} onFocus={() => setFocused(rowId)} onClick={() => { if (!disabled && !entry.unavailable) onNavigate(entry.path); }}
        onKeyDown={event => {
          const rows = [...tree.current!.querySelectorAll<HTMLElement>('[role="treeitem"]')];
          const index = rows.indexOf(event.currentTarget);
          if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
          if (event.key === 'ArrowDown') focus(rows[index + 1]);
          if (event.key === 'ArrowUp') focus(rows[index - 1]);
          if (event.key === 'Home') focus(rows[0]);
          if (event.key === 'End') focus(rows.at(-1));
          if (event.key === 'ArrowRight' && !disabled) { if (!isOpen && !empty) toggle(entry.path); else if (rows[index + 1]?.dataset.parent === rowId) focus(rows[index + 1]); }
          if (event.key === 'ArrowLeft') { if (isOpen) toggle(entry.path); else focus(rows.find(row => row.dataset.path === parent)); }
          if ((event.key === 'Enter' || event.key === ' ') && !disabled && !entry.unavailable) onNavigate(entry.path);
        }}>
        <button type="button" tabIndex={-1} className="directory-tree-disclosure" aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${entry.name}`} disabled={disabled || empty || entry.unavailable}
          onClick={event => { event.stopPropagation(); setFocused(rowId); event.currentTarget.closest<HTMLElement>('[role="treeitem"]')?.focus(); toggle(entry.path); }}>
          {!empty && (isOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />)}
        </button>
        {selected ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}<span>{entry.name}</span>
      </div>
      {isOpen && <div id={groupId} role="group" aria-label={`${entry.name} folders`}>
        {children.map(child => render(child, level + 1, rowId))}
        {(!branch || branch.loading || branch.indexing) && <p role="status" className="directory-tree-status">Loading folders…</p>}
        {empty && <p className="directory-tree-status">No subfolders</p>}
        {branch?.error && <div className="directory-tree-status" role="status"><span>{branch.error}</span> <button type="button" disabled={branch.loading} onClick={() => void load(entry.path, false, true)}>Retry</button></div>}
        {branch?.nextCursor && <button type="button" className="directory-tree-more" disabled={branch.loading} onClick={() => void load(entry.path, true)}>More folders ({branch.entries.length} of {branch.total})</button>}
      </div>}
    </div>;
  };
  return <nav aria-label="Folder navigation" className="directory-navigation">
    <div className="directory-tree-actions"><button type="button" disabled={disabled} onClick={() => { for (const path of expanded) void load(path, false, true); }} title="Refresh folders"><RefreshCw aria-hidden="true" /><span>Refresh folders</span></button></div>
    <div ref={tree} role="tree" aria-label="Folders" className="directory-tree">{locations.map(root => render({ path: root.path, name: root.label }, 1))}</div>
  </nav>;
}
