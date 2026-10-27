import { readStored, writeStored } from './libraryWorkspace';
import type { WindowFrame } from './desktopLayout';

export type MagnetLinks = [string, string][];
export function linkMagnet(links: MagnetLinks, id: string, target?: string | string[]): MagnetLinks {
  const next = links.filter(pair => !pair.includes(id));
  const targets = [...new Set(Array.isArray(target) ? target : target ? [target] : [])].filter(key => key !== id);
  return [...next, ...targets.map(key => [id, key] as [string, string])];
}
export function magnetCluster(links: MagnetLinks, id: string): string[] {
  const found = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [a, b] of links) {
      if (found.has(a) && !found.has(b)) { found.add(b); changed = true; }
      if (found.has(b) && !found.has(a)) { found.add(a); changed = true; }
    }
  }
  return [...found];
}
export function loadMagnetLinks(page: string): MagnetLinks {
  const value = readStored<unknown>(`swissmouse-desktop-v1:${page}:magnets`, []);
  return Array.isArray(value) ? value.filter((pair): pair is [string, string] => Array.isArray(pair) && pair.length === 2 && pair.every(id => typeof id === 'string' && !!id) && pair[0] !== pair[1]) : [];
}

export const dockSides = ['left', 'right', 'top', 'bottom', 'header'] as const;
export type DockSide = typeof dockSides[number];
export type WindowConnection = { parent: string; side: DockSide; order: number };
export type WindowConnections = Record<string, WindowConnection>;
export type DockTarget = { id: string; title: string; frame: WindowFrame; sides?: DockSide[] };
export type DockSnap = DockTarget & { side: DockSide };
export function growDockFrame(parent: WindowFrame, child: WindowFrame, side: DockSide): WindowFrame {
  const row = side === 'left' || side === 'right';
  return { ...parent, width: row ? parent.width + child.width + 24 : Math.max(parent.width, child.width + 24),
    height: row ? Math.max(parent.height, child.height + 54) : parent.height + child.height + 54 };
}
export const dockLabels: Record<DockSide, string> = {
  left: 'Left side', right: 'Right side', top: 'Top of container', bottom: 'Footer', header: 'Under header',
};
const safeId = (id: unknown): id is string => typeof id === 'string' && !!id && !['__proto__', 'constructor', 'prototype'].includes(id);

export function validWindowConnections(value: unknown): WindowConnections {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, connection]) => safeId(id)
    && connection && typeof connection === 'object' && safeId(connection.parent) && connection.parent !== id
    && dockSides.includes(connection.side) && Number.isSafeInteger(connection.order)));
}
export function loadWindowConnections(page: string): WindowConnections {
  return validWindowConnections(readStored(`swissmouse-desktop-v1:${page}:connections`, {}));
}
export function saveWindowConnections(page: string, connections: WindowConnections) {
  writeStored(`swissmouse-desktop-v1:${page}:connections`, validWindowConnections(connections));
}
export function connectWindow(connections: WindowConnections, id: string, parent?: string, side?: DockSide): WindowConnections {
  const next = { ...connections };
  delete next[id];
  if (parent && side) {
    const orders = Object.values(next).filter(item => item.parent === parent && item.side === side).map(item => item.order);
    next[id] = { parent, side, order: side === 'left' || side === 'top' ? Math.min(0, ...orders) - 1 : Math.max(0, ...orders) + 1 };
  }
  return next;
}

/** Pointer magnets work inside and just outside an edge, including its corners.
 * The wider release band prevents flickering when hovering an acquired edge. */
export function findDockSnap(point: { x: number; y: number }, targets: DockTarget[], previous?: DockSnap): DockSnap | undefined {
  const candidates = targets.flatMap(target => dockSides.filter(side => side !== 'header' && (!target.sides || target.sides.includes(side))).map(side => {
    const f = target.frame;
    const horizontal = side === 'top' || side === 'bottom';
    const edge = side === 'left' ? f.x : side === 'right' ? f.x + f.width : side === 'top' ? f.y : f.y + f.height;
    const along = horizontal ? point.x : point.y;
    const start = horizontal ? f.x : f.y;
    const end = start + (horizontal ? f.width : f.height);
    const distance = Math.hypot((horizontal ? point.y : point.x) - edge, Math.max(start - along, 0, along - end));
    const retained = previous?.id === target.id && previous.side === side;
    const band = Math.min(64, (horizontal ? f.height : f.width) / 3) + (retained ? 16 : 0);
    const inside = point.x >= f.x && point.x <= f.x + f.width && point.y >= f.y && point.y <= f.y + f.height;
    return { ...target, side, distance, retained, eligible: f.width > 0 && f.height > 0 && (inside || distance <= band) };
  })).filter(candidate => candidate.eligible);
  candidates.sort((a, b) => (a.distance - (a.retained ? 12 : 0)) - (b.distance - (b.retained ? 12 : 0)));
  const winner = candidates[0];
  return winner && { id: winner.id, title: winner.title, frame: winner.frame, side: winner.side };
}

export function dockPreviewFrame({ frame: f, side }: DockSnap): WindowFrame {
  if (side === 'left' || side === 'right') return { ...f, x: side === 'left' ? f.x : f.x + f.width * 2 / 3, width: f.width / 3 };
  return { ...f, y: side === 'top' ? f.y : f.y + f.height * 2 / 3, height: f.height / 3 };
}
