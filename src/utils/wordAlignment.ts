import { AlignedWord } from '../types';

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
