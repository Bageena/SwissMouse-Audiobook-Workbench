/** Public, presentation-independent resource contracts. No React or filesystem dependencies. */
export type ResourceId = string;
export type ResourceKind = 'core.work' | 'core.recording' | 'core.file' | (string & {});
export interface ResourceSummary {
  id: ResourceId;
  kind: ResourceKind;
  moduleId: string;
  title: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}
export interface ResourceRelation { fromId: ResourceId; toId: ResourceId; kind: string; position?: number }
export interface ResourcePage { items: ResourceSummary[]; total: number; nextCursor?: string; revision: number }
export interface ResourceFile extends ResourceSummary { path: string; sizeBytes?: number; modifiedMs?: number }

/** IDs and content are separate from theme labels, icons, and container instance IDs. */
export const resourceContractVersion = 1;
export const coreResourceKinds = [
  { id: 'core.work', title: 'Work', themeRole: 'resource' },
  { id: 'core.recording', title: 'Recording / edition', themeRole: 'resource' },
  { id: 'core.file', title: 'File', themeRole: 'resource' },
] as const;
