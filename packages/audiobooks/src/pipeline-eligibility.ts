import type { AudiobookJob } from './legacy-domain';
import type { RerunnablePipelineStep } from './domain';
export function canReviewChapters(job: AudiobookJob): boolean {
  if (!job.sourceKey) return false;
  if (job.status !== 'draft') return true;
  if (job.sourceFilesChanged || !job.chapters.length) return false;
  const step = (job.chapterSource || 'whisperx') === 'whisperx' ? 'detecting_chapters' : 'extracting_chapters';
  const result = job.pipelineSteps?.[step];
  return result?.status === 'current' && result.hasOutput === true;
}

export function canRerunStep(job: AudiobookJob, step: RerunnablePipelineStep): boolean {
  if (step === 'generating_waveform') return !!job.previewPath || (!!job.sourceKey && job.parts.length > 0);
  if (step === 'transcribing_whisper') return !!job.previewPath || (!!job.preparedAudioKey && job.parts.length > 0);
  if (step === 'detecting_chapters') return (job.chapterSource || 'whisperx') === 'whisperx' && !!job.transcriptSegments?.length;
  if (step === 'extracting_chapters') return ['existing_files', 'grouped_files', 'existing_chapters'].includes(job.chapterSource || '') && !!job.mergedMp3 && job.parts.length > 0;
  if (step === 'metadata_processing') return !!job.metadata && job.chapters.length > 0;
  return false;
}

export function hasManualChapterWork(job: Pick<AudiobookJob, 'chapters' | 'candidates' | 'chapterSource'>): boolean {
  if (!job.chapters.length) return false;
  if (job.chapters.some(chapter => chapter.startManuallyEdited || chapter.endManuallyEdited || chapter.titleManuallyEdited || chapter.manuallyInserted || chapter.isMissing)) return true;
  if (job.chapterSource === 'existing_files' || job.chapterSource === 'grouped_files') return false;
  const generated = job.chapters.filter(chapter => !(chapter.id === 'opening' && chapter.start === '00:00:00.000' && (chapter.title === 'Opening' || chapter.title === 'Prologue')));
  return generated.length !== job.candidates.length || generated.some(chapter => !job.candidates.some(candidate =>
    chapter.start === candidate.candidate_start && chapter.title === candidate.proposed_title));
}
