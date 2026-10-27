import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Toolbar menus live outside resizable/scrolling panel shells. */
export function ToolbarPopover({ label, icon, children, className = '' }: {
  label: string; icon: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useBrowserLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    let frame = 0;
    const place = () => {
      const anchor = trigger.current!.getBoundingClientRect();
      const popup = menu.current!;
      const below = Math.max(0, window.innerHeight - anchor.bottom - 16);
      const above = Math.max(0, anchor.top - 16);
      const up = popup.scrollHeight > below && above > below;
      const maxHeight = Math.max(40, up ? above : below);
      const height = Math.min(popup.scrollHeight, maxHeight);
      const left = Math.max(8, Math.min(window.innerWidth - popup.offsetWidth - 8, anchor.right - popup.offsetWidth));
      const top = Math.max(8, Math.min(window.innerHeight - height - 8, up ? anchor.top - height - 8 : anchor.bottom + 8));
      setPosition(previous => previous.left === left && previous.top === top && previous.maxHeight === maxHeight ? previous : { left, top, maxHeight });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    place();
    const observer = new ResizeObserver(schedule);
    observer.observe(trigger.current); observer.observe(menu.current);
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
    menu.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent | FocusEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('focusin', dismiss);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusin', dismiss); };
  }, [open]);
  return <div className={`tools-menu toolbar-popover relative shrink-0 ${className}`}>
    <button ref={trigger} type="button" aria-label={label} title={label} aria-expanded={open} aria-controls={open ? id : undefined}
      className="toolbar-popover-trigger inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-stone-200 bg-white p-2 text-stone-700 transition hover:bg-stone-50"
      onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); }
        if (event.key === 'Escape') setOpen(false);
      }}>{icon}</button>
    {open && createPortal(<div ref={menu} id={id} role="region" aria-label={label} className="toolbar-popover-menu"
      style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }}
      onClick={event => { if ((event.target as Element).closest('button')) setOpen(false); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          if (!buttons.length) return;
          event.preventDefault();
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus();
        }
      }}>{children}</div>, document.body)}
  </div>;
}
