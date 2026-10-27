import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useDesktopWorkspace } from './DesktopWorkspace';
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
export const HEADER_PANEL_ID = 'application-header';
export function HeaderDockSurface({ brand, player, tools, fixedTools, corner }: { brand: React.ReactNode; player: React.ReactNode; tools: React.ReactNode; fixedTools?: React.ReactNode; corner?: React.ReactNode }) {
  const desktop = useDesktopWorkspace();
  const surface = useRef<HTMLElement>(null), row = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null), top = useRef<HTMLDivElement>(null), bottom = useRef<HTMLDivElement>(null), under = useRef<HTMLDivElement>(null);
  const register = desktop?.register;
  const latestDesktop = useRef(desktop); latestDesktop.current = desktop;
  const playerSize = desktop?.state.panels['header-media-player']?.headerSize || desktop?.state.layouts[HEADER_PANEL_ID]?.items['header-media-player'];
  const playerAtHome = !desktop?.windows.has('header-media-player') || (desktop.groups['header-media-player'] === HEADER_PANEL_ID && !desktop.connections['header-media-player']);
  const sideWidth = (side: 'left' | 'right') => {
    if (!desktop) return side === 'right' ? 276 : 0;
    const entries = Object.entries(desktop.groups).filter(([id, owner]) => owner === HEADER_PANEL_ID
      && (desktop.connections[id]?.side || (id === 'header-toolbar' ? 'right' : 'center')) === side);
    return entries.length ? Math.min(1200, entries.reduce((sum, [id]) => {
      const entry = desktop.windows.get(id);
      const preferred = desktop.state.panels[id]?.headerSize || desktop.state.layouts[HEADER_PANEL_ID]?.items[id];
      return sum + (preferred ? Math.max(entry?.minimumWidth || 48, preferred.width) : Math.max(entry?.toolbar || id === 'header-toolbar' ? 276 : 244, entry?.minimumWidth || 48));
    }, 0)) : 0;
  };
  useBrowserLayoutEffect(() => {
    if (!register || !surface.current || !row.current) return;
    return register(HEADER_PANEL_ID, {
      fixedSurface: true, title: 'Application Header', role: 'parent', minimumWidth: 280,
      host: row.current, surface: surface.current as HTMLDivElement, content: row.current, dock: right.current!,
      docks: { left: left.current!, right: right.current!, top: top.current!, bottom: bottom.current!, header: under.current! },
      getDockTargets: () => {
        const bounds = surface.current!.getBoundingClientRect();
        const playerBounds = row.current!.querySelector<HTMLElement>('.header-player-home')!.getBoundingClientRect();
        const player = playerBounds.width ? playerBounds : { left: bounds.left + bounds.width * .4, right: bounds.left + bounds.width * .65 };
        return [
          { id: HEADER_PANEL_ID, title: 'Header · left of player', sides: ['left'], frame: { x: Math.max(bounds.left, player.left - 80), y: bounds.top, width: 96, height: bounds.height } },
          { id: HEADER_PANEL_ID, title: 'Header · right of player', sides: ['right'], frame: { x: player.right - 16, y: bounds.top, width: Math.max(96, bounds.right - player.right), height: bounds.height } },
        ];
      },
      preparePopOut() {}, reveal() {}, resizeChild(id, patch) {
        const current = latestDesktop.current;
        const entry = current?.windows.get(id);
        if (!current || !entry) return;
        const bounds = entry.surface.getBoundingClientRect();
        current.setPreferences(id, { headerSize: {
          width: Math.max(entry.minimumWidth, Math.min(680, patch.width ?? bounds.width)),
          height: Math.max(entry.toolbar ? 48 : 100, Math.min(500, patch.height ?? bounds.height)),
        } });
      },
    });
  }, [register]);
  useBrowserLayoutEffect(() => {
    if (!desktop) return;
    const mounts: HTMLElement[] = [];
    for (const [id, entry] of desktop.windows) {
      if (desktop.groups[id] !== HEADER_PANEL_ID) continue;
      const size = desktop.state.panels[id]?.headerSize || desktop.state.layouts[HEADER_PANEL_ID]?.items[id];
      if (!size) continue;
      const host = entry.host;
      const wrapper = host.parentElement;
      const elements = wrapper?.classList.contains('desktop-window-slot') ? [host, wrapper] : [host];
      for (const element of elements) {
        element.dataset.headerSized = 'true';
        element.style.setProperty('--sm-header-item-width', `${size.width}px`);
        element.style.setProperty('--sm-header-item-height', `${size.height}px`);
        mounts.push(element);
      }
    }
    return () => mounts.forEach(element => {
      delete element.dataset.headerSized;
      element.style.removeProperty('--sm-header-item-width'); element.style.removeProperty('--sm-header-item-height');
    });
  }, [desktop?.state.panels, desktop?.state.layouts, desktop?.groups, desktop?.windows]);
  return <header ref={surface} className="app-header border-b border-stone-200/80 bg-white/95 text-stone-900 shadow-sm backdrop-blur-xl" data-header-container={HEADER_PANEL_ID}>
    <div className="header-fixed-tools">{fixedTools}</div>
    <div ref={top} className="header-edge-dock" data-header-dock="top" />
    <div ref={row} className="header-workspace-row mx-auto flex min-h-16 flex-wrap items-center gap-3 px-3 py-2 sm:px-5 lg:flex-nowrap lg:px-7 max-w-[1480px]">
      {brand}
      <div ref={left} aria-label="Header left docking area" data-header-dock="left" className="header-side-dock header-side-dock-left" style={{ width: sideWidth('left'), flexBasis: sideWidth('left') }} />
      <div className="header-player-home min-w-0 flex-1" hidden={!playerAtHome} style={playerSize ? { flexBasis: playerSize.width, flexGrow: 0, width: playerSize.width, height: playerSize.height, overflow: 'auto' } : undefined}>{player}</div>
      {corner}
      <div ref={right} aria-label="Header right docking area" data-header-dock="right" className="header-side-dock header-side-dock-right" style={{ width: sideWidth('right'), flexBasis: sideWidth('right') }}>{tools}</div>
    </div>
    <div ref={under} className="header-edge-dock" data-header-dock="header" />
    <div ref={bottom} className="header-edge-dock" data-header-dock="bottom" />
  </header>;
}
