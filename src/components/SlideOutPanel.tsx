import React, { useEffect, useId, useRef, useState } from 'react';
import { PanelLeft, PanelRight, X } from 'lucide-react';
import { readStored, writeStored } from '../utils/libraryWorkspace';
import { getPanelDefinition } from '../workspace/panels';
import { useDesktopWorkspace } from './DesktopWorkspace';

/** An attached auxiliary surface. Its contents stay mounted when tucked away. */
export function SlideOutPanel({ id, title, homeWindow, children, main, side = 'left', defaultOpen = true }: {
  id: string; title: string; homeWindow: string; children: (open: boolean) => React.ReactNode;
  main: React.ReactNode; side?: 'left' | 'right'; defaultOpen?: boolean;
}) {
  const desktop = useDesktopWorkspace();
  const storageKey = `swissmouse-slide-out:${desktop?.page || 'workspace'}:${id}`;
  const [open, setOpen] = useState(() => readStored(storageKey, defaultOpen) === true);
  useEffect(() => { setOpen(readStored(storageKey, defaultOpen) === true); }, [storageKey, defaultOpen]);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId(), titleId = useId();
  const Icon = side === 'left' ? PanelLeft : PanelRight;
  const changeOpen = (value: boolean) => { setOpen(value); writeStored(storageKey, value); };
  const close = () => { changeOpen(false); trigger.current?.focus({ preventScroll: true }); };
  return <div className="slide-out-layout" data-open={open} data-side={side}>
    <div className="slide-out-toolbar">
      <button ref={trigger} type="button" className="slide-out-toggle" aria-expanded={open} aria-controls={panelId}
        title={`${open ? 'Hide' : 'Show'} ${title.toLowerCase()}`} onClick={() => changeOpen(!open)}>
        <Icon aria-hidden="true" /><span>{title}</span>
      </button>
    </div>
    <div className="slide-out-split">
      <aside id={panelId} className="slide-out-panel" aria-labelledby={titleId} aria-hidden={!open} {...(!open ? { inert: '' } : {})}
        data-container-definition="swissmouse.slide-out" data-panel-id={id} data-panel-name={getPanelDefinition(id)?.name || title}
        data-panel-role="child" data-home-window={homeWindow} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        }}>
        <div className="slide-out-sheet">
          <header className="slide-out-header"><h3 id={titleId}>{title}</h3><button type="button" aria-label={`Close ${title.toLowerCase()}`} title={`Close ${title.toLowerCase()}`} onClick={close}><X aria-hidden="true" /></button></header>
          <div className="slide-out-content">{children(open)}</div>
        </div>
      </aside>
      <div className="slide-out-main">{main}</div>
    </div>
  </div>;
}
