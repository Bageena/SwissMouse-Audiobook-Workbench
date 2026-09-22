import type { AudiobookJob, PipelineResultStep, PipelineStepState, RerunnablePipelineStep } from '../types';

export const downstreamSteps: Record<RerunnablePipelineStep, RerunnablePipelineStep[]> = {
  generating_waveform: [],
  transcribing_whisper: ['detecting_chapters'],
  detecting_chapters: [],
  extracting_chapters: [],
  metadata_processing: [],
};

export const staleResultsAfter: Record<RerunnablePipelineStep, PipelineResultStep[]> = {
  generating_waveform: [],
  transcribing_whisper: ['chapter_detection', 'chapter_review', 'export', 'validation'],
  detecting_chapters: ['chapter_review', 'export', 'validation'],
  extracting_chapters: ['chapter_review', 'export', 'validation'],
  metadata_processing: ['export', 'validation'],
};

export function markDependentResultsStale(current: PipelineResultStep[] | undefined, step: RerunnablePipelineStep): PipelineResultStep[] {
  return [...new Set([...(current || []), ...staleResultsAfter[step]])];
}

export function canRerunStep(job: AudiobookJob, step: RerunnablePipelineStep): boolean {
  if (step === 'generating_waveform') return !!job.previewPath;
  if (step === 'transcribing_whisper') return job.chapterSource !== 'existing_files' && !!job.previewPath;
  if (step === 'detecting_chapters') return job.chapterSource !== 'existing_files' && !!job.transcriptSegments?.length;
  if (step === 'extracting_chapters') return job.chapterSource === 'existing_files' && !!job.mergedMp3 && job.parts.length > 0;
  if (step === 'metadata_processing') return !!job.metadata && job.chapters.length > 0;
  return false;
}

export function hasManualChapterWork(job: Pick<AudiobookJob, 'chapters' | 'candidates' | 'chapterSource'>): boolean {
  if (!job.chapters.length) return false;
  if (job.chapters.some(chapter => chapter.startManuallyEdited || chapter.endManuallyEdited || chapter.titleManuallyEdited || chapter.manuallyInserted || chapter.isMissing)) return true;
  if (job.chapterSource === 'existing_files') return false;
  const generated = job.chapters.filter(chapter => !(chapter.id === 'opening' && chapter.start === '00:00:00.000' && chapter.title === 'Opening'));
  return generated.length !== job.candidates.length || generated.some(chapter => !job.candidates.some(candidate =>
    chapter.start === candidate.candidate_start && chapter.title === candidate.proposed_title));
}

export function beginStepRerun(previous: PipelineStepState | undefined): PipelineStepState {
  return { status: 'running', hasOutput: previous?.hasOutput ?? false, updatedAt: previous?.updatedAt };
}

export function failStepRerun(previous: PipelineStepState | undefined, error: string): PipelineStepState {
  return { status: 'failed', hasOutput: previous?.hasOutput ?? false, updatedAt: previous?.updatedAt, error };
}

export function completeStepRerun(
  states: AudiobookJob['pipelineSteps'],
  step: RerunnablePipelineStep,
  updatedAt: string,
): AudiobookJob['pipelineSteps'] {
  const next = { ...states, [step]: { status: 'current', hasOutput: true, updatedAt } as PipelineStepState };
  for (const downstream of downstreamSteps[step]) {
    const previous = next[downstream];
    if (previous?.hasOutput) next[downstream] = { ...previous, status: 'stale', error: undefined };
  }
  return next;
}
