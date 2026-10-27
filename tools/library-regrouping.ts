import { createHash } from 'node:crypto';
import type { AudiobookJob } from '../src/types';

// Only untouched scanner observations may be replaced by improved discovery.
// Work, edits, and explicit membership continue to own their original files.
export function isUntouchedDiscovery(job: AudiobookJob): boolean {
  const baseline = job.libraryScan?.detectedMetadata;
  if (!baseline || job.status !== 'draft' || job.importPending || job.importFinished || job.personalRating !== undefined ||
    (job.sourceMembership && job.sourceMembership !== 'automatic') || job.sourceOrderManual ||
    job.excludedSourceFiles?.length || job.explicitlyAddedSourceFiles?.length || job.sourceMembershipReview ||
    job.metadataDraft || Object.keys(job.metadataOverrides || {}).length || job.logicalBookId ||
    Object.keys(job.matchDecisions || {}).length || Object.keys(job.confirmedMatches || {}).length ||
    job.sourceKey || job.preparedAudioKey || job.transcription || job.transcriptWords?.length || job.transcriptSegments?.length ||
    job.chapters?.length || job.candidates?.length || job.mergedMp3 || job.outputM4b || job.exports?.length ||
    Object.keys(job.exportedFiles || {}).length || job.originalsArchive) return false;
  return Object.entries(job.metadata || {}).every(([field, value]) => field === 'cover' && job.libraryScan?.coverSignature
    ? createHash('sha256').update(JSON.stringify(value || null)).digest('hex') === job.libraryScan.coverSignature
    : JSON.stringify(value) === JSON.stringify((baseline as any)[field]));
}
