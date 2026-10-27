
import type { AudiobookJob } from '../types';
import { BookCover } from './BookCover';
import { BookInformation } from './BookInformation';
import { PersonalRating } from './PersonalRating';
import { QuickPlayer } from './QuickPlayer';

export interface BookSelectorProps {
  currentJob: AudiobookJob;
  onRatingChange?: (bookId: string, rating: number | null) => Promise<void>;
  playRequest?: number;
  inShelf?: boolean;
}

export function BookSelector({ currentJob, onRatingChange, playRequest, inShelf = false }: BookSelectorProps) {
  const title = (typeof currentJob.metadata?.title === 'string' && currentJob.metadata.title.trim()) || currentJob.name;
  return <section aria-label="Current book" className="book-selector min-w-0 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
    <div className="book-selector-content">
    <div className="flex min-w-0 items-start gap-3">
      <BookCover key={currentJob.id} url={currentJob.metadata?.cover?.url} title={title} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <BookInformation metadata={currentJob.metadata} fallbackTitle={currentJob.name} />
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
          <PersonalRating bookId={currentJob.id} value={currentJob.personalRating ?? null} onChange={onRatingChange} starsOnly />
        </div>
      </div>
    </div>
    <QuickPlayer key={currentJob.id} jobId={currentJob.id} playRequest={playRequest} listLabel={inShelf ? 'Chapter List' : 'Playlist'} />
    </div>
  </section>;
}
