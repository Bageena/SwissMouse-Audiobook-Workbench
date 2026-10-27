import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Scaling, GripVertical, LockKeyhole, Undo2, Redo2, Eye, EyeOff, Paperclip } from 'lucide-react';
import { canGroupWindow, type WindowGroups, constrainWindow as constrainDeskWindow, DESKTOP_RESET_EVENT, type WindowFrame } from '../utils/desktopLayout';
import { growDockFrame, connectWindow, dockLabels, dockSides, linkMagnet, magnetCluster, type MagnetLinks, type DockSide, type DockTarget, type WindowConnections } from '../utils/windowConnections';
import { ContainerConnector } from './ContainerConnector';
import { ContainerLayoutMenu } from './ContainerLayoutMenu';
import { ContainerMagnet } from './ContainerMagnet';
import { ContainerContentControls } from './ContainerContentControls';
import { AdaptiveButton } from './AdaptiveButton';
import { canDockPanel, filterPanelGroups, getPanelDefinition, type PanelRole } from '../workspace/panels';
import { cancelPanelSettle, revealPanel, settlePanel, type PanelPosition } from '../workspace/panelMotion';
import { LayoutHistory, loadWorkspaceState, saveWorkspaceState, handleModes, toolNames, type HandleMode, type WorkspaceState, type PanelPreferences } from '../workspace/workspaceState';
import { arrangeContainer, resolveContainerLayout, defaultContainerLayout, getContainerDefinition, validContainerLayout, placeContainerItem, containerTypes, type ContainerKind, type ContentKind, type ContainerLayout } from '../utils/containerLayout';

type RegisteredWindow = { getDockTargets?: () => DockTarget[]; fixedSurface?: boolean; toolbar?: boolean; title: string; role: PanelRole; minimumWidth: number; homeWindow?: string; preparePopOut: (frame?: WindowFrame) => void; host: HTMLDivElement; surface: HTMLDivElement; content: HTMLDivElement; dock: HTMLDivElement; docks: Record<DockSide, HTMLDivElement>; reveal: () => void; resizeChild: (id: string, frame: Partial<WindowFrame>) => void };
type Desktop = {
  windows: Map<string, RegisteredWindow>;
  groups: WindowGroups;
  connections: WindowConnections;
  register: (id: string, entry: RegisteredWindow) => () => void;
  group: (id: string, parent?: string, side?: DockSide, frame?: WindowFrame) => void;
  page: string; revision: number; width: number; enabled: boolean;
  bounds: { left: number; right: number };
  root: React.RefObject<HTMLDivElement>;
  foreground: string | null; activate: (id: string) => void;
  report: (id: string, bottom?: number) => void;
  layouts: Record<string, ContainerLayout>;
  setLayout: (id: string, layout: ContainerLayout, history?: boolean) => void;
  magnetLinks: MagnetLinks;
  setMagnetLink: (id: string, target?: string | string[]) => void;
  state: WorkspaceState;
  commit: (update: (state: WorkspaceState) => WorkspaceState, history?: boolean) => void;
  setFrames: (frames: Record<string, WindowFrame>, history?: boolean) => void;
  setPreferences: (id: string, preferences: Partial<PanelPreferences>) => void;
  resolvedLayouts: Record<string, ContainerLayout>;
  reportWidth: (id: string, width: number) => void;
  reportHeight: (id: string, height?: number) => void;
  capturePlacement: (...ids: (string | undefined)[]) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
};
const DesktopContext = createContext<Desktop | null>(null);
const ToolbarGripContext = createContext<React.ReactNode>(null);
/** The strip owns placement; DesktopWindow owns the controls and their state. */
export function ToolbarPanelGrip() { return <>{useContext(ToolbarGripContext)}</>; }
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
export const useDesktopWorkspace = () => useContext(DesktopContext);

/** Keep the existing default flow; customized windows can overlap anywhere on the page. */
export function DesktopWorkspace({ page, children }: { page: string; children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [bounds, setBounds] = useState({ left: 0, right: 0 });
  const [revision, setRevision] = useState(0);
  const [foreground, activate] = useState<string | null>(null);
  const [windows, setWindows] = useState(new Map<string, RegisteredWindow>());
  const [stored, setStored] = useState(() => loadWorkspaceState(page));
  const state = stored.workspaceId === page ? stored : loadWorkspaceState(page);
  const current = useRef(state); current.current = state;
  const history = useRef({ page, value: new LayoutHistory() });
  if (history.current.page !== page) history.current = { page, value: new LayoutHistory() };
  const commit = useCallback((update: (state: WorkspaceState) => WorkspaceState, remember = true) => {
    const before = current.current, next = update(before);
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    if (remember) history.current.value.checkpoint(before);
    current.current = next; setStored(next); saveWorkspaceState(next);
  }, []);
  const setFrames = useCallback((frames: Record<string, WindowFrame>, remember = true) => commit(s => ({ ...s, frames: { ...s.frames, ...frames } }), remember), [commit]);
  const setPreferences = (id: string, patch: Partial<PanelPreferences>) => commit(s => ({ ...s, panels: { ...s.panels, [id]: { handleMode: 'resize', locked: false, ...s.panels[id], ...patch } } }));
  const setLayout = useCallback((id: string, layout: ContainerLayout, remember = true) => commit(s => ({ ...s, layouts: { ...s.layouts, [id]: validContainerLayout(layout) } }), remember), [commit]);
  const layouts = useMemo(() => Object.fromEntries([...windows.keys()].map(id => [id, state.layouts[id] || defaultContainerLayout()])), [state.layouts, windows]);
  const [contentWidths, setContentWidths] = useState<Record<string, number>>({});
  const [contentHeights, setContentHeights] = useState<Record<string, number>>({});
  const reportWidth = useCallback((id: string, value: number) => {
    const rounded = Math.round(value);
    setContentWidths(previous => previous[id] === rounded ? previous : { ...previous, [id]: rounded });
  }, []);
  const reportHeight = useCallback((id: string, value?: number) => setContentHeights(previous => {
    if (value === undefined) { if (!(id in previous)) return previous; const next = { ...previous }; delete next[id]; return next; }
    const rounded = Math.ceil(value);
    return previous[id] === rounded ? previous : { ...previous, [id]: rounded };
  }), []);
  const resolvedLayouts = useMemo(() => Object.fromEntries(Object.entries(layouts).map(([id, layout]) => {
    const items = Object.fromEntries(Object.entries(layout.items).filter(([key]) => key === '$content' || state.groups[key] === id || (!Object.hasOwn(state.groups, key) && windows.get(key)?.homeWindow === id)));
    return [id, resolveContainerLayout({ ...layout, items }, contentWidths[id] || width, Object.fromEntries([...windows].map(([key, w]) => [key, w.minimumWidth])), contentHeights)];
  })), [layouts, contentWidths, contentHeights, width, windows, state.groups]);
  const pendingPlacement = useRef(new Map<string, PanelPosition>());
  const placementFrame = useRef<number>();
  const capturePlacement = (...ids: (string | undefined)[]) => {
    for (const id of ids) {
      const element = id && windows.get(id)?.surface;
      if (element) pendingPlacement.current.set(id!, element.getBoundingClientRect());
    }
  };
  useBrowserLayoutEffect(() => {
    if (!pendingPlacement.current.size) return;
    if (placementFrame.current !== undefined) cancelAnimationFrame(placementFrame.current);
    placementFrame.current = requestAnimationFrame(() => {
      placementFrame.current = undefined;
      const pending = pendingPlacement.current; pendingPlacement.current = new Map();
      for (const [id, before] of pending) { const element = windows.get(id)?.surface; if (element?.isConnected) settlePanel(element, before); }
    });
  }, [state.groups, state.connections, state.magnets, state.frames, windows]);
  useEffect(() => () => { if (placementFrame.current !== undefined) cancelAnimationFrame(placementFrame.current); }, []);
  const register = useCallback((id: string, entry: RegisteredWindow) => {
    setWindows(previous => new Map(previous).set(id, entry));
    return () => setWindows(previous => {
      if (previous.get(id) !== entry) return previous;
      const next = new Map(previous); next.delete(id); return next;
    });
  }, []);
  const groups = useMemo(() => filterPanelGroups({ ...Object.fromEntries([...windows].filter(([, w]) => w.role === 'child' && w.homeWindow).map(([id, w]) => [id, w.homeWindow!])), ...state.groups }, id => windows.get(id)?.role || (state.generated.some(p => p.id === id) ? 'parent' : getPanelDefinition(id)?.role)), [windows, state.groups, state.generated]);
  const connections = useMemo(() => Object.fromEntries(Object.entries(state.connections).filter(([id, c]) => groups[id] === c.parent && (windows.get(c.parent)?.fixedSurface || windows.get(id)?.toolbar || windows.get(id)?.homeWindow !== c.parent || layouts[c.parent]?.mode !== 'original'))), [state.connections, windows, layouts, groups]);
  const locked = (id: string) => !!current.current.panels[id]?.locked;
  const group = (id: string, target?: string, side?: DockSide, frame?: WindowFrame) => {
    const child = windows.get(id), destination = target ? windows.get(target) : undefined;
    if (!child || child.fixedSurface || locked(id) || (groups[id] && locked(groups[id])) || (target && locked(target))) return;
    if (target && (!destination || target === id || child.host.contains(destination.host))) return;
    if (child.role === 'parent' && destination?.role === 'child') {
      // A parent can collect an independent child while preserving its current
      // children. All parent targets still pass through the ancestry guard below.
      if (!target || destination?.role !== 'child' || groups[target]) return;
      const owner = child.surface.getBoundingClientRect(), c = destination.surface.getBoundingClientRect();
      const area = root.current!.getBoundingClientRect();
      const position = frame || { x: owner.left - area.left, y: owner.top - area.top, width: owner.width, height: owner.height };
      const layout = layouts[id];
      capturePlacement(id, target);
      commit(s => ({ ...s, groups: { ...s.groups, [target]: id }, connections: connectWindow(s.connections, target, id, side), magnets: s.magnets.filter(pair => !pair.includes(target)),
        frames: { ...s.frames, [id]: constrainDeskWindow(layout.mode === 'original' ? { ...growDockFrame(position, { x: 0, y: 0, width: c.width, height: c.height }, side || 'bottom'), x: position.x, width: position.width } : position, width, child.minimumWidth, bounds) },
        layouts: layout.mode === 'original' ? s.layouts : { ...s.layouts, [id]: { ...layout, items: { ...layout.items, [target]: placeContainerItem({ x: 0, y: 48, width: c.width, height: c.height }, layout, Object.values(layout.items), destination.minimumWidth) } } },
      }));
      child.reveal(); activate(target); return;
    }
    // Two independent children produce an organizational parent; neither child changes role.
    const generate = child.role === 'child' && destination?.role === 'child';
    if (generate && (groups[id] || groups[target!])) return;
    if (generate && current.current.generated.length >= 64) return;
    if (target && !generate && (!canDockPanel(child.role, destination!.role) || !canGroupWindow(groups, id, target))) return;
    const area = root.current!.getBoundingClientRect();
    const toFrame = (entry: RegisteredWindow): WindowFrame => { const b = entry.surface.getBoundingClientRect(); return { x: b.left - area.left, y: b.top - area.top, width: b.width, height: b.height }; };
    const childFrame = frame || toFrame(child);
    if (child.toolbar && side && destination) {
      const owner = destination.surface.getBoundingClientRect();
      childFrame.width = side === 'left' || side === 'right' ? 48 : owner.width;
      childFrame.height = side === 'left' || side === 'right' ? owner.height : 48;
    }
    let parent = target;
    if (!destination?.fixedSurface && !child.toolbar && target === child.homeWindow && layouts[target]?.mode === 'original') side = undefined;
    const before = current.current;
    let next = { ...before, groups: { ...before.groups }, frames: { ...before.frames }, layouts: { ...before.layouts }, connections: { ...before.connections }, magnets: before.magnets.filter(pair => !pair.includes(id)) };
    if (generate) {
      parent = `generated-parent-${crypto.randomUUID()}`;
      const other = toFrame(destination!);
      const first = side === 'left' || side === 'top' ? id : target!;
      const second = first === id ? target! : id;
      const row = side === 'left' || side === 'right';
      const frames = { [id]: childFrame, [target!]: other };
      next.generated = [...before.generated, { id: parent, title: `${destination!.title} & ${child.title}`.slice(0, 100), autoGenerated: true }];
      next.groups[target!] = parent;
      next.connections = connectWindow(next.connections, target!);
      next.magnets = next.magnets.filter(pair => !pair.includes(target!));
      next.layouts[parent] = { ...defaultContainerLayout(), mode: 'grid', items: {
        [first]: { x: 0, y: 48, width: frames[first].width, height: frames[first].height },
        [second]: { x: row ? frames[first].width + 24 : 0, y: row ? 48 : 84 + frames[first].height, width: frames[second].width, height: frames[second].height },
      } };
      next.frames[parent] = constrainDeskWindow({ x: other.x, y: other.y, width: row ? other.width + childFrame.width + 48 : Math.max(other.width, childFrame.width) + 32, height: Math.min(900, (row ? Math.max(other.height, childFrame.height) : other.height + childFrame.height) + 120) }, width, 280, bounds);
    }
    next.groups[id] = parent || '';
    next.connections = connectWindow(next.connections, id, parent, generate ? undefined : side);
    if (!parent) next.frames[id] = constrainDeskWindow(childFrame, width, child.minimumWidth, bounds);
    else if (!destination?.fixedSurface && !child.toolbar && !generate && layouts[parent]?.mode !== 'original') {
      const layout = layouts[parent];
      const p = destination!.content.getBoundingClientRect();
      const position = { ...childFrame, x: Math.max(0, childFrame.x + area.left - p.left), y: Math.max(48, childFrame.y + area.top - p.top) };
      next.layouts[parent] = { ...layout, items: { ...layout.items, [id]: placeContainerItem(position, layout, Object.entries(layout.items).filter(([key]) => key !== id).map(([, v]) => v), child.minimumWidth) } };
    } else if (!destination?.fixedSurface && !generate && parent && side && (groups[id] !== parent || connections[id]?.side !== side)) {
      const ownerFrame = toFrame(destination!);
      if (child.toolbar) {
        const previousSide = connections[id]?.parent === parent ? connections[id].side : child.homeWindow === parent ? 'header' : undefined;
        const previousRow = previousSide === 'left' || previousSide === 'right';
        const row = side === 'left' || side === 'right';
        next.frames[parent] = constrainDeskWindow({ ...ownerFrame,
          width: ownerFrame.width + (row ? 48 : 0) - (previousRow ? 48 : 0),
          height: ownerFrame.height + (row ? 0 : 48) - (previousSide && !previousRow ? 48 : 0),
        }, width, destination!.minimumWidth, bounds);
      } else next.frames[parent] = constrainDeskWindow({ ...growDockFrame(ownerFrame, childFrame, side), x: ownerFrame.x, width: ownerFrame.width }, width, destination!.minimumWidth, bounds);
    }
    capturePlacement(id, target);
    commit(() => next);
    if (parent) windows.get(parent)?.reveal();
    activate(id);
  };
  const setMagnetLink = (id: string, target?: string | string[]) => commit(s => ({ ...s, magnets: linkMagnet(s.magnets, id, target) }));
  const extents = useRef(new Map<string, number>());
  const [bottom, setBottom] = useState(0);
  const report = useCallback((id: string, value?: number) => {
    if (value === undefined) extents.current.delete(id); else extents.current.set(id, value);
    setBottom(Math.max(0, ...extents.current.values()));
  }, []);
  const restore = (direction: 'undo' | 'redo') => {
    const next = history.current.value[direction](current.current);
    if (!next) return;
    current.current = next; setStored(next); saveWorkspaceState(next); activate(null); setRevision(v => v + 1);
  };
  useBrowserLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      setWidth(element.clientWidth);
      const left = element.getBoundingClientRect().left;
      const right = document.documentElement.clientWidth - left;
      setBounds(previous => previous.left === -left && previous.right === right ? previous : { left: -left, right });
    };
    measure(); const observer = new ResizeObserver(measure);
    observer.observe(element); observer.observe(document.documentElement);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => {
    const reset = (event: Event) => {
      if ((event as CustomEvent).detail !== page) return;
      const next = loadWorkspaceState(page);
      history.current.value.checkpoint(current.current); current.current = next; setStored(next);
      extents.current.clear(); setBottom(0); activate(null); setRevision(value => value + 1);
    };
    window.addEventListener(DESKTOP_RESET_EVENT, reset);
    return () => window.removeEventListener(DESKTOP_RESET_EVENT, reset);
  }, [page]);
  const enabled = width >= 680;
  // Anchor preview notes to navigation without capturing its sticky scroll offset.
  useEffect(() => {
    if (!['step-1', 'step-2', 'step-4', 'step-5'].includes(page) || !enabled || !root.current) return;
    const noteId = page === 'step-5' ? 'final-check-workflow' : page === 'step-4' ? 'conversion-workflow' : page === 'step-2' ? 'chapter-review-workflow' : 'processing-readiness';
    const note = windows.get(noteId), navigation = windows.get('project-navigation');
    if (!note || !navigation || state.groups[noteId]) return;
    const hasNoteFrame = !!state.frames[noteId];
    const linked = state.magnets.some(pair => pair.includes(noteId) && pair.includes('project-navigation'));
    // Repair the previous automatic Review Chapters anchor once. Subsequent
    // user placement remains authoritative, including after reopening the page.
    const repair = page === 'step-2' && linked && !state.workflowPlacementVersion;
    if (!repair && (hasNoteFrame || state.magnets.some(pair => pair.includes(noteId) || pair.includes('project-navigation')))) return;
    const area = root.current.getBoundingClientRect(), nav = navigation.surface.getBoundingClientRect();
    const home = navigation.surface.closest<HTMLElement>('.desktop-window-slot');
    const homeBounds = home?.getBoundingClientRect();
    const homeY = homeBounds ? homeBounds.top - area.top + parseFloat(getComputedStyle(home!).paddingTop || '0') : nav.top - area.top;
    const homeX = homeBounds ? homeBounds.left - area.left : nav.left - area.left;
    const navFrame = !repair && state.frames['project-navigation'] || { x: homeX, y: homeY, width: nav.width, height: nav.height };
    const height = state.frames[noteId]?.height || note.surface.getBoundingClientRect().height;
    commit(before => ({ ...before, workflowPlacementVersion: 1, frames: { ...before.frames,
      'project-navigation': navFrame,
      [noteId]: { x: navFrame.x, y: navFrame.y + navFrame.height + 12, width: navFrame.width, height: Math.max(100, height) },
    }, magnets: linkMagnet(before.magnets, noteId, 'project-navigation') }), false);
  }, [page, enabled, windows, state.frames, state.groups, state.magnets, state.workflowPlacementVersion, commit]);
  const context: Desktop = { page, revision, width, bounds, enabled, root, foreground, activate, report, windows, register, groups, connections, group, layouts, setLayout, magnetLinks: state.magnets, setMagnetLink, state, commit, setFrames, setPreferences, resolvedLayouts, reportWidth, reportHeight, capturePlacement,
    undo: () => restore('undo'), redo: () => restore('redo'), canUndo: !!history.current.value.past.length, canRedo: !!history.current.value.future.length };
  return <DesktopContext.Provider value={context}><div ref={root} className="desktop-workspace" data-desktop-enabled={enabled} style={{ minHeight: enabled && bottom ? bottom + 24 : undefined }}>
    {children}
    {state.generated.map(parent => <DesktopWindow key={parent.id} id={parent.id} title={parent.title} kind="group" role="parent" generated />)}
  </div></DesktopContext.Provider>;
}
export function DesktopWindow({ id, title: requestedTitle, children, generated = false, className = '', minimumWidth: requestedMinimum = 280, homeWindow: requestedHome, role: requestedRole, panelId, kind: requestedKind = 'panel', contentKind: requestedContent = 'widget', definitionId, headerOnly = false, expandWhen = false, collapsedActions, collapsedIcon, variant = 'standard' }: { variant?: 'standard' | 'compact'; homeWindow?: string; role?: PanelRole; panelId?: string; id: string; title: string; children?: React.ReactNode; generated?: boolean; className?: string; minimumWidth?: number; kind?: ContainerKind; contentKind?: ContentKind; definitionId?: string; headerOnly?: boolean; expandWhen?: boolean; collapsedActions?: React.ReactNode; collapsedIcon?: React.ReactNode }) {
  if (!id || ['__proto__', 'constructor', 'prototype', '$content', 'groups', 'connections'].includes(id) || id.startsWith('container:')) throw new Error(`Invalid container instance ID: ${id}`);
  const panel = getPanelDefinition(panelId || id);
  if (panelId && !panel) throw new Error(`Unknown panel: ${panelId}`);
  const title = definitionId === 'swissmouse.navigation' ? requestedTitle : panel?.name || requestedTitle;
  const role = panel?.role || requestedRole || (requestedHome ? 'child' : 'parent');
  const homeWindow = requestedHome || panel?.defaultParent;
  if (role === 'parent' && homeWindow) throw new Error('Parent panels cannot have a home parent');
  const definition = getContainerDefinition(definitionId || containerTypes[requestedKind].id);
  if (!definition) throw new Error(`Unknown container definition: ${definitionId}`);
  const kind = definitionId ? definition.type : requestedKind;
  const contentKind = definitionId ? definition.content : requestedContent;
  const minimumWidth = panel?.constraints?.minimumWidth || (definitionId ? definition.minimumWidth : requestedMinimum);
  const desktop = useDesktopWorkspace();
  const currentDesktop = useRef(desktop);
  currentDesktop.current = desktop;
  const minimumHeight = panel?.constraints?.minimumHeight || (definitionId === 'swissmouse.toolbar' ? 48 : 100);
  const constrainWindow = (frame: WindowFrame, availableWidth: number, minimum: number) => constrainDeskWindow({ ...frame,
    width: Math.min(frame.width, panel?.constraints?.maximumWidth || Infinity),
    height: Math.max(minimumHeight, Math.min(frame.height, panel?.constraints?.maximumHeight || 4000)),
  }, availableWidth, minimum, desktop?.bounds, minimumHeight);
  const slot = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [needsHeading, setNeedsHeading] = useState(false);
  const [headerDockAnchor] = useState(() => {
    if (typeof document === 'undefined') return null;
    const anchor = document.createElement('div');
    anchor.className = 'desktop-window-header-dock-anchor';
    return anchor;
  });
  const [headerToggleHost, setHeaderToggleHost] = useState<HTMLElement | null>(null);
  const measureContentAfterArrange = useRef<Record<string, WindowFrame>>();
  const resizeChild = useRef<(id: string, frame: Partial<WindowFrame>) => void>(() => {});
  const dock = useRef<HTMLDivElement>(null);
  const docks = useRef<Record<DockSide, HTMLDivElement>>({} as Record<DockSide, HTMLDivElement>);
  // Stable callbacks keep destination refs available while siblings relocate.
  const dockRefs = useMemo(() => Object.fromEntries(dockSides.map(side => [side, (element: HTMLDivElement | null) => {
    docks.current[side] = element!;
    if (side === 'bottom') dock.current = element;
  }])) as Record<DockSide, (element: HTMLDivElement | null) => void>, []);
  // Keep a stable portal target: moving its DOM shell preserves React state.
  const [host] = useState(() => {
    if (typeof document === 'undefined') return null;
    const anchor = document.createElement('div');
    anchor.className = 'desktop-window-header-dock-anchor';
    return anchor;
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [handleMenuOpen, setHandleMenuOpen] = useState(false);
  const handleMenu = useRef<HTMLDivElement>(null);
  const [menuAnchor, setMenuAnchor] = useState({ left: 8, top: 8 });
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [headerResizePreview, setHeaderResizePreview] = useState<WindowFrame | null>(null);
  const [selectedTool, setSelectedTool] = useState<HandleMode>('resize');
  const preferences = { handleMode: 'resize' as const, locked: false, ...desktop?.state.panels[id], cornerHandleHidden: desktop?.state.panels[id]?.cornerHandleHidden ?? desktop?.state.cornerHandlesHidden ?? true };
  useEffect(() => {
    if (preferences.cornerHandleHidden) { setToolbarOpen(false); setMenuOpen(false); }
  }, [preferences.cornerHandleHidden]);
  const locked = preferences.locked || !!desktop?.state.panels[desktop.groups[id]]?.locked;
  const toolbarId = useId();
  const toolbarToggle = useRef<HTMLButtonElement>(null);
  const [connecting, setConnecting] = useState(false);
  const [placement, setPlacement] = useState<DockSide>('bottom');
  const menuButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [frame, setFrame] = useState<WindowFrame>();
  const toolbarAnchor = useRef({ left: 8, top: 8, placement: 'inside' });
  const controlStripElement = useRef<HTMLDivElement>(null);
  const toolbarPreview = useRef<WindowFrame>();
  const positionControls = useCallback((preview?: WindowFrame) => {
    toolbarPreview.current = preview;
    const controls = controlStripElement.current;
    if (!controls || controls.dataset.open !== 'true' || !surface.current) return;
    const bounds = preview ? { top: preview.y, right: preview.x + preview.width } : surface.current.getBoundingClientRect();
    const above = bounds.top >= 40;
    const next = {
      left: Math.max(8, Math.min(window.innerWidth - 264, bounds.right - 256)),
      top: Math.max(8, Math.min(window.innerHeight - 40, above ? bounds.top - 32 : bounds.top + 24)),
      placement: above ? 'above' : 'inside',
    };
    toolbarAnchor.current = next;
    controls.style.left = `${next.left}px`; controls.style.top = `${next.top}px`;
    controls.dataset.placement = next.placement;
  }, []);
  useBrowserLayoutEffect(() => {
    if (!toolbarOpen || !surface.current) return;
    const element = surface.current;
    let pending = 0;
    let followUntil = 0;
    const measure = () => {
      positionControls(toolbarPreview.current);
      // Placement uses a short compositor animation, which neither resize nor
      // mutation observers report. Follow only during that settling interval.
      if (performance.now() < followUntil) pending = requestAnimationFrame(measure);
    };
    const schedule = () => { followUntil = performance.now() + 300; cancelAnimationFrame(pending); pending = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule); observer.observe(element);
    const movement = new MutationObserver(schedule);
    // Transforms do not notify ResizeObserver. Observe the panel and moving
    // ancestors so child and magnet-linked control ribbons travel with them.
    for (let node: HTMLElement | null = element; node; node = node.parentElement)
      if (node.matches('[data-desktop-window]')) movement.observe(node, { attributes: true, attributeFilter: ['style'] });
    return () => { cancelAnimationFrame(pending); observer.disconnect(); movement.disconnect(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
  }, [toolbarOpen, frame?.x, frame?.y, frame?.width, frame?.height, positionControls]);
  const live = useRef<WindowFrame>();
  const [origin, setOrigin] = useState({ x: 0, y: 0, height: 0 });
  const [contentCollapsed, setCollapsed] = useState(false);
  const [tabCollapsed, setTabCollapsed] = useState(false);
  const contentId = useId();
  const collapsible = kind !== 'preview' && definitionId !== 'swissmouse.toolbar' && !headerOnly;
  const commandStrip = definitionId === 'swissmouse.toolbar';
  const collapsed = headerOnly || (collapsible && (contentCollapsed || tabCollapsed));
  useBrowserLayoutEffect(() => { if (expandWhen) setTabCollapsed(false); }, [expandWhen]);
  const drag = useRef<{ x: number; y: number; frame: WindowFrame; next: WindowFrame; style: string; kind: 'move' | 'resize'; edge: string; moved: boolean }>();
  const dragAnimation = useRef<number>();
  const movingPeers = useRef<{ entry: RegisteredWindow; frame: WindowFrame; style: string }[]>([]);
  const cancelDrag = () => {
    setHeaderResizePreview(null);
    if (dragAnimation.current !== undefined) cancelAnimationFrame(dragAnimation.current);
    dragAnimation.current = undefined;
    if (drag.current && surface.current) surface.current.style.cssText = drag.current.style;
    if (surface.current) delete surface.current.dataset.layoutInteraction;
    movingPeers.current.forEach(peer => { peer.entry.surface.style.cssText = peer.style; });
    movingPeers.current = [];
    drag.current = undefined;
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancelDrag(); }
    };
    window.addEventListener('keydown', escape, true); window.addEventListener('blur', cancelDrag);
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', cancelDrag); cancelDrag(); };
  }, []);
  const page = desktop?.page;
  const revision = desktop?.revision;
  useEffect(() => {
    if (!handleMenuOpen) return;
    handleMenu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const dismiss = (event: PointerEvent) => { if (!handleMenu.current?.contains(event.target as Node)) setHandleMenuOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [handleMenuOpen]);
  useEffect(() => { cancelDrag(); setHandleMenuOpen(false); }, [page, revision, locked]);
  const lastDisclosure = useRef<{ page?: string; revision?: number; collapsed: boolean }>();
  useBrowserLayoutEffect(() => {
    const previous = lastDisclosure.current;
    lastDisclosure.current = { page, revision, collapsed };
    if (!surface.current || !previous?.collapsed || collapsed || previous.page !== page || previous.revision !== revision) return;
    const element = surface.current;
    const header = [...element.querySelectorAll<HTMLElement>('.workspace-panel-header, [data-container-heading]')]
      .find(candidate => candidate.closest('[data-desktop-window]') === element && candidate.getClientRects().length);
    const animation = revealPanel(element, header || headerToggleHost || undefined);
    return () => animation?.cancel();
  }, [collapsed, page, revision]);
  const parentId = desktop?.groups[id];
  const parent = parentId ? desktop?.windows.get(parentId) : undefined;
  const layout = desktop?.layouts[id] || defaultContainerLayout();
  const resolvedLayout = desktop?.resolvedLayouts[id] || layout;
  const arranged = layout.mode !== 'original' && !!desktop?.enabled;
  const parentLayout = parentId ? desktop?.resolvedLayouts[parentId] : undefined;
  const managed = definitionId !== 'swissmouse.toolbar' && !!parent && parentLayout?.mode !== 'original' && !!parentLayout && !!desktop?.enabled;
  const connection = parentId && desktop?.connections[id]?.parent === parentId ? desktop.connections[id] : undefined;
  const atHome = !!homeWindow && parentId === homeWindow && !connection && !managed;
  const nested = !!parent && (atHome || !host?.contains(parent.dock));
  const responsiveGridChild = managed && parentLayout?.mode === 'grid';
  const preferredHeight = responsiveGridChild ? desktop?.layouts[parentId!]?.items[id]?.height : undefined;
  const magnetPeers = desktop?.magnetLinks.filter(pair => pair.includes(id)).flatMap(pair => pair.filter(peer => peer !== id))
    .filter(peer => desktop.windows.has(peer) && (desktop.groups[peer] || '') === (desktop.groups[id] || '')) || [];
  const floatingSection = !nested && (!!homeWindow || (kind === 'preview' && !!frame && !!desktop?.enabled));
  const floating = floatingSection && !!desktop?.enabled;
  const hasChildren = !!desktop && Object.entries(desktop.groups).some(([child, owner]) => owner === id && desktop.windows.has(child));
  const [magnetClips, setMagnetClips] = useState<{ peer: string; edge: string; position: number }[]>([]);
  useBrowserLayoutEffect(() => {
    if (!desktop || !surface.current || !magnetPeers.length) { setMagnetClips(previous => previous.length ? [] : previous); return; }
    let animation = 0;
    const measure = () => {
      const own = surface.current!.getBoundingClientRect();
      const next = magnetPeers.filter(peer => id.localeCompare(peer) < 0).map(peer => {
        const other = desktop.windows.get(peer)!.surface.getBoundingClientRect();
        const edges = [ ['top', Math.abs(own.top - other.bottom)], ['bottom', Math.abs(own.bottom - other.top)],
          ['left', Math.abs(own.left - other.right)], ['right', Math.abs(own.right - other.left)] ] as const;
        const edge = [...edges].sort((a, b) => a[1] - b[1])[0][0];
        const horizontal = edge === 'top' || edge === 'bottom';
        const start = Math.max(horizontal ? own.left : own.top, horizontal ? other.left : other.top);
        const end = Math.min(horizontal ? own.right : own.bottom, horizontal ? other.right : other.bottom);
        const position = Math.max(14, Math.min((horizontal ? own.width : own.height) - 14,
          (start + end) / 2 - (horizontal ? own.left : own.top)));
        return { peer, edge, position };
      });
      setMagnetClips(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(animation); animation = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule), movement = new MutationObserver(schedule);
    [surface.current, ...magnetPeers.map(peer => desktop.windows.get(peer)!.surface)].forEach(element => {
      resize.observe(element); movement.observe(element, { attributes: true, attributeFilter: ['style'] });
    });
    window.addEventListener('scroll', schedule, true); measure();
    return () => { cancelAnimationFrame(animation); resize.disconnect(); movement.disconnect(); window.removeEventListener('scroll', schedule, true); };
  }, [id, desktop?.windows, desktop?.magnetLinks, frame?.x, frame?.y, frame?.width, frame?.height]);
  const dockedChildren = desktop ? Object.entries(desktop.groups).filter(([child, owner]) => owner === id && desktop.windows.has(child)
    && (desktop.windows.get(child)?.homeWindow !== id || desktop.connections[child]?.parent === id)) : [];
  const dockCounts = Object.fromEntries(dockSides.map(side => [side, dockedChildren.filter(([child]) => (desktop!.connections[child]?.parent === id ? desktop!.connections[child].side : 'bottom') === side).length])) as Record<DockSide, number>;
  const dockBasis = (side: DockSide) => dockedChildren
    .filter(([child]) => (desktop!.connections[child]?.parent === id ? desktop!.connections[child].side : 'bottom') === side)
    .reduce((sum, [child]) => sum + desktop!.windows.get(child)!.minimumWidth, 25 + Math.max(0, dockCounts[side] - 1) * 16);
  const enabled = !!desktop?.enabled && (!nested || managed);
  const followScroll = definitionId === 'swissmouse.navigation' && !!desktop?.enabled && !parentId;
  const navigationScrollOffset = useRef(0);
  useBrowserLayoutEffect(() => {
    const element = surface.current;
    if (!followScroll || !element) return;
    const header = document.querySelector<HTMLElement>('.workspace-header-host') || document.querySelector<HTMLElement>('.app-header');
    const peers = magnetCluster(desktop!.magnetLinks, id).filter(key => key !== id).flatMap(key => {
      const peer = desktop!.windows.get(key);
      return peer && !desktop!.groups[key] && peer.surface.dataset.containerDefinition !== 'swissmouse.navigation' ? [peer.surface] : [];
    });
    let animation = 0;
    const measure = () => {
      if (drag.current) return;
      const inset = header?.getBoundingClientRect().bottom || 0;
      const originalTop = element.getBoundingClientRect().top - navigationScrollOffset.current;
      const offset = Math.max(0, inset - originalTop);
      navigationScrollOffset.current = offset;
      element.style.translate = `0 ${offset}px`;
      peers.forEach(peer => { peer.style.translate = `0 ${offset}px`; });
    };
    const schedule = () => { cancelAnimationFrame(animation); animation = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    if (header) observer.observe(header);
    observer.observe(element);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    measure();
    return () => {
      cancelAnimationFrame(animation); observer.disconnect();
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
      element.style.translate = ''; peers.forEach(peer => { peer.style.translate = ''; }); navigationScrollOffset.current = 0;
    };
  }, [followScroll, frame?.x, frame?.y, frame?.width, frame?.height, collapsed, page, revision, desktop?.magnetLinks, desktop?.windows]);

  const register = desktop?.register;

  useBrowserLayoutEffect(() => {
    if (!responsiveGridChild || !surface.current || !desktop) return;
    const element = surface.current;
    let pending = 0;
    const measure = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => desktop.reportHeight(id, element.offsetHeight));
    };
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => { observer.disconnect(); cancelAnimationFrame(pending); desktop.reportHeight(id); };
  }, [id, responsiveGridChild, desktop?.reportHeight]);

  useBrowserLayoutEffect(() => {
    if (!content.current || !desktop) return;
    const element = content.current;
    const measure = () => desktop.reportWidth(id, element.clientWidth);
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [id, desktop?.reportWidth]);

  useBrowserLayoutEffect(() => {
    if (!host || !dock.current || !register) return;
    return register(id, { toolbar: definitionId === 'swissmouse.toolbar', title, role, minimumWidth, homeWindow, resizeChild: (child, frame) => resizeChild.current(child, frame), host, surface: surface.current!, content: content.current!, dock: dock.current, docks: docks.current, preparePopOut: (position) => {
      // Geometry changes must not unregister every panel and reload its layout.
      // Resolve current bounds at the moment a placement is requested instead.
      const desktop = currentDesktop.current;
      if (position && desktop) {
        const next = constrainDeskWindow(position, desktop.width, minimumWidth, desktop.bounds);
        desktop.setFrames({ [id]: next }, false); live.current = next; setFrame(next); return;
      }
      if (!homeWindow || !surface.current || !desktop?.root.current) return;
      const bounds = surface.current.getBoundingClientRect();
      const area = desktop.root.current.getBoundingClientRect();
      const saved = desktop.state.frames[id];
      const next = saved || constrainDeskWindow({ x: bounds.left - area.left + 20, y: bounds.top - area.top + 20, width: Math.max(320, bounds.width), height: Math.min(700, bounds.height) }, desktop.width, minimumWidth, desktop.bounds);
      desktop.setFrames({ [id]: next }, false);
    }, reveal: () => {
      setTabCollapsed(false);
      const content = surface.current?.querySelector(':scope > .desktop-window-content > .desktop-window-body > .desktop-window-main > :not(.container-content-controls):not(.container-standard-header)');
      if (content?.tagName === 'DETAILS') (content as HTMLDetailsElement).open = true;
      else if (content?.getAttribute('data-collapsed') === 'true')
        (content.querySelector('[aria-expanded="false"]') as HTMLButtonElement | null)?.click();
    } });
  }, [host, id, title, role, homeWindow, register, desktop?.page, minimumWidth]);

  useBrowserLayoutEffect(() => {
    if (!host || !slot.current) return;
    const destination = managed ? parent!.content : nested && !atHome ? parent!.docks[connection?.side || 'bottom'] : floatingSection ? desktop!.root.current! : slot.current;
    if (!destination) return;
    host.className = `desktop-window-mount ${managed ? 'container-layout-child' : floatingSection ? 'desktop-window-detached' : ''}`;
    host.style.setProperty('--sm-window-min-width', `${minimumWidth}px`);
    host.style.zIndex = floatingSection ? String(desktop?.foreground === id ? 4 : 3) : '';
    host.dataset.windowMount = id;
    const ordered = nested && !atHome && !managed;
    const order = connection?.order || 0;
    const before = ordered ? [...destination.children].find(element => {
      if (element === host) return false;
      const otherId = (element as HTMLElement).dataset.windowMount || '';
      const otherOrder = desktop?.connections[otherId]?.order || 0;
      return otherOrder > order || (otherOrder === order && otherId.localeCompare(id) > 0);
    }) || null : null;
    if (host.parentElement !== destination || (ordered && host.nextElementSibling !== before)) {
      // Atomic DOM moves retain focus, selection and live media playback in
      // supporting browsers. Never detach the host in dependency cleanup.
      const atomic = destination as HTMLDivElement & { moveBefore?: (node: Node, before: Node | null) => void };
      const focused = document.activeElement as HTMLElement | null;
      // Chromium can crash when moveBefore moves multiple live subtrees into
      // a newly mounted generated container. Use the existing focus/media
      // restoration fallback at that boundary; React's portal stays mounted.
      const generatedBoundary = destination.closest('[data-generated-parent="true"]') || host.parentElement?.closest('[data-generated-parent="true"]');
      if (atomic.moveBefore && host.isConnected && destination.isConnected && !generatedBoundary) atomic.moveBefore(host, before);
      else {
        const media = [...host.querySelectorAll<HTMLMediaElement>('audio, video')].map(element => ({ element, time: element.currentTime, playing: !element.paused }));
        destination.insertBefore(host, before);
        for (const { element, time, playing } of media) {
          const restore = () => { element.currentTime = time; if (playing) void element.play().catch(() => {}); };
          if (element.readyState) restore(); else element.addEventListener('loadedmetadata', restore, { once: true });
        }
        if (focused && host.contains(focused)) focused.focus({ preventScroll: true });
      }
    }
  }, [host, nested, managed, atHome, floatingSection, parent?.docks, parent?.content, minimumWidth, desktop?.connections, desktop?.foreground, desktop?.width, desktop?.page, desktop?.revision]);
  useBrowserLayoutEffect(() => () => { host?.remove(); }, [host]);
  useBrowserLayoutEffect(() => {
    if (!main.current) return;
    // Existing authored headings keep their actions and labels. Containers with
    // unlabelled content receive the same shared heading automatically.
    const headings = [...main.current.querySelectorAll('.workspace-panel-title, [data-container-heading]')];
    setNeedsHeading(collapsible && !headings.some(element => !element.closest('.container-standard-header') && element.closest('[data-desktop-window]') === surface.current));
    const ownHeading = headings.find(element => !element.closest('.container-standard-header') && element.closest('[data-desktop-window]') === surface.current);
    const header = ownHeading?.closest('.workspace-panel-header') || (ownHeading?.hasAttribute('data-container-heading') ? ownHeading : ownHeading?.parentElement);
    const childHeader = role === 'child';
    if (childHeader) {
      header?.classList.add('child-panel-header');
      ownHeading?.classList.add('child-panel-title');
      if (ownHeading?.parentElement && ownHeading.parentElement !== header)
        ownHeading.parentElement.classList.add('child-panel-heading-group');
    }
    if (headerDockAnchor) {
      if (header) header.insertAdjacentElement('afterend', headerDockAnchor);
      else main.current.prepend(headerDockAnchor);
    }
    setHeaderToggleHost(collapsible && header && header.tagName !== 'SUMMARY' && !ownHeading?.closest('button[aria-expanded]') && !header.querySelector('.workspace-header-toggle:not([data-desktop-header-toggle])') ? header as HTMLElement : null);
    return () => {
      headerDockAnchor?.remove();
      header?.classList.remove('child-panel-header');
      ownHeading?.classList.remove('child-panel-title');
      ownHeading?.parentElement?.classList.remove('child-panel-heading-group');
    };
  }, [title, role, collapsible]);

  useEffect(() => {
    if (!menuOpen) return;
    const position = (event?: Event) => {
      if (event?.target instanceof Node && menu.current?.contains(event.target)) return;
      const anchor = surface.current?.getBoundingClientRect();
      if (anchor) {
        const next = { left: Math.max(8, Math.min(window.innerWidth - 300, anchor.right - 280)), top: Math.max(8, Math.min(window.innerHeight - 340, anchor.top + 20)) };
        setMenuAnchor(previous => previous.left === next.left && previous.top === next.top ? previous : next);
      }
    };
    position(); window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    menu.current?.querySelector<HTMLElement>('button, select')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !menuButton.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [menuOpen]);
  useEffect(() => { setTabCollapsed(false); setMenuOpen(false); setEditing(false); }, [page, revision]);
  const root = desktop?.root;
  const report = desktop?.report;
  const width = desktop?.width || 0;

  useBrowserLayoutEffect(() => {
    drag.current = undefined;
    // Measure the original flow before restoring saved geometry, including on
    // reload. Reset changes geometry without remounting an editor or player.
    if (slot.current && surface.current && root?.current) {
      const surfaceStyle = surface.current.style.cssText;
      const slotHeight = slot.current.style.height;
      surface.current.style.cssText = '';
      slot.current.style.height = '';
      const area = root.current.getBoundingClientRect();
      const bounds = slot.current.getBoundingClientRect();
      setOrigin({ x: bounds.left - area.left, y: bounds.top - area.top, height: surface.current.getBoundingClientRect().height });
      surface.current.style.cssText = surfaceStyle;
      slot.current.style.height = slotHeight;
    }
    const saved = managed ? parentLayout?.items[id] : page && enabled ? desktop?.state.frames[id] : undefined;
    live.current = saved; setFrame(saved);
  }, [page, revision, id, enabled, managed, parentLayout?.items[id]?.x, parentLayout?.items[id]?.y, parentLayout?.items[id]?.width, parentLayout?.items[id]?.height, desktop?.state.frames[id], root]);

  useBrowserLayoutEffect(() => {
    if (!slot.current || !surface.current || !root?.current) return;
    let pending = 0;
    const measure = () => {
      if (drag.current) return;
      const bounds = slot.current!.getBoundingClientRect();
      const area = root.current!.getBoundingClientRect();
      const content = surface.current!.querySelector(':scope > .desktop-window-content > .desktop-window-body > .desktop-window-main > :not(.container-content-controls):not(.container-standard-header)');
      setCollapsed(!!content && (content.getAttribute('data-collapsed') === 'true' || (content.tagName === 'DETAILS' && !content.hasAttribute('open'))));
      setOrigin(previous => {
        const next = { x: bounds.left - area.left, y: bounds.top - area.top, height: frame ? previous.height : surface.current!.getBoundingClientRect().height };
        return previous.x === next.x && previous.y === next.y && previous.height === next.height ? previous : next;
      });
    };
    measure();
    const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(root.current); observer.observe(slot.current); observer.observe(surface.current);
    const mutation = new MutationObserver(schedule);
    mutation.observe(surface.current, { subtree: true, attributes: true, attributeFilter: ['data-collapsed', 'open', 'hidden'] });
    return () => { observer.disconnect(); mutation.disconnect(); cancelAnimationFrame(pending); };
  }, [enabled, root, !!frame]);

  const bounded = frame && enabled ? managed ? frame : constrainWindow(frame, width, minimumWidth) : undefined;
  useBrowserLayoutEffect(() => {
    if (!measureContentAfterArrange.current || !arranged || !main.current || !desktop) return;
    const originalItems = measureContentAfterArrange.current;
    measureContentAfterArrange.current = undefined;
    const element = main.current;
    const authored = [...element.children].find(child => !child.classList.contains('container-content-controls') && !child.classList.contains('container-standard-header')) as HTMLElement | undefined;
    if (!authored || !layout.items.$content) return;
    // Child portals have moved out of their authored slots. Measure the remaining
    // widget once, so switching formats does not leave a child-sized empty hole.
    const oldHeight = element.style.height, oldMinimum = authored.style.minHeight;
    element.style.height = 'auto'; authored.style.minHeight = '0px';
    const naturalHeight = Math.max(100, authored.getBoundingClientRect().height + (element.querySelector(':scope > .container-standard-header')?.getBoundingClientRect().height || 0) + 32);
    element.style.height = oldHeight; authored.style.minHeight = oldMinimum;
    const minimums = Object.fromEntries([['$content', minimumWidth], ...[...desktop.windows].map(([key, value]) => [key, value.minimumWidth])]);
    desktop.setLayout(id, arrangeContainer(layout, { ...originalItems, $content: { ...layout.items.$content, height: naturalHeight } }, minimums), false);
  }, [arranged, layout, desktop, id, minimumWidth]);
  useBrowserLayoutEffect(() => {
    report?.(id, bounded && !managed ? bounded.y + (collapsed ? surface.current?.offsetHeight || 48 : bounded.height) : undefined);
    return () => report?.(id);
  }, [id, report, bounded?.y, bounded?.height, collapsed, enabled, managed]);

  useBrowserLayoutEffect(() => {
    if (!desktop || !enabled || arranged || collapsed || !dockedChildren.length || !content.current) return;
    const element = content.current;
    let pending = 0;
    const fit = () => {
      if (drag.current || !surface.current) return;
      const overflow = element.scrollHeight - element.clientHeight;
      if (overflow <= 2) return;
      const bounds = surface.current.getBoundingClientRect();
      const area = root!.current!.getBoundingClientRect();
      const next = constrainWindow({ x: bounds.left - area.left, y: bounds.top - area.top,
        width: bounds.width, height: bounds.height + overflow }, desktop.width, minimumWidth);
      if (next.height <= bounds.height + 1) return;
      // Content reflow is temporary. Keep the saved preferred geometry intact.
      live.current = next; setFrame(next);
    };
    const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(fit); };
    const observer = new ResizeObserver(schedule);
    [...element.children, ...Object.values(docks.current)].forEach(child => { if (child) observer.observe(child); });
    schedule();
    return () => { observer.disconnect(); cancelAnimationFrame(pending); };
  }, [desktop?.page, enabled, arranged, collapsed, dockedChildren.length, minimumWidth, root]);

  if (!desktop) return <>{children}</>;
  const currentFrame = (): WindowFrame => {
    const bounds = surface.current!.getBoundingClientRect();
    const owner = managed ? parent!.content : root!.current!;
    const area = owner.getBoundingClientRect();
    return { x: bounds.left - area.left + (managed ? owner.scrollLeft : 0), y: bounds.top - area.top + (managed ? owner.scrollTop : 0) - navigationScrollOffset.current, width: bounds.width, height: collapsed ? live.current?.height || 420 : bounds.height };
  };
  const update = (next: WindowFrame) => {
    live.current = managed ? { ...next, x: Math.max(0, next.x), y: Math.max(36, next.y), width: Math.max(minimumWidth, next.width), height: Math.max(100, next.height) } : constrainWindow(next, width, minimumWidth);
    setFrame(live.current);
  };
  const editedLayout = (owner: string, child: string, position: WindowFrame) => {
    const preferred = desktop.layouts[owner];
    const values = Object.fromEntries(Object.entries(preferred.items).filter(([key]) => key === '$content' || desktop.groups[key] === owner));
    const next = arrangeContainer(preferred, { ...values, [child]: position }, Object.fromEntries([...desktop.windows].map(([key, entry]) => [key, entry.minimumWidth])));
    if (Object.keys(next.items).some(key => desktop.state.panels[key]?.locked && JSON.stringify(next.items[key]) !== JSON.stringify(preferred.items[key]))) return;
    return next;
  };
  const persist = () => {
    if (!live.current) return;
    if (managed) {
      const next = editedLayout(parentId!, id, live.current);
      if (next) desktop.setLayout(parentId!, next);
      else { live.current = parentLayout!.items[id]; setFrame(live.current); }
    } else desktop.setFrames({ [id]: live.current });
  };
  const collectMovingPeers = () => {
    if (managed || nested) return [];
    const area = root!.current!.getBoundingClientRect();
    return magnetCluster(desktop.magnetLinks, id).filter(key => key !== id && !desktop.groups[key]).flatMap(key => {
      const entry = desktop.windows.get(key);
      if (!entry || desktop.state.panels[key]?.locked || !entry.surface.getClientRects().length) return [];
      const bounds = entry.surface.getBoundingClientRect();
      return [{ entry, frame: { x: bounds.left - area.left, y: bounds.top - area.top, width: bounds.width, height: bounds.height }, style: entry.surface.style.cssText }];
    });
  };
  const constrainMove = (initial: WindowFrame, next: WindowFrame, peers: ReturnType<typeof collectMovingPeers>) => {
    const frames = [initial, ...peers.map(peer => peer.frame)];
    const dx = Math.max(desktop.bounds.left - Math.min(...frames.map(f => f.x)), Math.min(desktop.bounds.right - Math.max(...frames.map(f => f.x + f.width)), next.x - initial.x));
    const dy = Math.max(-Math.min(...frames.map(f => f.y)), next.y - initial.y);
    return { ...initial, x: initial.x + dx, y: initial.y + dy };
  };
  const start = (event: React.PointerEvent, kind: 'move' | 'resize', edge = 'se') => {
    if (!desktop.enabled || locked || event.button !== 0) return;
    if (surface.current) cancelPanelSettle(surface.current);
    event.preventDefault(); event.stopPropagation(); desktop.activate(id);
    const initialFrame = currentFrame();
    movingPeers.current = kind === 'move' ? collectMovingPeers() : [];
    drag.current = { x: event.pageX, y: event.pageY, frame: initialFrame, next: initialFrame, style: surface.current!.style.cssText, kind, edge, moved: false };
    surface.current!.dataset.layoutInteraction = kind; setSelectedTool(kind === 'resize' ? 'resize' : 'move');
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const previewFrame = (next: WindowFrame) => {
    const active = drag.current!;
    active.next = managed ? { ...next, x: Math.max(0, next.x), y: Math.max(36, next.y), width: Math.max(minimumWidth, next.width), height: Math.max(100, next.height) }
      : constrainWindow(next, width, minimumWidth);
    if (active.kind === 'move' && movingPeers.current.length) active.next = constrainMove(active.frame, active.next, movingPeers.current);
    if (dragAnimation.current === undefined) dragAnimation.current = requestAnimationFrame(() => {
      dragAnimation.current = undefined;
      const d = drag.current; if (!d || !surface.current) return;
      if (d.kind === 'resize' && nested && parent?.fixedSurface) {
        const bounds = surface.current.getBoundingClientRect();
        d.next = { ...d.next, width: Math.max(minimumWidth, Math.min(680, d.next.width)), height: Math.max(minimumHeight, Math.min(500, d.next.height)) };
        setHeaderResizePreview({ x: bounds.left, y: bounds.top, width: d.next.width, height: d.next.height });
        return;
      }
      surface.current.style.transform = `translate(${d.next.x - d.frame.x}px, ${d.next.y - d.frame.y}px)`;
      movingPeers.current.forEach(peer => {
        peer.entry.surface.style.transform = `translate(${d.next.x - d.frame.x}px, ${d.next.y - d.frame.y}px)`;
      });
      if (d.kind === 'resize') {
        surface.current.style.width = `${d.next.width}px`; surface.current.style.height = `${d.next.height}px`;
      }
    });
  };
  const move = (event: React.PointerEvent) => {
    const initial = drag.current;
    if (!initial) return;
    const dx = event.pageX - initial.x; const dy = event.pageY - initial.y;
    if (!initial.moved && Math.hypot(dx, dy) < 4) return;
    initial.moved = true;
    if (initial.kind === 'move') {
      previewFrame({ ...initial.frame, x: initial.frame.x + dx, y: initial.frame.y + dy });
    } else {
      const f = initial.frame;
      const left = initial.edge.includes('w') ? Math.max(managed ? 0 : desktop.bounds.left, Math.min(f.x + f.width - Math.min(minimumWidth, width), f.x + dx)) : f.x;
      const top = initial.edge.includes('n') ? Math.max(0, Math.min(f.y + f.height - 100, f.y + dy)) : f.y;
      previewFrame({ x: left, y: top,
        width: initial.edge.includes('w') ? f.width + f.x - left : initial.edge.includes('e') ? Math.min((managed ? width : desktop.bounds.right) - f.x, f.width + dx) : f.width,
        height: initial.edge.includes('n') ? f.height + f.y - top : initial.edge.includes('s') ? f.height + dy : f.height });
    }
  };
  const finish = (event: React.PointerEvent, cancel = false) => {
    if (!drag.current) return;
    const next = drag.current.next;
    const moved = drag.current.moved;
    const operation = drag.current.kind;
    const peers = movingPeers.current;
    const dx = next.x - drag.current.frame.x, dy = next.y - drag.current.frame.y;
    cancelDrag();
    if (!cancel && moved) {
      if (nested && !managed) {
        if (operation === 'move') desktop.group(id, undefined, undefined, next);
        else parent?.resizeChild(id, { width: next.width, height: next.height });
      } else {
        update(next); persist();
        peers.forEach(peer => peer.entry.preparePopOut({ ...peer.frame, x: peer.frame.x + dx, y: peer.frame.y + dy }));
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboard = (event: React.KeyboardEvent, kind: 'move' | 'resize') => {
    if (locked || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); desktop.activate(id);
    const amount = (managed && parentLayout?.mode === 'grid' ? parentLayout.gridSize : 12) * (event.shiftKey ? 4 : 1);
    const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
    const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
    const current = currentFrame();
    if (nested && !managed) {
      if (kind === 'move') desktop.group(id, undefined, undefined, { ...current, x: current.x + dx, y: current.y + dy });
      else parent?.resizeChild(id, { width: current.width + dx, height: current.height + dy });
      return;
    }
    if (kind === 'move') {
      const peers = collectMovingPeers();
      if (peers.length) {
        const next = constrainMove(current, { ...current, x: current.x + dx, y: current.y + dy }, peers);
        update(next); persist();
        peers.forEach(peer => peer.entry.preparePopOut({ ...peer.frame, x: peer.frame.x + next.x - current.x, y: peer.frame.y + next.y - current.y }));
        return;
      }
    }
    update(kind === 'move' ? { ...current, x: current.x + dx, y: current.y + dy } : { ...current, width: current.width + dx, height: current.height + dy }); persist();
  };
  const closeMenu = () => { setMenuOpen(false); menuButton.current?.focus(); };
  const destinations = [...desktop.windows].filter(([candidate, entry]) => !desktop.state.panels[candidate]?.locked && canDockPanel(role, entry.role) && canGroupWindow(desktop.groups, id, candidate) && (candidate === homeWindow || !host?.contains(entry.dock)));
  const readLayoutItems = () => {
    const area = content.current!.getBoundingClientRect();
    const toLocal = (element: HTMLElement): WindowFrame => {
      const bounds = element.getBoundingClientRect();
      return { x: Math.max(0, bounds.left - area.left + content.current!.scrollLeft),
        y: Math.max(36, bounds.top - area.top + content.current!.scrollTop + 36), width: Math.max(48, bounds.width), height: Math.max(100, bounds.height) };
    };
    return Object.fromEntries([...(generated ? [] : [['$content', arranged && layout.items.$content || toLocal(main.current!)]]),
      ...[...desktop.windows].filter(([child]) => desktop.groups[child] === id).map(([child, entry]) => [child, arranged && layout.items[child] || toLocal(entry.surface)])]) as Record<string, WindowFrame>;
  };
  const changeLayout = (next: ContainerLayout) => {
    if (locked || [...desktop.windows.keys()].some(child => desktop.groups[child] === id && desktop.state.panels[child]?.locked)) return;
    const items = readLayoutItems();
    const values = next.items !== layout.items && Object.keys(next.items).length ? next.items : items;
    measureContentAfterArrange.current = layout.mode === 'original' && next.mode !== 'original' ? values : undefined;
    const minimums = Object.fromEntries([['$content', minimumWidth], ...[...desktop.windows].map(([key, value]) => [key, value.minimumWidth])]);
    desktop.setLayout(id, arrangeContainer(next, values, minimums));
  };
  resizeChild.current = (child, patch) => {
    const values = readLayoutItems();
    if (!values[child]) return;
    changeLayout({ ...layout, mode: 'grid', items: { ...values, [child]: { ...values[child], ...patch } } });
  };
  const viewportFrame = (): WindowFrame => {
    const bounds = surface.current!.getBoundingClientRect();
    return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
  };
  const inspect = () => {
    const childIds = [...desktop.windows.keys()].filter(child => desktop.groups[child] === id);
    const preferred = readLayoutItems();
    const area = content.current!.getBoundingClientRect();
    const items = childIds.map(child => {
      const entry = desktop.windows.get(child)!;
      const b = entry.surface.getBoundingClientRect();
      return { id: child, title: entry.title, locked: !!desktop.state.panels[child]?.locked,
        frame: arranged && resolvedLayout.items[child] || { x: Math.max(0, b.left - area.left + content.current!.scrollLeft), y: Math.max(0, b.top - area.top + content.current!.scrollTop), width: b.width, height: b.height },
        preferred: preferred[child] };
    }).sort((a, b) => a.preferred.y - b.preferred.y || a.preferred.x - b.preferred.x);
    return { items, selected: desktop.foreground, select: desktop.activate, width: content.current!.clientWidth,
      undo: desktop.undo, redo: desktop.redo, canUndo: desktop.canUndo, canRedo: desktop.canRedo,
      disabled: locked || items.some(item => item.locked) || !desktop.enabled,
      unavailableReason: !desktop.enabled ? 'Expand the workspace to edit panel positions. Inspection and selection remain available.' : undefined,
      edit: (child: string, patch: Partial<WindowFrame>) => changeLayout({ ...layout, mode: 'grid', items: { ...preferred, [child]: { ...preferred[child], ...patch } } }),
      reorder: (child: string, direction: number) => {
        const ordered = items.map(item => item.id); const index = ordered.indexOf(child), to = index + direction;
        if (index < 0 || to < 0 || to >= ordered.length) return;
        [ordered[index], ordered[to]] = [ordered[to], ordered[index]];
        let y = preferred.$content ? preferred.$content.y + preferred.$content.height + 48 : 48;
        const values = { ...preferred };
        for (const key of ordered) { values[key] = { ...values[key], x: 0, y }; y += values[key].height + 48; }
        changeLayout({ ...layout, mode: 'grid', items: values });
      },
      reset: () => {
        if (locked) return;
        const values = { ...desktop.state.frames }; delete values[id];
        desktop.commit(s => ({ ...s, frames: values, layouts: { ...s.layouts, [id]: generated ? { ...layout, mode: 'grid', regions: [], items: Object.fromEntries(items.map((item, index) => [item.id, { x: 0, y: 48 + index * 348, width: Math.max(280, desktop.windows.get(item.id)!.minimumWidth), height: 300 }])) } : defaultContainerLayout() } }));
      },
    };
  };
  const contentFrame = resolvedLayout.items.$content;
  const layoutHeight = arranged ? Math.max(200, ...Object.entries(resolvedLayout.items).filter(([key]) => key === '$content' || desktop.groups[key] === id).map(([, item]) => item.y + item.height + 24)) : undefined;
  const renderDock = (side: DockSide) => <div ref={dockRefs[side]}
    className={`desktop-window-dock desktop-window-dock-${side}`} data-has-docked={dockCounts[side] > 0} data-toolbar-only={dockedChildren.filter(([child]) => desktop!.connections[child]?.side === side).every(([child]) => desktop!.windows.get(child)?.toolbar)} hidden={collapsed}
    style={side === 'left' || side === 'right' ? { flexGrow: dockCounts[side], flexBasis: `min(45%, ${dockBasis(side)}px)` } : undefined} aria-label={`${dockLabels[side]} inside ${title}`} />;
  const openHandleMenu: React.MouseEventHandler<HTMLButtonElement> = event => {
    event.preventDefault(); event.stopPropagation();
    setMenuAnchor({ left: Math.max(8, Math.min(window.innerWidth - 220, event.clientX)), top: Math.max(8, Math.min(window.innerHeight - 200, event.clientY)) });
    setHandleMenuOpen(true);
  };
  const toolButton = (mode: HandleMode, corner = false) => ({
    corner, disabled: locked, selected: !corner && selectedTool === mode,
    onSelect: () => setSelectedTool(mode),
    onAssign: corner ? undefined : () => desktop.setPreferences(id, { handleMode: mode }),
    onContextMenu: corner ? openHandleMenu : undefined,
  });
  const mergeDestinations = [...destinations, ...[...desktop.windows].filter(([candidate, entry]) => !parentId && candidate !== id && entry.role === 'child' && !desktop.groups[candidate] && !desktop.state.panels[candidate]?.locked)];
  const magnetTool = (corner = false) => <ContainerMagnet key={`magnet:${corner}:${page}:${revision}`} {...toolButton('magnet', corner)} title={title} getFrame={viewportFrame} onActiveChange={setConnecting} onPreview={positionControls}
          topInset={toolbarOpen ? Math.max(0, surface.current?.querySelector('.desktop-window-tab')?.getBoundingClientRect().height || 28) : 0}
          getTargets={() => [...desktop.windows].filter(([candidate, entry]) => candidate !== id && !host?.contains(entry.host)
            && (desktop.groups[candidate] || undefined) === (desktop.groups[id] || undefined) && entry.surface.getClientRects().length > 0).map(([candidate, entry]) => {
              const bounds = entry.surface.getBoundingClientRect();
              const toolbar = entry.surface.querySelector(':scope > .desktop-window-tab');
              const topInset = toolbar?.getAttribute('data-open') === 'true' ? Math.max(0, bounds.top - toolbar.getBoundingClientRect().top) : 0;
              return { id: candidate, title: entry.title, frame: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }, topInset };
            })}
          onDrop={(position, snap, snaps) => {
            if (locked) return;
            desktop.capturePlacement(id, ...snaps?.map(value => value.id) || []);
            const owner = managed ? parent!.content : root!.current!;
            const area = owner.getBoundingClientRect();
            const next = { ...position, x: position.x - area.left + (managed ? owner.scrollLeft : 0), y: position.y - area.top + (managed ? owner.scrollTop : 0) };
            if (nested && !managed) desktop.group(id, undefined, undefined, next);
            else if (managed) {
              const layout = editedLayout(parentId!, id, next);
              if (layout) desktop.commit(s => ({ ...s, magnets: linkMagnet(s.magnets, id, snaps?.map(v => v.id) || []), layouts: { ...s.layouts, [parentId!]: layout } }));
            } else desktop.commit(s => ({ ...s, magnets: linkMagnet(s.magnets, id, snaps?.map(v => v.id) || (snap ? [snap.id] : [])), frames: { ...s.frames, [id]: constrainWindow(next, width, minimumWidth) } }));
          }} />;
  const mergeTool = (corner = false) => <ContainerConnector key={`merge:${corner}:${page}:${revision}`} {...toolButton('merge', corner)} title={title} onActiveChange={setConnecting} onPreview={positionControls}
          getInvalidTargets={() => [...desktop.windows].filter(([candidate, entry]) => candidate !== id && !mergeDestinations.some(([key]) => key === candidate) && !host?.contains(entry.host)).map(([candidate, entry]) => {
            const b = entry.surface.getBoundingClientRect(); return { id: candidate, title: entry.title, frame: { x: b.left, y: b.top, width: b.width, height: b.height } };
          })}
          onOpenOptions={() => { setPlacement(connection?.side || 'bottom'); setMenuOpen(true); }} getFrame={() => {
            const bounds = surface.current!.getBoundingClientRect();
            return { x: bounds.left, y: bounds.top, width: bounds.width, height: collapsed ? live.current?.height || 420 : bounds.height };
          }} getTargets={() => mergeDestinations.flatMap(([candidate, entry]) => {
            if (entry.getDockTargets) return entry.getDockTargets();
            const bounds = entry.surface.getBoundingClientRect();
            if (!entry.surface.getClientRects().length || bounds.bottom < 0 || bounds.top > window.innerHeight) return [];
            return [{ id: candidate, title: entry.title, frame: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height } }];
          })} onDrop={(position, snap) => {
            const area = root!.current!.getBoundingClientRect();
            desktop.group(id, snap?.id, snap?.side, { ...position, x: position.x - area.left, y: position.y - area.top });
          }} />;
  const toolbarGrip = !preferences.cornerHandleHidden && <button ref={toolbarToggle} type="button" className={commandStrip ? 'toolbar-panel-grip' : 'desktop-window-toolbar-toggle'}
    aria-label={`${toolbarOpen ? 'Hide' : 'Show'} controls for ${title}`} title={`${toolbarOpen ? 'Hide' : 'Show'} container controls`}
    aria-expanded={toolbarOpen} aria-controls={toolbarId}
    onClick={() => { setToolbarOpen(value => !value); setMenuOpen(false); }}>
    {commandStrip ? <GripVertical aria-hidden="true" /> : <span aria-hidden="true" />}
  </button>;
  const toolbarResizeEdge = connection?.side === 'left' ? 'e' : connection?.side === 'right' ? 'w' : connection?.side === 'bottom' ? 'n' : connection?.side === 'top' || connection?.side === 'header' ? 's' : 'e';
  const controlStrip = (
      <div ref={controlStripElement} id={toolbarId} className="desktop-window-tab" data-viewport-controls={toolbarOpen} data-placement={toolbarAnchor.current.placement} style={toolbarOpen ? { position: 'fixed', left: toolbarAnchor.current.left, top: toolbarAnchor.current.top, right: 'auto', bottom: 'auto', width: 256, height: 28, maxWidth: 'calc(100vw - 16px)', zIndex: 10010 } : undefined} role="group" aria-label={`${title} window controls`}
        data-open={toolbarOpen} aria-hidden={!toolbarOpen} {...(!toolbarOpen ? { inert: '' } : {})}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation(); setToolbarOpen(false); setMenuOpen(false); toolbarToggle.current?.focus();
          }
        }}>
        {desktop.enabled && <button type="button" disabled={locked} className="desktop-window-move" aria-label={`Move ${title}`} aria-pressed={selectedTool === 'move'} title="Normal Move: drag immediately; double-click to assign the corner handle. Arrow keys move; Shift moves farther."
          onClick={() => setSelectedTool('move')} onDoubleClick={() => desktop.setPreferences(id, { handleMode: 'move' })}
          onPointerDown={event => start(event, 'move')} onKeyDown={event => keyboard(event, 'move')}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">{[7, 12, 17].flatMap(y => [8, 14].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}</svg>
        </button>}
        {desktop.enabled && magnetTool()}
        {desktop.enabled && mergeTool()}
        {desktop.enabled && <button type="button" disabled={locked} className="desktop-window-resize-tool" aria-label={`Resize tool for ${title}`} aria-pressed={selectedTool === 'resize'}
          title="Resize: drag immediately; double-click to assign the corner handle. Arrow keys resize; Shift changes size faster."
          onClick={() => setSelectedTool('resize')} onDoubleClick={() => desktop.setPreferences(id, { handleMode: 'resize' })}
          onPointerDown={event => start(event, 'resize')} onKeyDown={event => keyboard(event, 'resize')}><Scaling aria-hidden="true" /></button>}
        <button type="button" aria-label={`${preferences.cornerHandleHidden ? 'Show' : 'Hide'} corner handle for ${title}`} title={`${preferences.cornerHandleHidden ? 'Show' : 'Hide'} lower-right corner handle`} aria-pressed={!!preferences.cornerHandleHidden}
          onClick={() => desktop.setPreferences(id, { cornerHandleHidden: !preferences.cornerHandleHidden })}>
          {preferences.cornerHandleHidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
        <ContainerLayoutMenu key={`layout:${page}:${toolbarOpen}`} title={title} kind={kind} content={contentKind} layout={layout} editing={editing}
          width={content.current?.clientWidth || minimumWidth} onChange={changeLayout} onEdit={setEditing} inspect={inspect} disabled={!desktop.enabled || locked || [...desktop.windows.keys()].some(child => desktop.groups[child] === id && desktop.state.panels[child]?.locked)} />
        <button ref={menuButton} type="button" className="desktop-window-options" aria-label={`Window options for ${title}`} aria-expanded={menuOpen} aria-controls={menuId}
          title="Window options" onClick={() => setMenuOpen(value => !value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeMenu(); } }}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">{[5, 12, 19].map(x => <circle key={x} cx={x} cy="12" r="1.7" />)}</svg>
        </button>
      </div>
  );
  const windowSurface = <div ref={surface} data-desktop-window={id} data-panel-variant={variant} data-panel-id={panel?.id || id} data-panel-name={title} data-panel-role={role} data-child-panel={role === 'child'} data-generated-parent={generated} data-selected={desktop.foreground === id} data-locked={locked} data-container-definition={definition.id} data-container-type={containerTypes[kind].id} data-content-kind={contentKind} data-dock-side={connection?.side} data-customized={!!bounded} data-managed-layout={managed} data-responsive-grid={responsiveGridChild} data-magnet-attached={magnetPeers.length > 0} data-window-nested={nested} data-has-docked={hasChildren} data-connecting={connecting} data-window-collapsed={collapsed} className="desktop-window" style={bounded ? { position: 'absolute', left: bounded.x - (floating || managed ? 0 : origin.x), top: bounded.y - (floating || managed ? 0 : origin.y), width: bounded.width, height: collapsed || responsiveGridChild ? undefined : bounded.height, minHeight: collapsed ? undefined : preferredHeight } : undefined}
      onPointerDownCapture={event => { if ((event.target as Element).closest('[data-desktop-window]') === surface.current) desktop.activate(id); }} onFocusCapture={event => { if ((event.target as Element).closest('[data-desktop-window]') === surface.current) desktop.activate(id); }}
      onPointerDown={event => {
        const target = event.target as Element;
        if (target.closest('[data-desktop-window]') !== surface.current) return;
        if (target.closest('.workspace-panel-header') && !target.closest('button, input, select, textarea, a, summary, [role="button"]')) start(event, 'move');
      }} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={cancelDrag}>
      <span className="desktop-merge-receipt" aria-hidden="true" />
      {magnetClips.map(clip => <button key={clip.peer} type="button" className="desktop-magnet-attachment" data-linked-edge={clip.edge}
        style={clip.edge === 'top' || clip.edge === 'bottom' ? { left: clip.position } : { top: clip.position }}
        aria-label={`Magnetically attached to ${desktop.windows.get(clip.peer)?.title}`}
        title={`Linked to ${desktop.windows.get(clip.peer)?.title}. Move together; use Magnet Move to pull apart.`}
        onClick={() => { setToolbarOpen(value => !value); setMenuOpen(false); }}><Paperclip aria-hidden="true" /></button>)}
      {!commandStrip && toolbarGrip}
      {toolbarOpen && typeof document !== 'undefined' ? createPortal(controlStrip, document.body) : controlStrip}
      {headerResizePreview && createPortal(<div className="header-resize-preview" aria-hidden="true" style={{ left: headerResizePreview.x, top: headerResizePreview.y, width: headerResizePreview.width, height: headerResizePreview.height }} />, document.body)}
      {menuOpen && createPortal(<div ref={menu} id={menuId} role="region" aria-label={`Window options for ${title}`} className="desktop-window-menu"
        style={{ position: 'fixed', left: menuAnchor.left, top: menuAnchor.top, right: 'auto', width: 280, maxHeight: `calc(100vh - ${menuAnchor.top + 12}px)`, zIndex: 10005 }}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeMenu(); } }}>
        <strong>{title}</strong>
        <label>Corner handle<select aria-label={`Corner handle for ${title}`} value={preferences.handleMode} disabled={locked}
          onChange={event => desktop.setPreferences(id, { handleMode: event.target.value as HandleMode })}>
          {handleModes.map(mode => <option key={mode} value={mode}>{toolNames[mode]}</option>)}
        </select></label>
        <p>Click a tool to identify it. Drag it to use it temporarily. Double-click to assign it here.</p>
        <button type="button" aria-pressed={preferences.locked} onClick={() => desktop.setPreferences(id, { locked: !preferences.locked })}><LockKeyhole aria-hidden="true" />{preferences.locked ? 'Unlock layout' : 'Lock layout'}</button>
        <div className="workspace-history adaptive-actions"><AdaptiveButton icon={<Undo2 />} label="Undo layout" description="Reverse the latest layout action" disabled={!desktop.canUndo} onClick={desktop.undo} /><AdaptiveButton icon={<Redo2 />} label="Redo layout" disabled={!desktop.canRedo} onClick={desktop.redo} /></div>
        {generated && <label>Parent name<input aria-label="Parent name" defaultValue={title} disabled={locked} onBlur={event => {
          const name = event.target.value.trim(); if (name) desktop.commit(s => ({ ...s, generated: s.generated.map(p => p.id === id ? { ...p, title: name.slice(0, 100) } : p) }));
        }} /></label>}
        {nested && <><p>Inside {parent!.title}</p><button type="button" disabled={locked} onClick={() => { desktop.group(id); closeMenu(); }}>Pop out</button></>}
        {role === 'child' && homeWindow && (parentId !== homeWindow || connection) && desktop.windows.has(homeWindow) && <button type="button" disabled={locked} onClick={() => { desktop.group(id, homeWindow); closeMenu(); }}>Return to {desktop.windows.get(homeWindow)!.title}</button>}
        <p>Move this panel into a parent panel. Its existing contents stay together.</p>
        <label>Placement<select aria-label={`Connection placement for ${title}`} value={placement} disabled={locked} onChange={event => setPlacement(event.target.value as DockSide)}>
          {dockSides.filter(side => side !== 'header' || definitionId === 'swissmouse.toolbar').map(side => <option key={side} value={side}>{dockLabels[side]}</option>)}
        </select></label>
        <label>Move into...<select aria-label={`Move ${title} into`} value="" disabled={locked || !mergeDestinations.length}
          onChange={event => { const target = event.target.value; if (target) { closeMenu(); requestAnimationFrame(() => desktop.group(id, target, placement)); } }}>
          <option value="">Choose a container</option>
          {mergeDestinations.map(([candidate, entry]) => <option key={candidate} value={candidate}>{entry.title}{entry.role === 'child' ? role === 'parent' ? ' (add to this panel)' : ' (create Parent)' : ''}</option>)}
        </select></label>
        {role === 'parent' && <label>Add panel<select aria-label={`Add panel to ${title}`} value="" disabled={locked} onChange={event => {
          const source = event.target.value; if (source) { closeMenu(); requestAnimationFrame(() => desktop.group(source, id, placement)); }
        }}><option value="">Choose a panel</option>{[...desktop.windows].filter(([candidate, entry]) => !entry.fixedSurface && !desktop.state.panels[candidate]?.locked && canGroupWindow(desktop.groups, candidate, id) && !entry.host.contains(surface.current)).map(([candidate, entry]) => <option key={candidate} value={candidate}>{entry.title}</option>)}</select></label>}

        <button type="button" onClick={closeMenu}>Done</button>
      </div>, document.body)}
      {handleMenuOpen && createPortal(<div ref={handleMenu} className="desktop-window-menu" role="menu" aria-label={`Assign corner handle for ${title}`}
        style={{ position: 'fixed', left: menuAnchor.left, top: menuAnchor.top, right: 'auto', width: 210, zIndex: 10006 }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); setHandleMenuOpen(false); surface.current?.querySelector<HTMLElement>('.desktop-window-corner')?.focus(); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); const buttons = [...handleMenu.current!.querySelectorAll<HTMLButtonElement>('button')];
            buttons[(buttons.indexOf(document.activeElement as HTMLButtonElement) + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
          }
        }}>
        {handleModes.map(mode => <button key={mode} type="button" role="menuitemradio" aria-checked={preferences.handleMode === mode} onClick={() => {
          desktop.setPreferences(id, { handleMode: mode }); setHandleMenuOpen(false); requestAnimationFrame(() => surface.current?.querySelector<HTMLElement>('.desktop-window-corner')?.focus());
        }}>{toolNames[mode]}{preferences.handleMode === mode ? ' ✓' : ''}</button>)}
      </div>, document.body)}
      {headerDockAnchor && createPortal(renderDock('header'), headerDockAnchor)}
      {headerToggleHost && createPortal(<button type="button" data-desktop-header-toggle="true" className="workspace-header-toggle ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center"
        aria-label={`Collapse ${title}`} aria-expanded={!tabCollapsed} aria-controls={contentId}
        onClick={() => setTabCollapsed(true)}><ChevronDown className="disclosure-chevron h-4 w-4" /></button>, headerToggleHost)}
      {collapsible && tabCollapsed && <header data-centered-heading={!!collapsedIcon} className={`desktop-window-collapsed-header workspace-panel-header ${role === 'child' ? 'child-panel-header' : ''}`}>{collapsedIcon && <span className="desktop-window-collapsed-icon" aria-hidden="true">{collapsedIcon}</span>}<h2 className="workspace-panel-title">{title}</h2>{collapsedActions && <div className="desktop-window-collapsed-actions" onClickCapture={() => setTabCollapsed(false)}>{collapsedActions}</div>}<button type="button" className="workspace-header-toggle ml-auto inline-flex h-8 w-8 items-center justify-center" aria-label={`Expand ${title}`} aria-expanded={false} aria-controls={contentId} onClick={() => setTabCollapsed(false)}><ChevronRight className="disclosure-chevron h-4 w-4" /></button></header>}
      <div ref={content} id={contentId} className="desktop-window-content" data-layout={arranged ? layout.mode : 'original'} data-arranging={editing && arranged} data-show-grid={editing && arranged && layout.showGrid} hidden={collapsible && tabCollapsed}
        style={{ '--sm-grid-size': `${layout.gridSize}px`, minHeight: collapsed || bounded ? undefined : layoutHeight, overflow: panel?.constraints?.overflow } as React.CSSProperties}>
        {needsHeading && (!arranged || generated) && <header className={`container-standard-header workspace-panel-header ${role === 'child' ? 'child-panel-header' : ''}`}><h2 className="workspace-panel-title">{title}</h2><button type="button" className="workspace-header-toggle ml-auto inline-flex h-8 w-8 items-center justify-center" aria-label={`Collapse ${title}`} aria-expanded={true} aria-controls={contentId} onClick={() => setTabCollapsed(true)}><ChevronDown className="disclosure-chevron h-4 w-4" /></button></header>}
        {renderDock('top')}
        <div className="desktop-window-body">
          {renderDock('left')}
          <div ref={main} className="desktop-window-main" data-layout-content={arranged}
            style={arranged && contentFrame ? { position: 'absolute', left: contentFrame.x, top: contentFrame.y, width: contentFrame.width, height: contentFrame.height } : undefined}>
            {arranged && editing && !locked && contentFrame && <ContainerContentControls title={title} element={main} frame={contentFrame} step={layout.mode === 'grid' ? layout.gridSize : 1}
              minimumWidth={minimumWidth} onCommit={position => {
                const next = editedLayout(id, '$content', position);
                if (next) desktop.setLayout(id, next);
              }} />}
            {needsHeading && arranged && !generated && <header className={`container-standard-header workspace-panel-header ${role === 'child' ? 'child-panel-header' : ''}`}><h2 className="workspace-panel-title">{title}</h2></header>}
            <ToolbarGripContext.Provider value={toolbarGrip}>{children}</ToolbarGripContext.Provider>
          </div>
          {renderDock('right')}
        </div>
        {renderDock('bottom')}
        {arranged && <div className="container-layout-spacer" aria-hidden="true" style={{ height: layoutHeight, width: Math.max(0, ...Object.entries(resolvedLayout.items).filter(([key]) => key === '$content' || desktop.groups[key] === id).map(([, item]) => item.x + item.width + 16)) }} />}
        {arranged && editing && layout.regions.map((region, index) => <div key={index} className="container-layout-region" aria-hidden="true"
          style={{ left: region.x, top: region.y, width: region.width, height: region.height }}><span>{index + 1}</span></div>)}
      </div>
      {desktop.enabled && !collapsed && !locked && <>{(enabled && !(commandStrip && nested) ? ['n', 's', 'e', 'w', 'ne', 'nw', 'sw'] : []).map(edge => <button key={edge} type="button"
        className={`desktop-window-resize desktop-window-resize-${edge}`} aria-label={`Resize ${title}${edge === 'se' ? '' : ` (${edge})`}`}
        title={`Drag to resize ${title}. Arrow keys resize; Shift changes size faster.`} tabIndex={edge === 'se' ? 0 : -1}
        onPointerDown={event => start(event, 'resize', edge)} onKeyDown={event => keyboard(event, 'resize')}>
        {edge === 'se' && <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="m8 20 12-12m-5 12 5-5" /></svg>}
      </button>)}
      {commandStrip && nested ? (!preferences.cornerHandleHidden && <button type="button" className={`desktop-toolbar-resize-edge desktop-toolbar-resize-${toolbarResizeEdge}`}
        aria-label={`Resize ${title} outer edge`} title={`Drag to resize ${title}. Arrow keys resize; Shift changes size faster.`}
        onPointerDown={event => start(event, 'resize', toolbarResizeEdge)} onKeyDown={event => keyboard(event, 'resize')} />) : !preferences.cornerHandleHidden && (preferences.handleMode === 'magnet' ? magnetTool(true) : preferences.handleMode === 'merge' ? mergeTool(true) :
        <button type="button" className={`desktop-window-corner ${preferences.handleMode === 'resize' ? 'desktop-window-resize-se' : 'desktop-window-move'}`}
          aria-label={`Corner handle: ${toolNames[preferences.handleMode]} ${title}`} title={`Corner handle: ${toolNames[preferences.handleMode]}. Drag or use arrow keys. Right-click or use Window options to change tool.`}
          onContextMenu={openHandleMenu} onPointerDown={event => start(event, preferences.handleMode === 'resize' ? 'resize' : 'move')}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setMenuOpen(true); } else keyboard(event, preferences.handleMode === 'resize' ? 'resize' : 'move'); }}>
          {preferences.handleMode === 'resize' ? <Scaling aria-hidden="true" /> : <GripVertical aria-hidden="true" />}
        </button>)}
      </>}

    </div>;
  return <div ref={slot} className={`desktop-window-slot ${className}`} data-scroll-follow={followScroll} hidden={(nested && !atHome) || floatingSection}
    style={{ height: bounded ? origin.height : undefined, zIndex: desktop.foreground === id || desktop.groups[desktop.foreground || ''] === id ? 2 : 1 }}>
    {host ? createPortal(windowSurface, host) : windowSurface}
  </div>;
}
