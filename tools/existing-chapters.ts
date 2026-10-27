import fs from 'node:fs';
import path from 'node:path';
import type { ChapterEntry } from '../src/types';
import { formatTimestampMs } from '../src/utils/chapters';
import { parseTimestampToMs } from '../src/utils/wordAlignment';
import { parseChapterFile, CHAPTER_FILE_EXTENSIONS } from './chapter-file';

type Source = { file: string; durationSeconds: number; chapters: ChapterEntry[] };
const key = (file: string) => path.resolve(file).toLowerCase();

/** Embedded markers belong to their audio. Sidecars require exact ownership. */
export function existingChapterList(sources: Source[], extensions: Iterable<string>): { chapters: ChapterEntry[]; source?: string; sidecar?: string } {
  const audioExtensions = new Set([...extensions].map(extension => extension.replace(/^\./, '').toLowerCase()));
  const total = sources.reduce((sum, source) => sum + source.durationSeconds, 0);
  const checked = (chapters: ChapterEntry[]) => {
    let previous = -1;
    for (const chapter of chapters) {
      const start = parseTimestampToMs(chapter.start);
      if (start <= previous || start >= total * 1000 || start < 0) throw new Error('Existing chapter timestamps do not match this book.');
      previous = start;
    }
    return chapters;
  };
  if (sources.length && sources.every(source => source.chapters.length)) {
    let offset = 0;
    const chapters = sources.flatMap((source, sourceIndex) => {
      const result = source.chapters.map((chapter, index) => ({ ...chapter, id: `embedded-${sourceIndex}-${index}`,
        start: formatTimestampMs(offset + parseTimestampToMs(chapter.start)),
        end: chapter.end ? formatTimestampMs(offset + parseTimestampToMs(chapter.end)) : undefined }));
      offset += Math.round(source.durationSeconds * 1000); return result;
    });
    return { chapters: checked(chapters), source: 'Embedded chapters' };
  }
  const files = new Set(sources.map(source => key(source.file)));
  const matches: { chapters: ChapterEntry[]; source: string; sidecar: string }[] = [];
  for (const directory of new Set(sources.map(source => path.dirname(source.file)))) {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile());
    const audio = entries.filter(entry => audioExtensions.has(path.extname(entry.name).slice(1).toLowerCase()));
    const exclusive = audio.length > 0 && audio.every(entry => files.has(key(path.join(directory, entry.name))));
    for (const entry of entries.filter(entry => CHAPTER_FILE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase()))) {
      const sidecar = path.join(directory, entry.name);
      if (fs.statSync(sidecar).size > 1024 * 1024) continue;
      const base = entry.name.slice(0, -path.extname(entry.name).length).toLowerCase();
      const exactName = sources.some(source => path.dirname(source.file) === directory &&
        [path.basename(source.file), path.parse(source.file).name].some(name => name.toLowerCase() === base));
      if (!exclusive && !exactName) continue;
      // Generic text, XML and VTT can be subtitles or notes; require a chapter name or an explicit import.
      if (['.txt','.xml','.vtt'].includes(path.extname(entry.name).toLowerCase()) && !/chapters?/i.test(base) && !exactName) continue;
      try {
        const parsed = parseChapterFile(entry.name, fs.readFileSync(sidecar, 'utf8'), sources, directory);
        matches.push({ chapters: checked(parsed.chapters), source: `${parsed.kind === 'tracks' ? 'Playlist track boundaries' : 'Chapter sidecar'}: ${entry.name}`, sidecar });
      } catch { /* Ambiguous or malformed sidecars never become chapter markers. */ }
    }
  }
  return matches.length === 1 ? matches[0] : { chapters: [] };
}
