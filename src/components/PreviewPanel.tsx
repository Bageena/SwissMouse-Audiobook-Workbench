import React from 'react';
import { DesktopWindow } from './DesktopWorkspace';

/** A compact live view: callers supply React content from their existing state. */
export function PreviewPanel({ id, title, children, className = '' }: {
  id: string; title: string; children: React.ReactNode; className?: string;
}) {
  return <DesktopWindow id={id} title={title} kind="preview" minimumWidth={160}>
    <section aria-label={title} className={`preview-panel ${className}`}>
      <header className="workspace-panel-header preview-panel-header"><h2>{title}</h2></header>
      <div className="preview-panel-content">{children}</div>
    </section>
  </DesktopWindow>;
}
