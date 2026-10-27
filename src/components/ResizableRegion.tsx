import React, { useEffect, useRef, useState } from 'react';
import { readStored, writeStored } from '../utils/libraryWorkspace';
import { useDesktopWorkspace } from './DesktopWorkspace';

/** Resize the panel itself, keeping its intrinsic readable content as the floor. */
export function ResizableRegion({ children, storageKey, label, enabled = true }: {
  children: React.ReactNode; storageKey: string; label: string; enabled?: boolean;
}) {
  const desktop = useDesktopWorkspace();
  enabled = enabled && !desktop;
  const key = `swissmouse-region-${storageKey}`;
  const [height, setHeight] = useState<number | undefined>(() => {
    const saved = readStored<number>(key, 0);
    return Number.isFinite(saved) && saved >= 120 && saved <= 2000 ? saved : undefined;
  });
  const body = useRef<HTMLDivElement>(null);
  const [minimum, setMinimum] = useState(120);
  const [actualHeight, setActualHeight] = useState(120);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const live = useRef(height);
  const maximum = Math.max(2000, minimum);
  const resize = (value: number) => { live.current = Math.max(minimum, Math.min(maximum, Math.round(value))); setHeight(live.current); };
  const persist = () => writeStored(key, live.current ?? 0);
  const reset = () => { live.current = undefined; setHeight(undefined); persist(); };
  useEffect(() => {
    const element = body.current;
    if (!enabled || !element) return;
    const measure = () => {
      // Read the natural layout at the current width without painting an
      // intermediate size. No scale transforms or clipped form controls.
      const requested = element.style.minHeight;
      element.style.minHeight = '0px';
      const floor = Math.max(120, Math.ceil(element.getBoundingClientRect().height));
      element.style.minHeight = requested;
      setMinimum(previous => previous === floor ? previous : floor);
      const actual = Math.ceil(element.getBoundingClientRect().height);
      setActualHeight(previous => previous === actual ? previous : actual);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const mutations = new MutationObserver(measure);
    mutations.observe(element, { subtree: true, childList: true, characterData: true });
    element.addEventListener('input', measure);
    element.addEventListener('change', measure);
    element.addEventListener('toggle', measure, true);
    return () => { observer.disconnect(); mutations.disconnect(); element.removeEventListener('input', measure); element.removeEventListener('change', measure); element.removeEventListener('toggle', measure, true); };
  }, [enabled, storageKey]);
  if (!enabled) return <>{children}</>;
  return <div className="resizable-region min-w-0">
    <div ref={body} style={{ minHeight: height }} className="resizable-region-body min-w-0">{children}</div>
    <div role="separator" aria-label={`Resize ${label} height`} aria-orientation="horizontal" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={actualHeight} tabIndex={0} className="workspace-row-divider"
      title="Drag to resize height. Arrow keys adjust; double-click or Home restores automatic height."
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { y: event.clientY, height: body.current?.getBoundingClientRect().height || 120 }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current) resize(drag.current.height + event.clientY - drag.current.y); }}
      onPointerUp={event => { drag.current = null; persist(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; persist(); }} onLostPointerCapture={() => { drag.current = null; }} onDoubleClick={reset}
      onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); if (event.key === 'Home') reset(); else { resize((body.current?.getBoundingClientRect().height ?? minimum) + (event.key === 'ArrowUp' ? -1 : 1) * (event.shiftKey ? 80 : 20)); persist(); } } }} />
  </div>;
}
