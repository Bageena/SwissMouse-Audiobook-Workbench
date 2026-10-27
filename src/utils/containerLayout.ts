import { readStored, writeStored } from './libraryWorkspace';
import type { WindowFrame } from './desktopLayout';

export type ContainerKind = 'panel' | 'bar' | 'group' | 'preview';
export type ContentKind = 'widget' | 'gallery' | 'menu';
export type LayoutMode = 'original' | 'grid' | 'canvas';
export const containerTypes = {
  preview: { id: 'swissmouse.preview', name: 'Preview', description: 'A compact live view of workspace content' },
  panel: { id: 'swissmouse.panel', name: 'Panel', description: 'A movable workspace' },
  bar: { id: 'swissmouse.bar', name: 'Bar', description: 'A strip of controls' },
  group: { id: 'swissmouse.group', name: 'Group', description: 'Related workspaces arranged together' },
} as const;
export const contentTypes = { widget: 'Widget', gallery: 'Gallery', menu: 'Menu' } as const;
export type ContainerDefinition = {
  id: string; name: string; type: ContainerKind; content: ContentKind;
  version: 1; minimumWidth: number;
};
const definitions = new Map<string, ContainerDefinition>();
/** Built-ins and future trusted modules use the same descriptor contract.
 * Display names may change; IDs and saved instance identities must not. */
export function registerContainer(definition: ContainerDefinition) {
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(definition.id)
    || typeof definition.name !== 'string' || !definition.name.trim() || !Object.hasOwn(containerTypes, definition.type)
    || !Object.hasOwn(contentTypes, definition.content) || definition.version !== 1
    || !Number.isFinite(definition.minimumWidth) || definition.minimumWidth < 48)
    throw new Error('Invalid container definition');
  if (definitions.has(definition.id)) throw new Error(`Container already registered: ${definition.id}`);
  const registered = Object.freeze({ ...definition });
  definitions.set(definition.id, registered);
  return () => { if (definitions.get(definition.id) === registered) definitions.delete(definition.id); };
}
export const listContainerDefinitions = () => [...definitions.values()];
export const getContainerDefinition = (id: string) => definitions.get(id);
for (const type of Object.keys(containerTypes) as ContainerKind[]) registerContainer({
  id: containerTypes[type].id, name: containerTypes[type].name, type, content: 'widget', version: 1, minimumWidth: type === 'preview' ? 160 : 280,
});

registerContainer({ id: 'swissmouse.navigation', name: 'Navigation Panel', type: 'bar', content: 'menu', version: 1, minimumWidth: 56 });
registerContainer({ id: 'swissmouse.toolbar', name: 'Toolbar Panel', type: 'bar', content: 'widget', version: 1, minimumWidth: 48 });
registerContainer({ id: 'swissmouse.slide-out', name: 'Slide-out Panel', type: 'panel', content: 'widget', version: 1, minimumWidth: 160 });

export type ContainerLayout = {
  version: 1; mode: LayoutMode; gridSize: number; showGrid: boolean;
  regions: WindowFrame[]; items: Record<string, WindowFrame>;
};
export const defaultContainerLayout = (): ContainerLayout => ({
  version: 1, mode: 'original', gridSize: 24, showGrid: true, regions: [], items: {},
});
const safeKey = (id: string) => !['__proto__', 'constructor', 'prototype'].includes(id);
const validFrame = (f: unknown): f is WindowFrame => !!f && typeof f === 'object'
  && ['x', 'y', 'width', 'height'].every(k => Number.isFinite((f as any)[k]))
  && (f as WindowFrame).width > 0 && (f as WindowFrame).height > 0;
const cleanFrame = (f: WindowFrame): WindowFrame => ({
  x: Math.max(0, Math.min(20000, Math.round(f.x))), y: Math.max(0, Math.min(20000, Math.round(f.y))),
  width: Math.max(48, Math.min(20000, Math.round(f.width))), height: Math.max(100, Math.min(20000, Math.round(f.height))),
});
export function validContainerLayout(value: unknown): ContainerLayout {
  const fallback = defaultContainerLayout();
  if (!value || typeof value !== 'object' || (value as any).version !== 1) return fallback;
  const v = value as ContainerLayout;
  return {
    version: 1, mode: ['original', 'grid', 'canvas'].includes(v.mode) ? v.mode : 'original',
    gridSize: [8, 12, 16, 24, 32, 48].includes(v.gridSize) ? v.gridSize : 24,
    showGrid: typeof v.showGrid === 'boolean' ? v.showGrid : true,
    regions: Array.isArray(v.regions) ? v.regions.filter(validFrame).slice(0, 64).map(cleanFrame) : [],
    items: v.items && typeof v.items === 'object' && !Array.isArray(v.items)
      ? Object.fromEntries(Object.entries(v.items).filter(([id, f]) => safeKey(id) && validFrame(f)).slice(0, 256).map(([id, f]) => [id, cleanFrame(f)])) : {},
  };
}
export const loadContainerLayout = (page: string, id: string) =>
  validContainerLayout(readStored(`swissmouse-desktop-v1:${page}:container:${id}`, null));
export const saveContainerLayout = (page: string, id: string, layout: ContainerLayout) =>
  writeStored(`swissmouse-desktop-v1:${page}:container:${id}`, validContainerLayout(layout));

export const snap = (n: number, cell: number) => Math.round(n / cell) * cell;
export const overlaps = (a: WindowFrame, b: WindowFrame, gap = 0) =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
export function snapFrame(frame: WindowFrame, cell: number, minimumWidth = 48): WindowFrame {
  return { x: Math.max(0, snap(frame.x, cell)), y: Math.max(Math.ceil(36 / cell) * cell, snap(frame.y, cell)),
    width: Math.max(Math.ceil(minimumWidth / cell) * cell, snap(frame.width, cell)),
    height: Math.max(Math.ceil(100 / cell) * cell, snap(frame.height, cell)) };
}
/** Geometry only: proportional to registered layout objects, never catalog rows. */
export function placeContainerItem(frame: WindowFrame, layout: ContainerLayout, others: WindowFrame[], minimumWidth = 48): WindowFrame {
  if (layout.mode !== 'grid') return cleanFrame({ ...frame, width: Math.max(minimumWidth, frame.width) });
  const cell = layout.gridSize;
  const regions = layout.regions.filter(r => r.width >= minimumWidth && !others.some(o => overlaps(r, o)))
    .sort((a, b) => Math.hypot(frame.x - a.x, frame.y - a.y) - Math.hypot(frame.x - b.x, frame.y - b.y));
  let placed = snapFrame(regions[0] || frame, cell, minimumWidth);
  // Keep the nearest open position; resolve collisions downwards deterministically.
  for (let i = 0; i <= others.length; i++) {
    // Adjacent columns are valid. Only the vertical axis needs clearance for
    // each object's toolbar; a blanket gap would unnecessarily stack columns.
    const clearance = Math.max(36, cell);
    const colliding = others.filter(o => overlaps(placed, { ...o, y: o.y - clearance, height: o.height + clearance * 2 }));
    if (!colliding.length) break;
    placed = { ...placed, y: Math.ceil(Math.max(...colliding.map(o => o.y + o.height + Math.max(36, cell))) / cell) * cell };
  }
  return placed;
}
export function arrangeContainer(layout: ContainerLayout, items: Record<string, WindowFrame>, minimums: Record<string, number> = {}): ContainerLayout {
  const placed: Record<string, WindowFrame> = {};
  for (const [id, frame] of Object.entries(items).sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x)) placed[id] = placeContainerItem(frame, layout, Object.values(placed), minimums[id]);
  return { ...layout, items: placed };
}

/** Resolve preferred pixel footprints for the current parent width. This is a
 * view calculation only: expanding restores the exact saved arrangement. */
export function resolveContainerLayout(layout: ContainerLayout, width: number, minimums: Record<string, number> = {}, naturalHeights: Record<string, number> = {}): ContainerLayout {
  if (layout.mode !== 'grid' || width <= 0) return layout;
  const available = Math.max(48, Math.floor(width - 16));
  const preferredWidth = Math.max(available, ...Object.values(layout.items).map(f => f.x + f.width));
  const scale = Math.min(1, available / preferredWidth);
  const placed: Record<string, WindowFrame> = {};
  for (const [id, frame] of Object.entries(layout.items).sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x)) {
    const itemWidth = Math.min(available, Math.max(minimums[id] || 280, Math.floor(frame.width * scale)));
    let next = { ...frame, height: Math.max(frame.height, naturalHeights[id] || 0), width: itemWidth, x: Math.max(0, Math.min(available - itemWidth, Math.floor(frame.x * scale))) };
    for (let i = 0; i <= Object.keys(placed).length; i++) {
      const collisions = Object.values(placed).filter(o => overlaps(next, { ...o, y: o.y - 36, height: o.height + 72 }));
      if (!collisions.length) break;
      next = { ...next, y: Math.max(...collisions.map(o => o.y + o.height + 36)) };
    }
    placed[id] = next;
  }
  return { ...layout, items: placed };
}

export type MagnetTarget = { id: string; title: string; frame: WindowFrame; topInset?: number };
export type MagnetSnap = { id: string; side: 'left' | 'right' | 'top' | 'bottom'; frame: WindowFrame; title: string };
export const MAGNET_CAPTURE = 18;
export const MAGNET_RELEASE = 34;
export const MAGNET_GAP = 8;
/** Edge-to-edge attraction, with hysteresis so attached objects resist small
 * movements before releasing. No DOM reads or allocations of library content. */
export function magneticFrame(frame: WindowFrame, targets: MagnetTarget[], held?: MagnetSnap, topInset = 30): { frame: WindowFrame; snap?: MagnetSnap; snaps?: MagnetSnap[] } {
  let best: { snap: MagnetSnap; score: number } | undefined;
  let horizontalSnap: typeof best;
  let verticalSnap: typeof best;
  for (const target of targets) {
    const t = target.frame;
    if (t.width <= 0 || t.height <= 0) continue;
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const horizontal = side === 'left' || side === 'right';
      const overlap = horizontal
        ? Math.min(frame.y + frame.height, t.y + t.height) - Math.max(frame.y, t.y)
        : Math.min(frame.x + frame.width, t.x + t.width) - Math.max(frame.x, t.x);
      if (overlap < Math.min(40, (horizontal ? frame.height : frame.width) / 3)) continue;
      const coordinate = side === 'left' ? t.x - frame.width - MAGNET_GAP
        : side === 'right' ? t.x + t.width + MAGNET_GAP
          : side === 'top' ? t.y - frame.height - (target.topInset ?? 30) - MAGNET_GAP : t.y + t.height + topInset + MAGNET_GAP;
      if (coordinate < 0) continue;
      const distance = Math.abs((horizontal ? frame.x : frame.y) - coordinate);
      const retained = held?.id === target.id && held.side === side;
      if (distance > (retained ? MAGNET_RELEASE : MAGNET_CAPTURE)) continue;
      const result = { ...frame, [horizontal ? 'x' : 'y']: coordinate };
      const along = horizontal ? 'y' : 'x';
      if (Math.abs(result[along] - t[along]) <= MAGNET_CAPTURE) result[along] = t[along];
      const score = distance - (retained ? MAGNET_CAPTURE : 0);
      const candidate = { snap: { id: target.id, title: target.title, side, frame: result }, score };
      if (horizontal && (!horizontalSnap || score < horizontalSnap.score)) horizontalSnap = candidate;
      if (!horizontal && (!verticalSnap || score < verticalSnap.score)) verticalSnap = candidate;
      if (!best || score < best.score) best = candidate;
    }
  }
  if (!best) return { frame };
  // An already aligned side must not prevent capture along the other axis.
  const result = horizontalSnap && verticalSnap
    ? { ...frame, x: horizontalSnap.snap.frame.x, y: verticalSnap.snap.frame.y }
    : best.snap.frame;
  return { frame: result, snap: { ...best.snap, frame: result }, snaps: [horizontalSnap, verticalSnap].flatMap(value => value ? [{ ...value.snap, frame: result }] : []) };
}
