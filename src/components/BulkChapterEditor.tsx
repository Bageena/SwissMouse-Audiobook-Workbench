import { X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChapterEntry } from '../types';
import type { TitleCleanupUndo } from '../utils/chapterTitles';
import { transformChapterTitles, type BulkTitleOperation, type BulkTitleScope } from '../utils/chapterBulkEdit';

interface Props {
  chapters: ChapterEntry[];
  selectedIds: ReadonlySet<string>;
  onApply: (chapters: ChapterEntry[], changes: TitleCleanupUndo) => void;
  onClose: () => void;
}

const field = 'w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900';

export const BulkChapterEditor: React.FC<Props> = ({ chapters, selectedIds, onApply, onClose }) => {
  const [kind, setKind] = useState<BulkTitleOperation['kind']>('replace');
  const [find, setFind] = useState('');
  const [replacement, setReplacement] = useState('');
  const [text, setText] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [style, setStyle] = useState<'title' | 'sentence' | 'upper' | 'lower'>('title');
  const [scopeKind, setScopeKind] = useState<'all' | 'selected'>('all');
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus();
    return () => previous?.focus();
  }, []);

  const operation: BulkTitleOperation = kind === 'replace' || kind === 'remove'
    ? { kind, find, replacement, matchCase, wholeWord, regex }
    : kind === 'prepend' || kind === 'append' ? { kind, text } : { kind, style };
  const scope: BulkTitleScope = scopeKind === 'all' ? { kind: 'all' } : { kind: 'selected', ids: selectedIds };
  const result = useMemo(() => transformChapterTitles(chapters, operation, scope), [chapters, kind, find, replacement, matchCase, wholeWord, regex, text, style, scopeKind, selectedIds]);
  const scopeError = scopeKind === 'selected' && selectedIds.size === 0 ? 'Select chapters in the list before applying to selected chapters.' : null;
  const preview = result.changes.slice(0, 5);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab' || !panel.current) return;
    const controls = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <div className="fixed inset-0 z-50 flex justify-end bg-stone-900/60" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="bulk-chapter-title" onKeyDown={onKeyDown}
      className="flex h-full w-full max-w-lg flex-col border-l border-stone-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-5 py-4">
        <div>
          <h2 ref={heading} tabIndex={-1} id="bulk-chapter-title" className="text-lg font-bold text-stone-900">Bulk Chapter Editor</h2>
          <p className="mt-1 text-xs text-stone-600">Preview title changes before applying them to the chapter draft.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Bulk Chapter Editor" className="rounded px-2 py-1 text-stone-600 hover:bg-stone-100"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <label className="block space-y-1 text-sm font-medium text-stone-700">Operation
          <select className={field} value={kind} onChange={event => setKind(event.target.value as BulkTitleOperation['kind'])}>
            <option value="replace">Find &amp; Replace</option><option value="prepend">Prepend</option><option value="append">Append</option>
            <option value="remove">Remove Text</option><option value="capitalization">Change Capitalization</option>
          </select>
        </label>
        {(kind === 'replace' || kind === 'remove') && <div className="space-y-3">
          <label className="block space-y-1 text-sm font-medium text-stone-700">Find<input className={field} value={find} onChange={event => setFind(event.target.value)} /></label>
          {kind === 'replace' && <label className="block space-y-1 text-sm font-medium text-stone-700">Replace with<input className={field} value={replacement} onChange={event => setReplacement(event.target.value)} /></label>}
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-stone-700">
            <label className="flex items-center gap-2"><input type="checkbox" checked={matchCase} onChange={event => setMatchCase(event.target.checked)} /> Match case</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={wholeWord} onChange={event => setWholeWord(event.target.checked)} /> Whole word</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={regex} onChange={event => setRegex(event.target.checked)} /> Regular expression</label>
          </div>
        </div>}
        {(kind === 'prepend' || kind === 'append') && <label className="block space-y-1 text-sm font-medium text-stone-700">
          Text to {kind === 'prepend' ? 'prepend' : 'append'}<input className={field} value={text} onChange={event => setText(event.target.value)} />
        </label>}
        {kind === 'capitalization' && <label className="block space-y-1 text-sm font-medium text-stone-700">Capitalization
          <select className={field} value={style} onChange={event => setStyle(event.target.value as typeof style)}>
            <option value="title">Title Case</option><option value="sentence">Sentence case</option><option value="upper">UPPERCASE</option><option value="lower">lowercase</option>
          </select>
        </label>}
        <fieldset className="space-y-2 text-sm text-stone-700"><legend className="mb-2 font-semibold">Apply to</legend>
          <label className="flex items-center gap-2"><input type="radio" name="bulk-chapter-scope" checked={scopeKind === 'all'} onChange={() => setScopeKind('all')} /> All chapters</label>
          <label className="flex items-center gap-2"><input type="radio" name="bulk-chapter-scope" checked={scopeKind === 'selected'} onChange={() => setScopeKind('selected')} /> Selected chapters ({selectedIds.size})</label>
        </fieldset>
        {(result.error || scopeError) && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{result.error || scopeError}</p>}
        <section aria-label="Bulk edit preview" className="space-y-2">
          <h3 className="font-semibold text-sm text-stone-900">Preview</h3>
          {!result.error && !scopeError && result.changes.length === 0 && <p className="text-sm text-stone-600">No chapter titles would change.</p>}
          {preview.map(change => <div key={change.id} className="rounded border border-stone-200 bg-stone-50 p-3 text-sm">
            <p className="break-words text-stone-600">{change.before}</p><p className="break-words font-medium text-stone-900">→ {change.after}</p>
          </div>)}
          {result.changes.length > 0 && <p className="text-xs text-stone-600">Showing {preview.length} of {result.changes.length} changes</p>}
        </section>
      </div>
      <div className="flex justify-end gap-2 border-t border-stone-200 bg-stone-50 px-5 py-4">
        <button type="button" onClick={onClose} className="rounded border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700">Cancel</button>
        <button type="button" disabled={!!result.error || !!scopeError || !result.changes.length} onClick={() => onApply(result.chapters, result.changes)}
          className="rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Apply {result.changes.length} Changes</button>
      </div>
    </div>
  </div>;
};
