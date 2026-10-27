import { readStored, writeStored } from './libraryWorkspace';

export type WindowFrame = { x: number; y: number; width: number; height: number };
export const DESKTOP_RESET_EVENT = 'swissmouse-reset-page-layout';
const prefix = (page: string) => `swissmouse-desktop-v1:${page}:`;

export function constrainWindow(frame: WindowFrame, availableWidth: number, minimumWidth = 280, bounds = { left: 0, right: availableWidth }, minimumHeight = 100): WindowFrame {
  const deskWidth = Math.max(0, bounds.right - bounds.left);
  const width = Math.round(Math.max(Math.min(minimumWidth, deskWidth), Math.min(deskWidth, frame.width)));
  return {
    x: Math.round(Math.max(bounds.left, Math.min(bounds.right - width, frame.x))),
    y: Math.round(Math.max(0, Math.min(20000, frame.y))),
    width,
    height: Math.round(Math.max(minimumHeight, Math.min(4000, frame.height))),
  };
}

export function loadWindowFrame(page: string, id: string): WindowFrame | undefined {
  const value = readStored<WindowFrame | null>(prefix(page) + id, null);
  if (!value || !['x', 'y', 'width', 'height'].every(key => typeof value[key as keyof WindowFrame] === 'number' && Number.isFinite(value[key as keyof WindowFrame])) || value.width <= 0 || value.height <= 0) return undefined;
  return value;
}

export function saveWindowFrame(page: string, id: string, frame: WindowFrame) {
  writeStored(prefix(page) + id, frame);
}

export function resetPageLayout(page: string) {
  try {
    const keys = Object.keys(localStorage).filter(key => key.startsWith(prefix(page)));
    keys.forEach(key => localStorage.removeItem(key));
  } catch { /* Reset the current view even when browser storage is unavailable. */ }
  window.dispatchEvent(new CustomEvent(DESKTOP_RESET_EVENT, { detail: page }));
}

/** Nested panel ownership is allowed; self-links and ancestor cycles are not. */
export type WindowGroups = Record<string, string>;
export function validWindowGroups(value: unknown): WindowGroups {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(([child, parent]) =>
    child && typeof parent === 'string' && child !== parent
    && !['__proto__', 'constructor', 'prototype'].includes(child)
    && !['__proto__', 'constructor', 'prototype'].includes(parent));
  const groups = Object.fromEntries(entries) as WindowGroups;
  return Object.fromEntries(entries.filter(([id, parent]) => {
    const visited = new Set<string>();
    let ancestor = parent as string;
    while (ancestor && !visited.has(ancestor)) {
      if (ancestor === id) return false;
      visited.add(ancestor); ancestor = groups[ancestor];
    }
    return true;
  }));
}
export function loadWindowGroups(page: string): WindowGroups {
  return validWindowGroups(readStored<unknown>(prefix(page) + 'groups', {}));
}
export function canGroupWindow(groups: WindowGroups, child: string, parent: string): boolean {
  if (!child || !parent || child === parent) return false;
  const visited = new Set<string>();
  let ancestor = parent;
  while (ancestor) {
    if (ancestor === child || visited.has(ancestor)) return false;
    visited.add(ancestor); ancestor = groups[ancestor];
  }
  return true;
}
export function saveWindowGroups(page: string, groups: WindowGroups) {
  writeStored(prefix(page) + 'groups', validWindowGroups(groups));
}
