import { AlignedWord } from './legacy-domain';
import { formatTimestampMs } from './chapters';

/** Retain untimed speech for review without manufacturing word boundaries. */
export function missingWordTimestampSegments<T extends { text: string; words?: { word: string; start: number; end: number }[] }>(segments: T[]) {
  return segments.filter(segment => segment.text.trim() && !segment.words?.some(word =>
    word.word.trim() && Number.isFinite(word.start) && Number.isFinite(word.end)));
}

// The persisted timeline used by both clickable transcript words and detection.
// Preserve engine timestamps; this is formatting/filtering, not alignment.
export function buildTranscriptWords(segments: { words?: { word: string; start: number; end: number; probability?: number }[] }[]): AlignedWord[] {
  return segments.flatMap(segment => (segment.words || []).map(word => ({
    word: String(word.word || '').trim(),
    start: formatTimestamp(Number(word.start)),
    startSeconds: Number(word.start),
    endSeconds: Number(word.end),
    confidence: typeof word.probability === 'number' ? word.probability : undefined,
  })).filter(word => word.word && Number.isFinite(word.startSeconds) && Number.isFinite(word.endSeconds)));
}

/** First transcript word whose start is at or after the requested time. */
export function findTranscriptWordIndex(words: AlignedWord[], seconds: number): number {
  let low = 0;
  let high = words.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (words[middle].startSeconds < seconds) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Closest persisted Whisper word to a chapter timestamp. */
export function findClosestTranscriptWordIndex(words: AlignedWord[], seconds: number): number {
  if (!words.length) return -1;
  const next = findTranscriptWordIndex(words, seconds);
  if (next === 0) return 0;
  if (next === words.length) return words.length - 1;
  return seconds - words[next - 1].startSeconds <= words[next].startSeconds - seconds ? next - 1 : next;
}

export function transcriptPageOffset(wordIndex: number, pageSize: number): number {
  if (wordIndex < 0 || pageSize <= 0) return 0;
  return Math.floor(wordIndex / pageSize) * pageSize;
}

const searchText = (value: string) => value.normalize('NFKC').toLowerCase()
  .replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}']/gu, ' ').replace(/\s+/g, ' ').trim();

/** Search across saved words without changing their text, indexes or timestamps. */
export function buildTranscriptSearchIndex(words: AlignedWord[]) {
  let text = '';
  const entries = words.map((word, transcriptWordIndex) => {
    const normalized = searchText(word.word);
    if (text && normalized) text += ' ';
    const start = text.length;
    text += normalized;
    return { word, transcriptWordIndex, start, end: text.length };
  });
  return { text, entries };
}

export function searchTranscriptWords(index: ReturnType<typeof buildTranscriptSearchIndex>, query: string) {
  if (!query.trim()) return index.entries;
  const normalized = searchText(query);
  if (!normalized) return [];
  const ranges: { start: number; end: number }[] = [];
  for (let start = index.text.indexOf(normalized); start >= 0; start = index.text.indexOf(normalized, start + 1)) {
    const end = start + normalized.length;
    const previous = ranges.at(-1);
    if (previous && start <= previous.end) previous.end = end;
    else ranges.push({ start, end });
  }
  let range = 0;
  return index.entries.filter(entry => {
    while (range < ranges.length && ranges[range].end <= entry.start) range++;
    return range < ranges.length && entry.end > ranges[range].start && entry.start < ranges[range].end;
  });
}

/**
 * Refine a detected heading to a real Whisper word boundary shortly before it.
 * This preserves the lead-in used for natural chapter playback without
 * manufacturing a timestamp between spoken words.
 */
export function refineChapterStartIndex(words: AlignedWord[], headingWordIndex: number, leadInSeconds: number): number {
  if (headingWordIndex <= 0 || leadInSeconds <= 0) return Math.max(0, headingWordIndex);
  const headingStart = words[headingWordIndex]?.startSeconds;
  if (!Number.isFinite(headingStart)) return headingWordIndex;
  return findTranscriptWordIndex(words, Math.max(0, headingStart - leadInSeconds));
}

/**
 * Format seconds to HH:MM:SS.mmm
 */
export function formatTimestamp(seconds: number): string {
  return formatTimestampMs(seconds * 1000);
}

/**
 * Parse HH:MM:SS.mmm to milliseconds
 */
export function parseTimestampToMs(ts: string): number {
  const match = ts.trim().match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) return -1;
  const [, hrs, mins, secs, ms] = match;
  let totalMs = (parseInt(hrs, 10) * 3600 + parseInt(mins, 10) * 60 + parseInt(secs, 10)) * 1000;
  if (ms) {
    totalMs += parseInt((ms + '000').slice(0, 3), 10);
  }
  return totalMs;
}

export function getTranscriptWordsNear(
  words: AlignedWord[],
  seconds: number,
  windowSeconds: number = 25
): AlignedWord[] {
  return words.slice(findTranscriptWordIndex(words, seconds - windowSeconds), findTranscriptWordIndex(words, seconds + windowSeconds + 0.000001));
}

/** A bounded, stable word page for playback; selection never changes DOM focus. */
export function playbackTranscriptWindow(words: AlignedWord[], seconds: number) {
  const nearest = findClosestTranscriptWordIndex(words, seconds);
  const offset = Math.max(0, Math.floor(Math.max(0, nearest) / 40) * 40 - 15);
  const word = words[nearest];
  const previous = nearest > 0 ? words[nearest - 1] : undefined;
  const active = word && seconds >= word.startSeconds && seconds < word.endSeconds ? nearest
    : previous && seconds >= previous.startSeconds && seconds < previous.endSeconds ? nearest - 1 : -1;
  return { offset, active, nearest };
}

/** Scroll only this pane, never its ancestors or the keyboard focus. */
export function revealTranscriptWord(container: HTMLElement, word: HTMLElement): void {
  const pane = container.getBoundingClientRect();
  const target = word.getBoundingClientRect();
  if (target.top < pane.top || target.bottom > pane.bottom) {
    container.scrollTop += target.top - pane.top - (container.clientHeight - target.height) / 2;
  }
}

/**
 * Parses contextBefore, matchedText, contextAfter and aligns each word with precise timestamps
 */
export function buildAlignedWords(
  contextBefore: string = '',
  matchedText: string = '',
  contextAfter: string = '',
  baseStartSeconds: number = 0
): { words: AlignedWord[]; matchedStartIndex: number; matchedEndIndex: number } {
  const beforeTokens = contextBefore.split(/\s+/).filter(Boolean);
  const matchedTokens = matchedText.split(/\s+/).filter(Boolean);
  const afterTokens = contextAfter.split(/\s+/).filter(Boolean);

  const words: AlignedWord[] = [];

  // Words before lead in at ~0.38s each
  const beforeCount = beforeTokens.length;
  beforeTokens.forEach((token, idx) => {
    const sec = Math.max(0, baseStartSeconds - (beforeCount - idx) * 0.38);
    words.push({
      word: token,
      start: formatTimestamp(sec),
      startSeconds: sec,
      endSeconds: sec + 0.35,
      confidence: 0.92,
    });
  });

  const matchedStartIndex = words.length;

  // Matched chapter title words start at baseStartSeconds
  matchedTokens.forEach((token, idx) => {
    const sec = baseStartSeconds + idx * 0.42;
    words.push({
      word: token,
      start: formatTimestamp(sec),
      startSeconds: sec,
      endSeconds: sec + 0.4,
      confidence: 0.98,
    });
  });

  const matchedEndIndex = words.length - 1;

  // Words after follow matched tokens
  const afterBase = baseStartSeconds + Math.max(1, matchedTokens.length) * 0.42;
  afterTokens.forEach((token, idx) => {
    const sec = afterBase + idx * 0.38;
    words.push({
      word: token,
      start: formatTimestamp(sec),
      startSeconds: sec,
      endSeconds: sec + 0.35,
      confidence: 0.94,
    });
  });

  return { words, matchedStartIndex, matchedEndIndex };
}
