import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Magnet } from 'lucide-react';
import { magneticFrame, type MagnetSnap, type MagnetTarget } from '../utils/containerLayout';
import type { WindowFrame } from '../utils/desktopLayout';

type Props = {
  corner?: boolean; disabled?: boolean; selected?: boolean; onSelect?: () => void; onAssign?: () => void;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
  title: string; getFrame: () => WindowFrame; getTargets: () => MagnetTarget[];
  onDrop: (frame: WindowFrame, snap?: MagnetSnap, snaps?: MagnetSnap[]) => void; onActiveChange: (active: boolean) => void;
  topInset?: number;
  onPreview?: (frame?: WindowFrame) => void;
};
/** Only this lightweight ghost renders during a magnetic drag. Cache the small
 * window registry once at pickup; never measure catalog items on pointermove. */
export function ContainerMagnet(props: Props) {
  const latest = useRef(props); latest.current = props;
  const button = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; frame: WindowFrame; targets: MagnetTarget[]; held?: MagnetSnap; moved: boolean }>();
  const pending = useRef<WindowFrame>();
  const raf = useRef<number>();
  const [preview, setPreview] = useState<{ frame: WindowFrame; snap?: MagnetSnap }>();
  const cancel = () => {
    const old = drag.current; drag.current = undefined; pending.current = undefined;
    if (raf.current !== undefined) cancelAnimationFrame(raf.current); raf.current = undefined;
    if (old && button.current?.hasPointerCapture(old.pointerId)) button.current.releasePointerCapture(old.pointerId);
    setPreview(undefined); latest.current.onPreview?.(); latest.current.onActiveChange(false);
  };
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag.current) { e.preventDefault(); e.stopPropagation(); cancel(); } };
    window.addEventListener('keydown', escape, true); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', cancel); cancel(); };
  }, []);
  const resolve = (frame: WindowFrame) => {
    const d = drag.current!;
    const result = magneticFrame(frame, d.targets, d.held, latest.current.topInset); d.held = result.snap; return result;
  };
  return <>
    <button ref={button} type="button" disabled={props.disabled} aria-pressed={props.selected} className={`desktop-window-magnet ${props.corner ? 'desktop-window-corner' : ''}`} aria-label={`${props.corner ? 'Corner handle: Magnet Move' : 'Magnet Move'} ${props.title}`}
      title={props.corner ? 'Corner handle: Magnet Move. Drag or use arrow keys. Right-click or use Window options to assign a tool.' : 'Magnet Move: drag to snap edges. Double-click to assign the corner handle. Arrow keys move; Shift moves farther.'}
      onClick={props.onSelect} onDoubleClick={props.onAssign} onContextMenu={props.onContextMenu}
      onPointerDown={event => {
        if (props.disabled || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
        const frame = props.getFrame(), targets = props.getTargets();
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, frame, targets, held: magneticFrame(frame, targets, undefined, props.topInset).snap, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const d = drag.current; if (!d || d.pointerId !== event.pointerId) return;
        event.stopPropagation();
        if (!d.moved && Math.hypot(event.clientX - d.x, event.clientY - d.y) < 3) return;
        if (!d.moved) { d.moved = true; props.onActiveChange(true); }
        pending.current = { ...d.frame, x: d.frame.x + event.clientX - d.x, y: d.frame.y + event.clientY - d.y };
        if (raf.current === undefined) raf.current = requestAnimationFrame(() => {
          raf.current = undefined;
          if (drag.current && pending.current) { const result = resolve(pending.current); latest.current.onPreview?.(result.frame); setPreview(result); }
        });
      }}
      onPointerUp={event => {
        const d = drag.current; if (!d || d.pointerId !== event.pointerId) return;
        event.stopPropagation();
        const result = resolve({ ...d.frame, x: d.frame.x + event.clientX - d.x, y: d.frame.y + event.clientY - d.y });
        cancel(); if (d.moved) props.onDrop(result.frame, result.snap, result.snaps);
      }}
      onPointerCancel={cancel} onLostPointerCapture={() => { if (drag.current) cancel(); }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const frame = props.getFrame(), amount = event.shiftKey ? 48 : 12;
        const result = magneticFrame({ ...frame, x: frame.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0),
          y: frame.y + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0) }, props.getTargets(), undefined, props.topInset);
        props.onDrop(result.frame, result.snap, result.snaps);
      }}><Magnet aria-hidden="true" /></button>
    {preview && createPortal(<div className="desktop-connector-overlay" aria-hidden="true">
      <div className={`desktop-magnet-ghost ${preview.snap ? 'is-snapped' : ''}`}
        data-snapped={!!preview.snap} data-snap-target={preview.snap ? `${preview.snap.id}:${preview.snap.side}` : undefined}
        style={{ left: 0, top: 0, transform: `translate3d(${preview.frame.x}px, ${preview.frame.y}px, 0)`, width: preview.frame.width, height: preview.frame.height }} />
      <div className="desktop-connector-hint" style={{ left: Math.max(8, Math.min(window.innerWidth - 300, preview.frame.x)), top: Math.max(8, Math.min(window.innerHeight - 80, preview.frame.y + 36)) }}>
        <strong>{preview.snap ? `Snapped to ${preview.snap.title}` : 'Magnet move'}</strong>
        <span>{preview.snap ? 'Pull farther to release' : 'Bring container edges together'} · Esc cancels</span>
      </div>
    </div>, document.body)}
  </>;
}
