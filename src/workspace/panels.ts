import { validWindowGroups } from '../utils/desktopLayout';
/** Panel identity and role are independent of placement and visual container kind. */
export type PanelRole = 'parent' | 'child';
export type FluidPanelConstraints = Readonly<{
  minimumWidth: number; minimumHeight?: number;
  preferredWidth?: number; preferredHeight?: number; aspectRatio?: number;
  maximumWidth?: number; maximumHeight?: number;
  priority?: number; overflow?: 'auto' | 'visible'; grow?: boolean;
}>;
export type PanelDefinition = Readonly<{
  id: string;
  name: string;
  role: PanelRole;
  defaultParent?: string;
  module?: string;
  constraints?: FluidPanelConstraints;
  defaultConfig?: Readonly<Record<string, string | number | boolean>>;
}>;

const panels = new Map<string, PanelDefinition>();
const nameKey = (name: string) => name.trim().toLocaleLowerCase('en-US');
export function registerPanel(definition: PanelDefinition) {
  const constraints = definition.constraints;
  if (!definition.id?.trim() || ['__proto__', 'constructor', 'prototype', '$content'].includes(definition.id)
    || !definition.name?.trim() || !['parent', 'child'].includes(definition.role)
    || (definition.defaultParent !== undefined && (definition.role !== 'child'
      || !definition.defaultParent.trim() || definition.defaultParent === definition.id)))
    throw new Error('Invalid panel definition');
  if (constraints && (!Number.isFinite(constraints.minimumWidth) || constraints.minimumWidth < 48
    || Object.entries(constraints).some(([key, value]) => typeof value === 'number' && (!Number.isFinite(value) || value <= 0) && key !== 'priority')
    || (constraints.maximumWidth !== undefined && constraints.maximumWidth < constraints.minimumWidth)
    || (constraints.maximumHeight !== undefined && constraints.maximumHeight < (constraints.minimumHeight || 100))))
    throw new Error('Invalid fluid panel constraints');
  if (panels.has(definition.id)) throw new Error(`Panel already registered: ${definition.id}`);
  if ([...panels.values()].some(panel => nameKey(panel.name) === nameKey(definition.name)))
    throw new Error(`Panel friendly name already registered: ${definition.name}`);
  const registered = Object.freeze({ ...definition, name: definition.name.trim(), ...(constraints ? { constraints: Object.freeze({ ...constraints }) } : {}) });
  panels.set(definition.id, registered);
  return () => { if (panels.get(definition.id) === registered) panels.delete(definition.id); };
}
export const getPanelDefinition = (id: string) => panels.get(id);
export const listPanelDefinitions = (): PanelDefinition[] => [...panels.values()];
export const canDockPanel = (source: PanelRole, target: PanelRole) => target === 'parent';
/** Both panel roles may nest inside parents; retain roles and reject cycles. */
export function filterPanelGroups(groups: Record<string, string>, roleFor: (id: string) => PanelRole | undefined = id => getPanelDefinition(id)?.role) {
  return validWindowGroups(Object.fromEntries(Object.entries(groups).map(([id, parent]) => {
    const targetRole = roleFor(parent);
    return [id, targetRole && targetRole !== 'parent' ? '' : parent];
  })));
}

// Standard shell and physical file-browser controls. Domain panels register on activation.
for (const [id, name] of [
  ['application-header', 'Application Header'], ['panel-File Manager', 'File Manager'],
] as const) registerPanel({ id, name, role: 'parent' });
for (const [id, name, defaultParent] of [
  ['header-media-player', 'Media Player', 'application-header'],
  ['header-toolbar', 'Header Toolbar', 'application-header'],
  ['file-manager-toolbar', 'File Toolbar', 'panel-File Manager'],
  ['file-manager-folders', 'File Manager Folders', 'panel-File Manager'],
] as const) registerPanel({ id, name, role: 'child', defaultParent });
