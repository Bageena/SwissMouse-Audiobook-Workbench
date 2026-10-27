import React, { useRef } from 'react';
import { DesktopWindow, ToolbarPanelGrip, useDesktopWorkspace } from './DesktopWorkspace';
import { PanelOrientationToggle, usePanelOrientation } from './PanelOrientationToggle';
export function ToolbarPanel({ id, title = 'Toolbar', homeWindow, children, defaultHorizontal = true }: {
  id: string; title?: string; homeWindow?: string; children: React.ReactNode; defaultHorizontal?: boolean;
}) {
  const { horizontal, setHorizontal, attached } = usePanelOrientation(id, defaultHorizontal);
  const desktop = useDesktopWorkspace();
  const actions = useRef<HTMLDivElement>(null);
  const changeOrientation = () => {
    const frame = desktop?.state.frames[id];
    if (!desktop || !frame || !actions.current) { setHorizontal(!horizontal); return; }
    const commands = [...actions.current.children].filter(element => !element.matches('.toolbar-panel-grip, .navigation-layout-toggle'));
    const sizes = commands.map(element => element.getBoundingClientRect());
    const nextHorizontal = !horizontal;
    // Turning a free strip fits its commands, rather than leaving a short scroll box.
    const width = nextHorizontal ? 20 + 32 + sizes.reduce((sum, size) => sum + size.width, 0) + (sizes.length + 1) * 6 + 42
      : Math.max(40, ...sizes.map(size => size.width)) + 42;
    const height = nextHorizontal ? Math.max(40, ...sizes.map(size => size.height)) + 12
      : 20 + 32 + sizes.reduce((sum, size) => sum + size.height, 0) + (sizes.length + 1) * 6 + 12;
    desktop.commit(state => ({ ...state, panels: { ...state.panels, [id]: { ...state.panels[id], horizontal: nextHorizontal } },
      frames: { ...state.frames, [id]: { ...frame, width, height } } }));
  };
  return <DesktopWindow id={id} title={title} role="child" homeWindow={homeWindow} definitionId="swissmouse.toolbar">
    <div className="standard-toolbar-panel" data-orientation={horizontal ? 'horizontal' : 'vertical'} data-attached={attached}
      style={{ '--sm-toolbar-command-count': Math.max(1, React.Children.toArray(children).length) } as React.CSSProperties}>
      <div ref={actions} role="toolbar" aria-label={title} aria-orientation={horizontal ? 'horizontal' : 'vertical'} className="standard-toolbar-actions"><ToolbarPanelGrip />{!attached && <PanelOrientationToggle layoutName="toolbar" horizontal={horizontal} onChange={changeOrientation} />}{children}</div>
    </div>
  </DesktopWindow>;
}
