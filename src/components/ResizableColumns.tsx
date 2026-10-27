import React, { useRef, useState } from 'react';
import { useDesktopWorkspace } from './DesktopWorkspace';

export function ResizableColumns({ children, storageKey, initialRatio = 68, label = 'Resize workspace panels' }: {
  children: React.ReactNode; storageKey: string; initialRatio?: number; label?: string;
}) {
  const desktop = useDesktopWorkspace();
  const clamp = (value: number) => Math.min(78, Math.max(25, value));
  const [ratio, setRatio] = useState(() => {
    try { const value = localStorage.getItem(`swissmouse-panel-${storageKey}`); return value !== null && Number.isFinite(Number(value)) ? clamp(Number(value)) : initialRatio; }
    catch { return initialRatio; }
  });
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const liveRatio = useRef(ratio);
  const update = (value: number) => { liveRatio.current = clamp(value); setRatio(liveRatio.current); };
  const persist = () => { try { localStorage.setItem(`swissmouse-panel-${storageKey}`, String(liveRatio.current)); } catch { /* Session sizing still works. */ } };
  const panels = React.Children.toArray(children);
  const displayedRatio = desktop ? initialRatio : ratio;
  return <div ref={root} className={`workspace-columns ${desktop ? 'desktop-columns' : ''}`} style={{ '--sm-main-ratio': `${displayedRatio}fr`, '--sm-aside-ratio': `${100 - displayedRatio}fr` } as React.CSSProperties}>
    <div className="min-w-0">{panels[0]}</div>
    {!desktop && <div role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={25} aria-valuemax={78} aria-valuenow={Math.round(ratio)} tabIndex={0} className="workspace-divider"
      title="Drag to resize. Arrow keys adjust; double-click resets."
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (!dragging.current || !root.current) return; const bounds = root.current.getBoundingClientRect(); update((event.clientX - bounds.left) / bounds.width * 100); }}
      onPointerUp={event => { dragging.current = false; persist(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { dragging.current = false; persist(); }} onLostPointerCapture={() => { dragging.current = false; }}
      onDoubleClick={() => { update(initialRatio); persist(); }}
      onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); update(event.key === 'Home' ? initialRatio : liveRatio.current + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 5 : 2)); persist(); } }} />}
    <div className="min-w-0">{panels[1]}</div>
  </div>;
}
