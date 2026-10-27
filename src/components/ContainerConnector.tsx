import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WindowFrame } from '../utils/desktopLayout';
import { dockLabels, dockPreviewFrame, findDockSnap, type DockSnap, type DockTarget } from '../utils/windowConnections';

type Props = {
  corner?: boolean; disabled?: boolean; selected?: boolean; onSelect?: () => void; onAssign?: () => void;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
  title: string;
  getFrame: () => WindowFrame;
  getTargets: () => DockTarget[];
  getInvalidTargets?: () => DockTarget[];
  onDrop: (frame: WindowFrame, snap?: DockSnap) => void;
  onActiveChange: (active: boolean) => void;
  onPreview?: (frame?: WindowFrame) => void;
  onOpenOptions: () => void;
};
type Gesture = { pointerId: number; x: number; y: number; point: { x: number; y: number }; frame: WindowFrame; started: boolean; snap?: DockSnap; targets: DockTarget[]; invalid: DockTarget[]; scrollY: number };

/** Preview first, then move the existing portal shell on release. Editors and
 * players remain mounted, and cancellation never changes a saved layout. */
export function ContainerConnector(props: Props) {
  const latest = useRef(props); latest.current = props;
  const button = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture>();
  const animation = useRef<number>();
  const [preview, setPreview] = useState<{ frame: WindowFrame; snap?: DockSnap; invalid?: string }>();
  const invalidAt = (active: Gesture, point: { x: number; y: number }) => active.invalid.find(({ frame: f }) => point.x >= f.x && point.x <= f.x + f.width && point.y >= f.y + active.scrollY - window.scrollY && point.y <= f.y + f.height + active.scrollY - window.scrollY)?.title;
  const cancel = () => {
    const active = gesture.current;
    gesture.current = undefined;
    if (animation.current !== undefined) cancelAnimationFrame(animation.current);
    animation.current = undefined;
    if (active && button.current?.hasPointerCapture(active.pointerId)) button.current.releasePointerCapture(active.pointerId);
    setPreview(undefined);
    latest.current.onPreview?.();
    latest.current.onActiveChange(false);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel(); }
    };
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', cancel);
    const scroll = () => { if (gesture.current?.started) schedule(); };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', cancel); window.removeEventListener('scroll', scroll); cancel(); };
  }, []);
  const refresh = () => {
    const active = gesture.current;
    if (!active?.started) return;
    const targets = active.targets.map(target => ({ ...target, frame: { ...target.frame, y: target.frame.y + active.scrollY - window.scrollY } }));
    active.snap = findDockSnap(active.point, targets, active.snap);
    // Follow the moving panel footprint, not the destination's docking zone.
    latest.current.onPreview?.({ ...active.frame, x: active.frame.x + active.point.x - active.x, y: active.frame.y + active.point.y - active.y });
    setPreview({ frame: { ...active.frame, x: active.frame.x + active.point.x - active.x, y: active.frame.y + active.point.y - active.y }, snap: active.snap, invalid: !active.snap ? invalidAt(active, active.point) : undefined });
  };
  const tick = () => {
    animation.current = undefined;
    const active = gesture.current;
    if (!active?.started) return;
    const distance = active.point.y < 56 ? active.point.y - 56 : active.point.y > window.innerHeight - 56 ? active.point.y - window.innerHeight + 56 : 0;
    const before = window.scrollY;
    if (distance) window.scrollBy(0, Math.max(-18, Math.min(18, distance / 3)));
    refresh();
    // A stationary pointer needs another frame only while edge scrolling can
    // actually move the document. Ordinary dragging updates once per input frame.
    if (distance && window.scrollY !== before) schedule();
  };
  const schedule = () => { if (animation.current === undefined) animation.current = requestAnimationFrame(tick); };
  const zone = preview?.snap && dockPreviewFrame(preview.snap);
  return <>
    <button ref={button} type="button" disabled={props.disabled} aria-pressed={props.selected} className={`desktop-window-connect ${props.corner ? 'desktop-window-corner' : ''}`} aria-label={`${props.corner ? 'Corner handle: Merge Move' : 'Merge Move'} ${props.title}`}
      title={props.corner ? 'Corner handle: Merge Move. Drag to attach or detach. Right-click or use Window options to assign a tool.' : 'Merge Move: drag to attach or detach. Double-click to assign the corner handle. Keyboard: Enter opens placement options.'}
      onDoubleClick={props.onAssign} onContextMenu={props.onContextMenu}
      onClick={event => { if (event.detail === 0) props.onOpenOptions(); }}
      onPointerDown={event => {
        if (props.disabled || event.button !== 0 || gesture.current) return;
        event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
        gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, point: { x: event.clientX, y: event.clientY }, frame: props.getFrame(), started: false, targets: props.getTargets(), invalid: props.getInvalidTargets?.() || [], scrollY: window.scrollY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const active = gesture.current;
        if (!active || active.pointerId !== event.pointerId) return;
        event.stopPropagation(); active.point = { x: event.clientX, y: event.clientY };
        if (!active.started && Math.hypot(event.clientX - active.x, event.clientY - active.y) >= 5) {
          active.started = true; props.onActiveChange(true);
        }
        if (active.started) schedule();
      }}
      onPointerUp={event => {
        const active = gesture.current;
        if (!active || active.pointerId !== event.pointerId) return;
        event.stopPropagation();
        const frame = { ...active.frame, x: active.frame.x + event.clientX - active.x, y: active.frame.y + event.clientY - active.y };
        const targets = active.targets.map(target => ({ ...target, frame: { ...target.frame, y: target.frame.y + active.scrollY - window.scrollY } }));
        const snap = findDockSnap({ x: event.clientX, y: event.clientY }, targets, active.snap);
        cancel();
        if (active.started && (snap || !invalidAt(active, { x: event.clientX, y: event.clientY }))) props.onDrop(frame, snap); else if (!active.started) props.onSelect?.();
      }}
      onPointerCancel={cancel} onLostPointerCapture={() => { if (gesture.current) cancel(); }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)" /></svg>
    </button>
    {preview && createPortal(<div className="desktop-connector-overlay" aria-hidden="true">
      {zone && <div className="desktop-connector-snap" data-side={preview.snap!.side} data-snap-target={`${preview.snap!.id}:${preview.snap!.side}`} style={{ left: 0, top: 0, transform: `translate3d(${zone.x}px, ${zone.y}px, 0)`, width: zone.width, height: zone.height }} />}
      <div className={`desktop-connector-ghost ${zone ? 'is-snapped' : ''}`} data-snapped={!!zone} data-snap-target={preview.snap ? `${preview.snap.id}:${preview.snap.side}` : undefined} style={{ left: 0, top: 0, transform: `translate3d(${zone?.x ?? preview.frame.x}px, ${zone?.y ?? preview.frame.y}px, 0)`, width: zone?.width ?? preview.frame.width, height: zone?.height ?? Math.min(260, preview.frame.height) }} />
      <div className="desktop-connector-hint" style={{ left: Math.max(12, Math.min(window.innerWidth - 300, gesture.current!.point.x - 140)), top: Math.max(12, Math.min(window.innerHeight - 85, gesture.current!.point.y + 24)) }}>
        <strong>{preview.invalid ? `Cannot merge with ${preview.invalid}` : preview.snap ? `${dockLabels[preview.snap.side]} in ${preview.snap.title}` : 'Release to place freely'}</strong>
        <span>{preview.invalid ? 'Release to cancel' : preview.snap ? 'Release to connect' : 'Move near a container edge to connect'} · Esc cancels</span>
      </div>
    </div>, document.body)}
  </>;
}
