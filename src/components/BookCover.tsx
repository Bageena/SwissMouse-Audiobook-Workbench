import { useState } from 'react';
import { BookOpen } from 'lucide-react';

export function BookCover({ url, title }: { url?: string | null; title: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <div className="book-cover flex aspect-square w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-100 sm:w-20">
    {url && failedUrl !== url
      ? <img key={url} src={url} alt={`Cover of ${title}`} className="h-full w-full object-contain" onError={() => setFailedUrl(url)} />
      : <BookOpen aria-label="No cover artwork" className="h-7 w-7 text-amber-700" strokeWidth={1.4} />}
  </div>;
}
