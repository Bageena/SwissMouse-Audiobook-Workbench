import React, { useState } from 'react';
import type { ChapterCandidate, ChapterEntry } from '../types';

export function ChapterSuggestions({ candidates, chapters, playingId, onPlay, onAccept }: {
  candidates: ChapterCandidate[]; chapters: ChapterEntry[]; playingId?: number;
  onPlay: (candidate: ChapterCandidate) => void; onAccept: (candidate: ChapterCandidate) => void;
}): React.ReactElement | null {
  const [dismissed, setDismissed] = useState<number[]>([]);
  const pending = candidates.filter(candidate => candidate.suggestionOnly && candidate.status !== 'rejected'
    && !chapters.some(chapter => chapter.start === candidate.candidate_start));
  if (!candidates.some(candidate => candidate.suggestionOnly)) return null;
  return <details className="rounded-lg border border-amber-200 bg-amber-50/40 p-3" open={pending.length > 0 ? undefined : false}>
    <summary className="cursor-pointer font-semibold text-sm">Experimental suggestions ({pending.length})</summary>
    <p className="text-xs text-stone-600 my-2">Suggestions are excluded from export until you accept them and save the chapter list. Listen plays a short clip around the proposed start.</p>
    <div className="max-h-80 overflow-y-auto space-y-2" aria-label="Experimental chapter suggestions">
      {pending.filter(candidate => !dismissed.includes(candidate.candidate_id)).map(candidate => <article key={candidate.candidate_id} className="rounded border border-stone-200 bg-white p-3 text-sm">
        <p className="font-semibold">{candidate.proposed_title} <span className="font-mono text-xs">{candidate.candidate_start}</span></p>
        {candidate.parentChapterStart && <p className="text-xs text-stone-600">Within chapter at {candidate.parentChapterStart}</p>}
        <p className="text-xs text-stone-600 my-1">{candidate.evidence?.join(' · ') || candidate.notes}</p>
        {candidate.matched_text && <p className="text-xs italic my-1">“{candidate.matched_text}”</p>}
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" onClick={() => onPlay(candidate)} aria-label={`${playingId === candidate.candidate_id ? 'Pause' : 'Listen to'} suggestion ${candidate.proposed_title} at ${candidate.candidate_start}`} className="rounded border px-2 py-1">{playingId === candidate.candidate_id ? 'Pause' : 'Listen'}</button>
          <button type="button" onClick={() => onAccept(candidate)} aria-label={`Accept suggestion ${candidate.proposed_title} at ${candidate.candidate_start}`} className="rounded border px-2 py-1">Accept</button>
          <button type="button" onClick={() => setDismissed(previous => [...previous, candidate.candidate_id])} title="Hide until you reopen this book or show hidden suggestions" className="rounded border px-2 py-1">Hide</button>
        </div>
      </article>)}
    </div>
    {dismissed.length > 0 && <button type="button" className="text-xs underline mt-2" onClick={() => setDismissed([])}>Show hidden suggestions</button>}
    {!pending.length && <p className="text-xs mt-2">All suggestions are in the chapter list.</p>}
  </details>;
}
