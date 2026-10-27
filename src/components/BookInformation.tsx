
import type { AudiobookMetadata } from '../types';

export function BookInformation({ metadata, fallbackTitle }: { metadata?: AudiobookMetadata; fallbackTitle: string }) {
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  const names = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean).join(', ') : '';
  const author = names(metadata?.authors) || text(metadata?.author);
  const narrator = names(metadata?.narrators) || text(metadata?.narrator);
  const year = text(metadata?.publishedYear);
  return <div className="book-information min-w-0">
    <p className="break-words text-sm font-semibold leading-snug text-stone-900">{text(metadata?.title) || fallbackTitle}</p>
    {(author || narrator) && <p className="mt-0.5 break-words text-xs leading-relaxed text-stone-600">
      {author && <span title="Author">{author}</span>}
      {author && narrator && <span className="mx-1.5 text-stone-400" aria-hidden="true">|</span>}
      {narrator && <span title="Narrator">{narrator}</span>}
    </p>}
    {year && <p className="mt-0.5 text-[11px] text-stone-500">{year}</p>}
  </div>;
}
