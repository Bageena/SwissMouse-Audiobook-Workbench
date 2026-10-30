import type { AudiobookMetadata, ChapterEntry, PipelineResultStep, PipelineStepState, RerunnablePipelineStep } from './domain';
import type { MetadataRecord } from './metadata-state';
import { recordMetadataEdit } from './metadata-state';
import { cleanMemberships } from './memberships';
import { generateFFMetaContent } from './ffmetadata';
import { completeStepRerun, markDependentResultsStale } from './pipeline-state';

/** Only fields interpreted by this command slice; not a new durable schema. */
export interface EditableProject extends MetadataRecord {
  id: string; name: string; author?: string; narrator?: string;
  importPending?: boolean; importInspected?: boolean;
  metadataDraft?: AudiobookMetadata; metadataUpdatedAt?: string;
  status: 'draft' | 'merged' | 'transcribed' | 'metadata_ready' | 'built' | 'validated';
  chapters: ChapterEntry[]; totalDurationSeconds: number; ffmetaContent?: string;
  staleSteps?: PipelineResultStep[];
  pipelineSteps?: Partial<Record<RerunnablePipelineStep, PipelineStepState>>;
  logs: { timestamp: string; level: 'INFO' | 'WARNING' | 'ERROR'; message: string }[];
  libraryScan?: MetadataRecord['libraryScan'] & { warning?: string };
}

export function applySavedMetadata(job: EditableProject, metadata: AudiobookMetadata) {
  const seriesAddedAt = metadata.series?.trim() !== job.metadata?.series?.trim() ? new Date().toISOString() : job.metadata?.seriesAddedAt || metadata.seriesAddedAt;
  recordMetadataEdit(job, metadata);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  job.metadata = {
    ...metadata,
    seriesAddedAt,
    title: metadata.title.trim(),
    author: metadata.author?.trim() || '',
    narrator: metadata.narrator?.trim() || '',
    genres: Array.isArray(metadata.genres) ? metadata.genres : ['Audiobook'],
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    ...(metadata.collections !== undefined ? { collections:cleanMemberships(metadata.collections) } : {}),
    ...(metadata.additionalSeries !== undefined ? { additionalSeries:cleanMemberships(metadata.additionalSeries) } : {}),
  };
  job.metadataDraft = undefined;
  job.metadataUpdatedAt = new Date().toISOString();
  if (job.libraryScan) job.libraryScan.warning = job.metadata.author ? undefined : 'Metadata incomplete: author is missing';

  // Synchronize top-level fields for convenience
  job.name = job.metadata.title;
  job.author = job.metadata.author;
  job.narrator = job.metadata.narrator;

  // Re-generate FFmetadata with all updated tags
  job.ffmetaContent = generateFFMetaContent(job.chapters, job.totalDurationSeconds, job.metadata);
  job.pipelineSteps = completeStepRerun(job.pipelineSteps, 'metadata_processing', now);
  job.staleSteps = markDependentResultsStale(job.staleSteps, 'metadata_processing');

  if (job.status === 'transcribed') {
    job.status = 'metadata_ready';
  }

  job.logs.push({
    timestamp: now,
    level: 'INFO',
    message: `Updated audiobook metadata: "${job.metadata.title}" by ${job.metadata.author || 'Unknown'}. Narrator mapped to Composer tag: "${job.metadata.narrator || 'None'}". Cover: ${job.metadata.cover ? `${job.metadata.cover.source} (${job.metadata.cover.filename || 'URL'})` : 'None'}.`,
  });
}
