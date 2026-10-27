import { useState } from 'react';
import type { WindowFrame } from '../utils/desktopLayout';
import { AdaptiveButton } from './AdaptiveButton';
import { ArrowUp, ArrowDown, RotateCcw, Undo2, Redo2 } from 'lucide-react';

export type InspectedPanel = { id: string; title: string; frame: WindowFrame; preferred: WindowFrame; locked: boolean };
export type GridInspection = {
  items: InspectedPanel[]; selected: string | null; width: number;
  select: (id: string) => void;
  edit: (id: string, patch: Partial<WindowFrame>) => void;
  reorder: (id: string, direction: number) => void;
  reset: () => void; disabled: boolean;
  unavailableReason?: string;
  undo?: () => void; redo?: () => void; canUndo?: boolean; canRedo?: boolean;
};

/** A view of the real immediate children, with the same commit/collision path
 * as the workspace. No second layout or permanently mounted empty cells. */
export function PanelGridInspector({ inspection }: { inspection: GridInspection }) {
  const { items, selected, select, edit, reorder, reset, disabled } = inspection;
  const active = items.find(item => item.id === selected);
  const width = Math.max(1, inspection.width, ...items.map(item => item.frame.x + item.frame.width));
  const height = Math.max(1, ...items.map(item => item.frame.y + item.frame.height));
  return <section className="panel-grid-inspector" aria-label="Immediate child panels">
    {items.length ? <>
      <div className="panel-grid-map" style={{ aspectRatio: `${width} / ${height}`, maxHeight: 260 }} role="group" aria-label="Current panel arrangement">
        {items.map(item => <button type="button" key={item.id} title={`${item.title}: ${Math.round(item.frame.width)} × ${Math.round(item.frame.height)}`}
          aria-label={`Select ${item.title}`} aria-pressed={selected === item.id} data-inspector-panel={item.id}
          style={{ left: `${item.frame.x / width * 100}%`, top: `${item.frame.y / height * 100}%`, width: `${item.frame.width / width * 100}%`, height: `${item.frame.height / height * 100}%` }}
          onClick={() => select(item.id)}>{item.title}{item.locked ? ' 🔒' : ''}</button>)}
      </div>
      <label>Selected child<select aria-label="Selected child panel" value={active?.id || ''} onChange={event => select(event.target.value)}>
        <option value="">Choose a child</option>{items.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
      {active && <>
        <p>{active.title} · current {Math.round(active.frame.width)} × {Math.round(active.frame.height)} px</p>
        <div className="inspector-dimensions">{(['x', 'y', 'width', 'height'] as const).map(field =>
          <Dimension key={`${active.id}:${field}:${active.preferred[field]}`} field={field} value={active.preferred[field]} disabled={disabled || active.locked}
            onCommit={value => edit(active.id, { [field]: value })} />)}</div>
        <div className="adaptive-actions">
          <AdaptiveButton icon={<ArrowUp />} label="Move earlier" disabled={disabled || active.locked || items[0].id === active.id} onClick={() => reorder(active.id, -1)} />
          <AdaptiveButton icon={<ArrowDown />} label="Move later" disabled={disabled || active.locked || items[items.length - 1].id === active.id} onClick={() => reorder(active.id, 1)} />
        </div>
      </>}
      <p>Edit preferred positions and sizes in pixels. Narrow parents reflow without replacing these values. Changes use the workspace’s collision rules.</p>
    </> : <p>This panel has no immediate children. Merge a Child Panel into it to arrange children here.</p>}
    <AdaptiveButton icon={<RotateCcw />} label="Reset this panel layout" disabled={disabled} onClick={reset} />
    {inspection.undo && <div className="adaptive-actions">
      <AdaptiveButton icon={<Undo2 />} label="Undo layout" disabled={!inspection.canUndo} onClick={inspection.undo} />
      <AdaptiveButton icon={<Redo2 />} label="Redo layout" disabled={!inspection.canRedo} onClick={inspection.redo} />
    </div>}
    {disabled && <p>{inspection.unavailableReason || 'Unlock this panel and its children to edit their arrangement.'}</p>}
  </section>;
}

function Dimension({ field, value, disabled, onCommit }: { field: keyof WindowFrame; value: number; disabled: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(Math.round(value)));
  const commit = () => {
    const next = Number(draft);
    if (draft.trim() && Number.isFinite(next) && next >= (field === 'width' ? 48 : field === 'height' ? 100 : 0) && next <= 20000) onCommit(next);
    else setDraft(String(Math.round(value)));
  };
  return <label>{field === 'x' ? 'Left' : field === 'y' ? 'Top' : field === 'width' ? 'Width' : 'Height'}
    <input type="number" aria-label={`Preferred ${field}`} value={draft} disabled={disabled} min={field === 'width' ? 48 : field === 'height' ? 100 : 0} max={20000} step={1}
      onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
  </label>;
}
