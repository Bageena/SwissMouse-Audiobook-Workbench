import { formatTimestampMs, parseChapterTimestamp } from './chapters';

type ExportChapter = { start: string; end?: string; title: string; isMissing?: boolean };

/** Source ranges and the corresponding compact output timeline. Source times
 * stay in the editor. The automatic 1 ms chapter-metadata separator is not a cut. */
export function planChapterExport(chapters: ExportChapter[], durationSeconds: number) {
  const durationMs = Math.round(durationSeconds * 1000);
  if (!chapters.length || !Number.isFinite(durationMs) || durationMs <= 0) throw new Error('No valid chapter timeline to export');
  const ranges: { start: number; end: number }[] = [];
  let elapsed = 0;
  const outputChapters = chapters.map((chapter, index) => {
    const start = parseChapterTimestamp(chapter.start);
    const next = index + 1 < chapters.length ? parseChapterTimestamp(chapters[index + 1].start) : durationMs;
    const end = chapter.end ? parseChapterTimestamp(chapter.end) : next;
    if (chapter.isMissing || start === null || next === null || end === null || start < 0 || end <= start || end > next || end > durationMs) {
      throw new Error(`Invalid or overlapping range for ${chapter.title}`);
    }
    const rangeEnd = next - end <= 1 ? next : end;
    const previous = ranges[ranges.length - 1];
    if (previous && start < previous.end) throw new Error(`Overlapping range for ${chapter.title}`);
    if (previous && previous.end === start) previous.end = rangeEnd;
    else ranges.push({ start, end: rangeEnd });
    const outputStart = elapsed;
    elapsed += rangeEnd - start;
    return { ...chapter, start: formatTimestampMs(outputStart), end: formatTimestampMs(index + 1 < chapters.length ? elapsed - 1 : elapsed) };
  });
  const trimmed = ranges.length !== 1 || ranges[0].start !== 0 || ranges[0].end !== durationMs;
  return {
    ranges,
    chapters: trimmed ? outputChapters : chapters,
    durationSeconds: elapsed / 1000,
    removedSeconds: (durationMs - elapsed) / 1000,
    trimmed,
  };
}
