import type { AudiobookMetadata, ChapterEntry } from '../types';
import { alphabetical } from './metadataQuickAdd';
import { metadataPeople } from './metadataPeople';
const seconds = (timestamp: string) => {
  const match = /^(\d+):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(timestamp);
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number((match[4] || '').padEnd(3, '0')) / 1000;
};

// Audiobookshelf's metadata.json is a top-level book metadata sidecar.
export function audiobookshelfMetadata(metadata: AudiobookMetadata, chapters: ChapterEntry[] = []) {
  return {
    tags: alphabetical(metadata.tags || []),
    ...(chapters.length ? { chapters: chapters.flatMap((chapter, id) => {
      const start = seconds(chapter.start);
      const end = seconds(chapter.end || '');
      return Number.isFinite(start) && Number.isFinite(end) && end > start
        ? [{ id, start, end, title: chapter.title }]
        : [];
    }) } : {}),
    title: metadata.title,
    subtitle: metadata.subtitle || null,
    authors: metadataPeople(metadata, 'author'),
    narrators: metadataPeople(metadata, 'narrator'),
    series: metadata.series?.trim() ? [`${metadata.series.trim()}${metadata.seriesSequence?.trim() ? ` #${metadata.seriesSequence.trim()}` : ''}`] : [],
    genres: metadata.genres.filter(Boolean),
    publishedYear: metadata.publishedYear || null,
    publishedDate: metadata.releaseDate || null,
    publisher: metadata.publisher || null,
    description: metadata.description || null,
    isbn: metadata.isbn || null,
    asin: metadata.asin || null,
    language: metadata.language || null,
    explicit: metadata.explicit,
    abridged: metadata.abridged,
  };
}
