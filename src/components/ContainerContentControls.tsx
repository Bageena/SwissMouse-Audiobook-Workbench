import React, { useEffect, useRef } from 'react';
import { GripVertical, Scaling } from 'lucide-react';
import type { WindowFrame } from '../utils/desktopLayout';

/** Imperative preview avoids rerendering an editor or a library on each frame. */
export function ContainerContentControls({ title, element, frame, step, minimumWidth, onCommit }: {
  title: string; element: React.RefObject<HTMLDivElement>; frame: WindowFrame; step: number; minimumWidth: number;
  onCommit: (frame: WindowFrame) => void;
}) {
  const drag = useRef<{ x: number; y: number; resize: boolean; next: WindowFrame; style: string }>();
  const raf = useRef<number>();
  const restore = () => {
    if (raf.current !== undefined) cancelAnimationFrame(raf.current); raf.current = undefined;
    if (drag.current && element.current) element.current.style.cssText = drag.current.style;
    drag.current = undefined;
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); restore(); } };
    window.addEventListener('keydown', escape, true); window.addEventListener('blur', restore);
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', restore); restore(); };
  }, []);
  const handlers = (resize: boolean) => ({
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      drag.current = { x: event.clientX, y: event.clientY, resize, next: frame, style: element.current!.style.cssText };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      const active = drag.current; if (!active) return; event.stopPropagation();
      const dx = event.clientX - active.x, dy = event.clientY - active.y;
      active.next = resize ? { ...frame, width: Math.max(minimumWidth, frame.width + dx), height: Math.max(100, frame.height + dy) }
        : { ...frame, x: Math.max(0, frame.x + dx), y: Math.max(36, frame.y + dy) };
      if (raf.current === undefined) raf.current = requestAnimationFrame(() => {
        raf.current = undefined; const d = drag.current; if (!d || !element.current) return;
        if (d.resize) { element.current.style.width = `${d.next.width}px`; element.current.style.height = `${d.next.height}px`; }
        else element.current.style.transform = `translate(${d.next.x - frame.x}px, ${d.next.y - frame.y}px)`;
      });
    },
    onPointerUp: (event: React.PointerEvent) => {
      if (!drag.current) return; event.stopPropagation();
      const next = drag.current.next; restore(); onCommit(next);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: restore,
    onLostPointerCapture: restore,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); const amount = Math.max(8, step) * (event.shiftKey ? 4 : 1);
      const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
      const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
      onCommit(resize ? { ...frame, width: Math.max(minimumWidth, frame.width + dx), height: Math.max(100, frame.height + dy) }
        : { ...frame, x: Math.max(0, frame.x + dx), y: Math.max(36, frame.y + dy) });
    },
  });
  return <div className="container-content-controls" role="group" aria-label={`Arrange ${title} content`}>
    <button type="button" aria-label={`Move ${title} content`} title="Move content; arrow keys adjust position" {...handlers(false)}><GripVertical aria-hidden="true" />Content</button>
    <button type="button" aria-label={`Resize ${title} content`} title="Resize content; arrow keys adjust size" {...handlers(true)}><Scaling aria-hidden="true" /></button>
  </div>;
}
