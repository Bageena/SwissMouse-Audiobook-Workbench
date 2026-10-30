import type { WorkflowStep } from './workspace-contributions';

/** Retains existing session keys; no durable data migration is involved. */
export function rememberedAudiobookStep(book: { id: string; status: string }, read: (key: string) => unknown): WorkflowStep {
  const stored = read(`swissmouse-book-step-${book.id}`);
  if (typeof stored === 'number' && Number.isInteger(stored) && stored >= 1 && stored <= 5) return stored as WorkflowStep;
  if (book.status === 'transcribed' || book.status === 'merged') return 2;
  if (book.status === 'metadata_ready') return 3;
  if (book.status === 'built') return 4;
  if (book.status === 'validated') return 5;
  return 1;
}
