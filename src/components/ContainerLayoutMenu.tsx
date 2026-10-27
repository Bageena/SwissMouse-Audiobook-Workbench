import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Grid2X2 } from 'lucide-react';
import { containerTypes, contentTypes, overlaps, snap, type ContainerKind, type ContainerLayout, type ContentKind } from '../utils/containerLayout';
import type { WindowFrame } from '../utils/desktopLayout';
import { PanelGridInspector, type GridInspection } from './PanelGridInspector';

export function ContainerLayoutMenu({ title, kind, content, layout, editing, width, onChange, onEdit, inspect, disabled = false }: {
  title: string; kind: ContainerKind; content: ContentKind; layout: ContainerLayout; editing: boolean; width: number;
  onChange: (layout: ContainerLayout) => void; onEdit: (editing: boolean) => void;
  inspect?: () => GridInspection; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [drawing, setDrawing] = useState<{ start: number; end: number }>();
  const [message, setMessage] = useState('');
  const [activeCell, setActiveCell] = useState(0);
  const [anchor, setAnchor] = useState({ left: 8, top: 8 });
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<{ start: number; end: number }>();
  const id = useId();
  const columns = 12, rows = 8;
  const unitX = Math.max(layout.gridSize, snap(Math.max(288, width) / columns, layout.gridSize));
  const unitY = Math.ceil(Math.max(120, layout.gridSize * 4) / layout.gridSize) * layout.gridSize;
  const regionFor = (selection: { start: number; end: number }): WindowFrame => {
    const x1 = selection.start % columns, y1 = Math.floor(selection.start / columns);
    const x2 = selection.end % columns, y2 = Math.floor(selection.end / columns);
    return { x: Math.min(x1, x2) * unitX, y: Math.min(y1, y2) * unitY + Math.ceil(36 / layout.gridSize) * layout.gridSize,
      width: (Math.abs(x2 - x1) + 1) * unitX, height: (Math.abs(y2 - y1) + 1) * unitY };
  };
  const close = () => { setOpen(false); button.current?.focus(); };
  const position = (event?: Event) => {
    if (event?.target instanceof Node && menu.current?.contains(event.target)) return;
    const rect = button.current!.getBoundingClientRect();
    const next = { left: Math.max(8, Math.min(window.innerWidth - 328, rect.right - 320)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 300)) };
    setAnchor(previous => previous.left === next.left && previous.top === next.top ? previous : next);
  };
  useEffect(() => {
    if (!open) return;
    position();
    menu.current?.querySelector<HTMLElement>('select')?.focus();
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element;
      // Keep inspection visible while selecting or editing the real children.
      if (target.closest('[data-desktop-window]') && !target.closest('.desktop-window-layout')) return;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  const cellAt = (event: React.PointerEvent) => {
    const rect = board.current!.getBoundingClientRect();
    return Math.min(rows - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * rows))) * columns
      + Math.min(columns - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * columns)));
  };
  const finishDrawing = (selection?: { start: number; end: number }) => {
    drawingRef.current = undefined; setDrawing(undefined);
    if (!selection) return;
    const region = regionFor(selection);
    if (layout.regions.some(r => overlaps(r, region))) { setMessage('Choose an empty area; regions cannot overlap.'); return; }
    if (layout.regions.length >= 64) { setMessage('This container already has 64 regions.'); return; }
    onChange({ ...layout, regions: [...layout.regions, region] });
    setMessage('Region added. Objects snap to the nearest region they fit.');
  };
  return <>
    <button ref={button} type="button" className="desktop-window-layout" aria-label={`Layout for ${title}`} title="Grid Inspector: inspect children, select, rearrange, and resize their preferred footprints"
      aria-expanded={open} aria-controls={id} onClick={() => { position(); setOpen(value => !value); }}><Grid2X2 aria-hidden="true" /></button>
    {open && createPortal(<div ref={menu} id={id} className="desktop-window-menu container-layout-menu" role="region" aria-label={`Layout for ${title}`}
      style={{ position: 'fixed', left: anchor.left, top: anchor.top, right: 'auto', width: 320, maxHeight: `calc(100vh - ${anchor.top + 12}px)`, zIndex: 10005 }}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <strong>{title}</strong>
      <p>{containerTypes[kind].name} · {contentTypes[content]}</p>
      {inspect && <PanelGridInspector inspection={inspect()} />}
      <fieldset disabled={disabled}>
      <legend>Layout settings</legend>
      <label>Content layout<select aria-label={`Content layout for ${title}`} value={layout.mode}
        onChange={event => { onChange({ ...layout, mode: event.target.value as ContainerLayout['mode'] }); onEdit(event.target.value !== 'original'); }}>
        <option value="original">Original layout</option><option value="grid">Grid</option><option value="canvas">Free canvas</option>
      </select></label>
      <label>Grid spacing<select aria-label={`Grid spacing for ${title}`} value={layout.gridSize}
        onChange={event => onChange({ ...layout, gridSize: Number(event.target.value) })}>
        {[8, 12, 16, 24, 32, 48].map(size => <option key={size} value={size}>{size} px</option>)}
      </select></label>
      {layout.mode !== 'original' && <>
        <label className="container-layout-check"><input type="checkbox" checked={editing} onChange={event => onEdit(event.target.checked)} />Arrange content</label>
        <label className="container-layout-check"><input type="checkbox" checked={layout.showGrid} onChange={event => onChange({ ...layout, showGrid: event.target.checked })} />Show guides while arranging</label>
      </>}
      {layout.mode === 'grid' && <details>
        <summary>Placement regions (advanced)</summary>
        <p>Draw a rectangle below to create a placement region. With a keyboard, choose its first and last cells.</p>
        <div ref={board} className="container-grid-designer" role="group" aria-label={`Draw grid regions for ${title}`}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? columns * rows - 1 : Math.max(0, Math.min(columns * rows - 1, activeCell + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns)));
            setActiveCell(next); board.current?.querySelector<HTMLButtonElement>(`[data-cell="${next}"]`)?.focus();
          }}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault(); event.stopPropagation();
            const cell = cellAt(event); drawingRef.current = { start: cell, end: cell }; setDrawing(drawingRef.current);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (!drawingRef.current) return;
            drawingRef.current = { ...drawingRef.current, end: cellAt(event) }; setDrawing(drawingRef.current);
          }}
          onPointerUp={event => { if (!drawingRef.current) return; finishDrawing({ ...drawingRef.current, end: cellAt(event) }); event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { drawingRef.current = undefined; setDrawing(undefined); }}>
          {Array.from({ length: columns * rows }, (_, cell) => {
            const rect = regionFor({ start: cell, end: cell });
            const occupied = layout.regions.some(r => overlaps(r, rect));
            return <button key={cell} type="button" aria-label={`Row ${Math.floor(cell / columns) + 1}, column ${cell % columns + 1}`}
              data-cell={cell} tabIndex={activeCell === cell ? 0 : -1} onFocus={() => setActiveCell(cell)}
              data-filled={occupied} data-selected={!!drawing && overlaps(regionFor(drawing), rect)}
              onClick={event => {
                if (event.detail !== 0) return;
                if (drawing) finishDrawing({ ...drawing, end: cell });
                else { setDrawing({ start: cell, end: cell }); setMessage('Choose the last cell of the region.'); }
              }} />;
          })}
        </div>
        <p>{layout.regions.length} regions · preview cells {unitX} × {unitY} px</p>
        {layout.regions.length > 0 && <button type="button" onClick={() => onChange({ ...layout, regions: layout.regions.slice(0, -1) })}>Undo last region</button>}
        {layout.regions.length > 0 && <button type="button" onClick={() => onChange({ ...layout, regions: [] })}>Clear regions</button>}
        <p role="status">{message}</p>
      </details>}
      <p>Moving a container changes its position. Arrange content moves the objects inside it.</p>
      </fieldset>
      <button type="button" onClick={() => { onEdit(false); close(); }}>Done</button>
    </div>, document.body)}
  </>;
}
