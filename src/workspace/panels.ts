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

// Retain legacy instance IDs: saved page layouts must survive this catalog.
const parents = [
  ['application-header', 'Application Header'], ['library-navigation', 'Library navigation'], ['library-books', 'Library books'],
  ['project-navigation', 'Project navigation'], ['project-overview', 'Project Overview'],
  ['add-files', 'Add Files'], ['panel-File Manager', 'File Manager'],
  ['panel-Processing Order', 'Processing Order'], ['processing-progress', 'Audio processing'],
  ['processing-output', 'Output'], ['processing-options', 'Audio and Chapters'],
  ['transcription-settings', 'Transcription and model settings'], ['processing-readiness', 'Workflow'],
  ['chapter-review-workflow', 'Chapter review workflow'], ['chapter-player', 'Interactive Audio Player'], ['transcript', 'Transcript'], ['chapter-editor', 'Chapter Editor'],
  ['final-check-workflow', 'Final check workflow'], ['conversion-workflow', 'Conversion workflow'], ['metadata', 'Metadata'], ['export', 'Convert'], ['final-check', 'Final check'],
] as const;
for (const [id, name] of parents) registerPanel({ id, name, role: 'parent', ...(id === 'project-navigation' ? { constraints: { minimumWidth: 56, minimumHeight: 48 } } : {}) });
const children = [
  ['chapter-creation', 'Chapter Creation'], ['audio-preparation', 'Audio Preparation'],
  ['header-media-player', 'Media Player'], ['header-toolbar', 'Header Toolbar'], ['file-manager-toolbar', 'File Toolbar'],
  ['metadata-cover', 'Cover art'], ['metadata-identity', 'Book title and contributors'],
  ['metadata-taxonomy', 'Series & Taxonomy'], ['metadata-description', 'Description'],
  ['metadata-publication', 'Publication'], ['metadata-identifiers', 'Identifiers'], ['metadata-rights', 'Rights'],
] as const;
for (const [id, name] of children) registerPanel({ id, name, role: 'child', defaultParent: id === 'chapter-creation' || id === 'audio-preparation' ? 'processing-options' : id === 'header-media-player' || id === 'header-toolbar' ? 'application-header' : id === 'file-manager-toolbar' ? 'panel-File Manager' : 'metadata' });
registerPanel({ id: 'file-manager-folders', name: 'File Manager Folders', role: 'child', defaultParent: 'panel-File Manager' });
registerPanel({ id: 'chapter-waveform', name: 'Waveform', role: 'child', defaultParent: 'chapter-player' });
registerPanel({ id: 'interactive-transcription', name: 'Interactive Transcription Window', role: 'child', defaultParent: 'chapter-player' });
