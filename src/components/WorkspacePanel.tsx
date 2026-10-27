import React, { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ResizableColumns } from './ResizableColumns';
import { ResizableRegion } from './ResizableRegion';
import { DesktopWindow } from './DesktopWorkspace';

/** Stable panel boundaries; placement and sizing belong to the workspace. */
export function WorkspacePanel({ id, title, actions, children, className = '', resizable = false, collapsible = false }: { id: string; title: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; resizable?: boolean; collapsible?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const bodyId = useId();
  return <DesktopWindow id={id} title={title}><ResizableRegion enabled={resizable} storageKey={id} label={title}><section data-collapsed={!expanded} aria-label={title} className={`workspace-panel min-w-0 rounded-xl border border-stone-200 bg-white shadow-sm ${className}`}>
    <header className={`workspace-panel-header workspace-toolbar flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${expanded ? 'border-b border-stone-200' : 'workspace-panel-header-collapsed'}`}>
      {collapsible ? <button type="button" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded(value => !value)} className="workspace-header-toggle flex min-w-0 flex-1 items-center justify-between gap-3 text-left"><h2 className={`workspace-panel-title text-sm font-bold ${expanded ? '' : 'workspace-panel-title-flat'}`}>{title}</h2>{expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}</button> : <h2 className="workspace-panel-title text-sm font-bold">{title}</h2>}{actions}
    </header>
    <div id={bodyId} hidden={!expanded}>{children}</div>
  </section></ResizableRegion></DesktopWindow>;
}

export function WorkspaceSplit({ main, aside }: { main: React.ReactNode; aside: React.ReactNode }) {
  return <ResizableColumns storageKey="book-files" label="Resize file manager and processing order">{main}{aside}</ResizableColumns>;
}
