import type { ChapterCandidate } from './legacy-domain';
import type { ChapterEntry } from './domain';

/** Experimental evidence stays out of reset, save and export until accepted. */
export function candidateChapter(candidate: ChapterCandidate, id: string): ChapterEntry {
  return {
    id, start: candidate.candidate_start, title: candidate.proposed_title,
    notes: candidate.notes, headingType: candidate.headingType, chapterNumber: candidate.chapterNumber,
    recovered: candidate.recovered, transcriptWordIndex: candidate.transcriptWordIndex,
    parentChapterStart: candidate.parentChapterStart, timingSource: candidate.timingSource,
  };
}

export function initialDetectedChapters(candidates: ChapterCandidate[]): ChapterEntry[] {
  const chapters = candidates.filter(candidate => !candidate.suggestionOnly && candidate.status !== 'rejected')
    .map((candidate, index) => candidateChapter(candidate, `chap-${index + 1}`));
  if (!chapters.length || chapters[0].start !== '00:00:00.000') {
    chapters.unshift({ id: 'opening', start: '00:00:00.000', title: 'Prologue' });
  }
  return chapters;
}
