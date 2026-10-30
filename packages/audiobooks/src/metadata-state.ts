import type { AudiobookMetadata } from './domain';
export interface MetadataRecord {
  metadata?: AudiobookMetadata; metadataOverrides?: Partial<AudiobookMetadata>; metadataRevision?: number;
  libraryScan?: { detectedMetadata?: AudiobookMetadata; coverSignature?: string };
}
import { createHash } from 'node:crypto';

export function retainMetadataOverrides(job: MetadataRecord) {
  const baseline = job.libraryScan?.detectedMetadata;
  const overrides = { ...job.metadataOverrides };
  if (baseline) for (const [field, value] of Object.entries(job.metadata || {})) {
    const unchanged = field === 'cover' && job.libraryScan?.coverSignature
      ? createHash('sha256').update(JSON.stringify(value || null)).digest('hex') === job.libraryScan.coverSignature
      : JSON.stringify(value) === JSON.stringify((baseline as any)[field]);
    if (!unchanged) (overrides as any)[field] = value;
  }
  job.metadataOverrides = overrides;
}

export function mergeDetectedMetadata(job: MetadataRecord, detected: AudiobookMetadata) {
  retainMetadataOverrides(job);
  // Legacy records with no detection baseline cannot safely distinguish manual
  // edits from observations. Preserve their existing values conservatively.
  const existing = !job.libraryScan?.detectedMetadata ? job.metadata : undefined;
  return { ...detected, ...existing, ...job.metadataOverrides };
}

export function recordMetadataEdit(job: MetadataRecord, next: AudiobookMetadata) {
  retainMetadataOverrides(job);
  for (const [field, value] of Object.entries(next)) {
    if (JSON.stringify(value) !== JSON.stringify((job.metadata as any)?.[field])) (job.metadataOverrides as any)[field] = value;
  }
  job.metadataRevision = (job.metadataRevision || 0) + 1;
}
