import type { ChapterEntry, AudiobookMetadata } from './domain';
import { parseChapterTimestamp } from './chapters';
// Helper: Format seconds to HH:MM:SS.mmm
export function formatTimestamp(seconds: number): string {
  const safeSec = Math.max(0, seconds);
  const hrs = Math.floor(safeSec / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);
  const secs = safeSec % 60;
  const secsStr = secs.toFixed(3).padStart(6, '0');
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secsStr}`;
}

// Helper: Parse HH:MM:SS.mmm to milliseconds
export function parseTimestampToMs(tsStr: string): number {
  const match = tsStr.trim().match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid timestamp format: '${tsStr}'. Expected HH:MM:SS.mmm`);
  }
  const [, hrs, mins, secs, ms] = match;
  let totalMs = (parseInt(hrs, 10) * 3600 + parseInt(mins, 10) * 60 + parseInt(secs, 10)) * 1000;
  if (ms) {
    const cleanMs = (ms + "000").slice(0, 3);
    totalMs += parseInt(cleanMs, 10);
  }
  return totalMs;
}

// Helper: Escape string for FFMETADATA
function escapeFFMeta(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/=/g, '\\=')
    .replace(/;/g, '\\;')
    .replace(/#/g, '\\#')
    .replace(/\n/g, ' ');
}

// Helper: Generate FFMETADATA string
export function generateFFMetaContent(chapters: ChapterEntry[], totalDurationSeconds: number, meta?: AudiobookMetadata): string {
  const totalDurationMs = Math.round(totalDurationSeconds * 1000);
  let content = ";FFMETADATA1\n";
  if (meta) {
    if (meta.title) content += `title=${escapeFFMeta(meta.title)}\n`;
    if (meta.subtitle) content += `subtitle=${escapeFFMeta(meta.subtitle)}\n`;
    if (meta.author) content += `artist=${escapeFFMeta(meta.author)}\n`;
    // Standard Audiobookshelf & iTunes M4B standard: Narrator stored in Composer tag!
    if (meta.narrator) content += `composer=${escapeFFMeta(meta.narrator)}\n`;
    if (meta.series) {
      const albumStr = meta.seriesSequence ? `${meta.series}, Book ${meta.seriesSequence}` : meta.series;
      content += `album=${escapeFFMeta(albumStr)}\n`;
      content += `series=${escapeFFMeta(meta.series)}\n`;
      if (meta.seriesSequence) content += `series-part=${escapeFFMeta(meta.seriesSequence)}\n`;
    } else if (meta.title) {
      content += `album=${escapeFFMeta(meta.title)}\n`;
    }
    if (meta.genres && meta.genres.length > 0) {
      content += `genre=${escapeFFMeta(meta.genres.join(', '))}\n`;
    } else {
      content += `genre=Audiobook\n`;
    }
    if (meta.publishedYear) content += `date=${escapeFFMeta(meta.publishedYear)}\n`;
    if (meta.publisher) content += `publisher=${escapeFFMeta(meta.publisher)}\n`;
    if (meta.language) content += `language=${escapeFFMeta(meta.language)}\n`;
    if (meta.asin) content += `ASIN=${escapeFFMeta(meta.asin)}\n`;
    if (meta.isbn) content += `ISBN=${escapeFFMeta(meta.isbn)}\n`;
    if (meta.description) {
      content += `description=${escapeFFMeta(meta.description)}\n`;
      content += `comment=${escapeFFMeta(meta.description)}\n`;
    }
    if (meta.copyright) content += `copyright=${escapeFFMeta(meta.copyright)}\n`;
    content += `explicit=${meta.explicit ? '1' : '0'}\n`;
    content += `abridged=${meta.abridged ? '1' : '0'}\n`;
  } else {
    content += "genre=Audiobook\n";
  }

  for (let i = 0; i < chapters.length; i++) {
    const chap = chapters[i];
    const startMs = parseTimestampToMs(chap.start);
    const endMs = parseChapterTimestamp(chap.end) ?? (i + 1 < chapters.length ? parseTimestampToMs(chapters[i + 1].start) - 1 : totalDurationMs);
    content += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${startMs}\nEND=${endMs}\ntitle=${escapeFFMeta(chap.title)}\n`;
  }
  return content;
}
