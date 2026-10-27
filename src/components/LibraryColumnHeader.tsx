import React, { useRef } from 'react';

export function LibraryColumnHeader({ label, width, defaultWidth, onResize, children }: {
  label: string; width: number; defaultWidth: number; onResize: (width: number) => void; children: React.ReactNode;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const resize = (value: number) => onResize(Math.max(48, Math.min(1200, Math.round(value))));
  return <th className="library-column-header whitespace-nowrap p-2 pr-4">
    {children}
    <span role="separator" aria-label={`Resize ${label} column`} aria-orientation="vertical" aria-valuemin={48} aria-valuemax={1200} aria-valuenow={width} tabIndex={0} className="library-column-resizer"
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current) resize(drag.current.width + event.clientX - drag.current.x); }}
      onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onClick={event => event.stopPropagation()} onDoubleClick={() => resize(defaultWidth)}
      onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); resize(event.key === 'Home' ? defaultWidth : width + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 10)); } }}
      title="Drag to resize; arrow keys adjust width; double-click or Home resets" />
  </th>;
}
