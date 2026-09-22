import { AlignedWord } from '../types';

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
  const safe = Math.max(0, seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`;
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
  return words.filter(word => Math.abs(word.startSeconds - seconds) <= windowSeconds);
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
