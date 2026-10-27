import { useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react';
import { WorkspacePanel } from './WorkspacePanel';
import { formatTimestampMs } from '../utils/chapters';
import type { AudiobookJob } from '../types';

export interface QueueReadiness { status: 'Empty' | 'Checking' | 'Ready' | 'Attention Required'; issues: string[]; durationSeconds: number; durationComplete: boolean }
export function ProcessingOrder({ job, readiness, busy, onOrder, onRemove, onGroup }: {
  job: AudiobookJob; readiness: QueueReadiness; busy: boolean;
  onOrder: (files: string[]) => void; onRemove: (file: string) => void;
  onGroup?: (files: string[], title?: string) => void;
}) {
  const [dragging, setDragging] = useState<string>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupTitle, setGroupTitle] = useState('');
  const [anchor, setAnchor] = useState<string>();
  const files = job.parts.map(part => (part.sourceRelativePath || part.name).replace(/\\/g, '/'));
  const selectedFiles = files.filter(file => selected.has(file));
  const indices = files.flatMap((file, index) => selected.has(file) ? [index] : []);
  const consecutive = indices.length >= 2 && indices[indices.length - 1] - indices[0] + 1 === indices.length;
  const move = (file: string, target: number) => {
    const next = files.filter(item => item !== file); next.splice(target, 0, file); onOrder(next);
  };
  return <WorkspacePanel id="panel-Processing Order" collapsible resizable title="Processing Order" className={!files.length ? 'opacity-70' : ''} actions={<span role="status" className="text-[11px] font-semibold">{readiness.status}</span>}>
    <div className="p-3 text-xs">
      <p className="mb-2 break-words text-stone-500 [overflow-wrap:anywhere]">Book source: {job.sourceFolderPath || job.source?.path || 'Add audio above'}</p>
      <p className="mb-3 tabular-nums">{formatTimestampMs(readiness.durationSeconds * 1000)} {readiness.durationComplete ? 'total duration' : 'known duration · partial'}</p>
      {onGroup && files.length > 0 && <div className="mb-3 space-y-2">
        <p className="text-stone-500">Select consecutive files to make one chapter. Shift-click selects a range.</p>
        <input aria-label="Chapter group name" placeholder="Chapter group name" maxLength={200} value={groupTitle} disabled={busy} onChange={event => setGroupTitle(event.target.value)} className="w-full rounded border border-stone-300 bg-white px-2 py-1.5" />
        <div className="flex gap-2">
          <button type="button" disabled={busy || !consecutive || !groupTitle.trim()} onClick={() => onGroup(selectedFiles, groupTitle)} className="rounded border border-stone-300 px-2 py-1 disabled:opacity-40">Group selected</button>
          <button type="button" disabled={busy || !job.parts.some((part, index) => selected.has(files[index]) && part.chapterGroup)} onClick={() => onGroup(selectedFiles)} className="rounded border border-stone-300 px-2 py-1 disabled:opacity-40">Ungroup selected</button>
          <button type="button" disabled={busy || !selectedFiles.length} onClick={() => setSelected(new Set())} className="px-2 py-1 disabled:opacity-40">Clear</button>
        </div>
      </div>}
      {!files.length && <p className="rounded-lg bg-stone-50 p-4 text-stone-500">Add audio from the File Manager to prepare this book for processing.</p>}
      {readiness.issues.length > 0 && <div role="alert" className="mb-3 text-rose-700">{readiness.issues.slice(0, 3).map(issue => <p key={issue}>{issue}</p>)}{readiness.issues.length > 3 && <p>{readiness.issues.length - 3} more issues in Terminal Log.</p>}</div>}
      <ol className="max-h-[520px] overflow-auto">{files.map((file, index) => <li key={job.parts[index].id} onDragOver={event => { if (dragging && !busy) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (dragging && !busy) move(dragging, index); setDragging(undefined); }} className="flex items-center gap-1 border-t border-stone-100 py-2">
        <button type="button" draggable={!busy} disabled={busy} onDragStart={event => { setDragging(file); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', file); }} onDragEnd={() => setDragging(undefined)} aria-label={`Drag ${file} to reorder`} className="cursor-grab rounded p-1 active:cursor-grabbing"><GripVertical className="h-4 w-4" /></button>
        {onGroup && <input type="checkbox" aria-label={`Select ${file} for grouping`} checked={selected.has(file)} disabled={busy} onChange={event => {
          const anchorIndex = anchor === undefined ? -1 : files.indexOf(anchor);
          const range = (event.nativeEvent as MouseEvent).shiftKey && anchorIndex >= 0;
          const checked = event.target.checked;
          setSelected(current => { const next = new Set(current); for (const item of range ? files.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1) : [file]) { if (checked) next.add(item); else next.delete(item); } return next; });
          setAnchor(file);
        }} />}
        <span className="min-w-0 flex-1" title={file}>{job.parts[index].chapterGroup && <span className="block truncate text-[10px] font-semibold text-amber-800">{job.parts[index].chapterGroup!.title}</span>}<span className="block truncate">{file.split('/').pop()}</span></span>
        <button type="button" disabled={busy || index === 0} onClick={() => move(file, index - 1)} title="Move Up" aria-label={`Move ${file} up`} className="file-command"><ArrowUp className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={busy || index === files.length - 1} onClick={() => move(file, index + 1)} title="Move Down" aria-label={`Move ${file} down`} className="file-command"><ArrowDown className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={busy} onClick={() => onRemove(file)} aria-label={`Remove ${file} from project`} title="Remove from Project — keeps the file on disk" className="file-command text-rose-700"><X className="h-4 w-4" /></button>
      </li>)}</ol>
    </div>
  </WorkspacePanel>;
}
