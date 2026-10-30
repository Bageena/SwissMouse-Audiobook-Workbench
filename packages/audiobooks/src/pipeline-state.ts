import type { PipelineResultStep, PipelineStepState, RerunnablePipelineStep } from './domain';
export type PipelineStates = Partial<Record<RerunnablePipelineStep, PipelineStepState>> | undefined;
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

export function beginStepRerun(previous: PipelineStepState | undefined): PipelineStepState {
  return { status: 'running', hasOutput: previous?.hasOutput ?? false, updatedAt: previous?.updatedAt };
}

export function failStepRerun(previous: PipelineStepState | undefined, error: string): PipelineStepState {
  return { status: 'failed', hasOutput: previous?.hasOutput ?? false, updatedAt: previous?.updatedAt, error };
}

export function completeStepRerun(
  states: PipelineStates,
  step: RerunnablePipelineStep,
  updatedAt: string,
): PipelineStates {
  const next = { ...states, [step]: { status: 'current', hasOutput: true, updatedAt } as PipelineStepState };
  for (const downstream of downstreamSteps[step]) {
    const previous = next[downstream];
    if (previous?.hasOutput) next[downstream] = { ...previous, status: 'stale', error: undefined };
  }
  return next;
}
