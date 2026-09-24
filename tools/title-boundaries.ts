import type { AlignedWord, ChapterCandidate } from '../src/types';
import { cleanChapterTitle } from '../src/utils/chapterTitles';
import { formatTimestampMs, parseChapterTimestamp } from '../src/utils/chapters';
import { pcmDataRange } from './audio-analysis';
import { analyzeMusicGaps, type MusicEvidence } from './music-transitions';

export const TITLE_DETECTOR_VERSION = 1;
const MIN_SPACING = 120;
const EDGE_MARGIN = 60;

export interface IsolatedTitle {
  start: number;
  end: number;
  wordIndex: number;
  wordEndIndex: number;
  title: string;
  gapStart: number;
  pauseAfter: number;
}
export interface TitleEvidence extends IsolatedTitle { acoustic: MusicEvidence }
export interface TitleDecision extends TitleEvidence {
  accepted: boolean;
  confidence: number;
  reason: string;
  supportingTitles: number;
}

function lexical(word: AlignedWord) {
  return /\p{L}/u.test(word.word) && word.endSeconds > word.startSeconds
    && !/[\[\]♪♫]/u.test(word.word)
    && (word.confidence === undefined || word.confidence >= 0.35);
}

// Deliberately conservative English noun-phrase filter. The title must actually
// be spoken: surrounding story text is never used to invent a chapter name.
const narrativeStarts = /^(?:i|you|he|she|it|we|they|this|that|these|those|there|here|then|now|so|yes|no|oh|well|please|perhaps|however|suddenly|meanwhile|finally|once|when|while|if|although|because|afterwards)\b/i;
const finiteVerbs = new Set(('am is are was were be been being have has had do does did can could will would shall should may might must '
  + 'said says say asked asks ask replied replies answered answers whispered whispers shouted shouts cried cries '
  + 'went goes came comes left leaves looked looks turned turns smiled smiles nodded nods shook shakes laughed laughs '
  + 'stood stands sat sits walked walks ran runs stopped stops began begins continued continues knew knows thought thinks '
  + 'told tells wanted wants felt feels heard hears saw sees took takes made makes found finds became becomes '
  + 'seemed seems watched watches waited waits returned returns entered enters followed follows '
  + 'rose rises fell falls moved moves opened opens closed closes reached reaches crossed crosses passed passes held holds kept keeps').split(' '));

function titleText(words: AlignedWord[]): string | undefined {
  if (words.length < 2 || words.length > 14 || !words.every(lexical)) return;
  const text = words.map(word => word.word.trim()).join(' ').replace(/\s+/gu, ' ').trim();
  const tokens = text.toLowerCase().match(/[\p{L}]+(?:['’][\p{L}]+)*/gu) || [];
  if (tokens.length < 2 || tokens.length > 14 || narrativeStarts.test(text)
    || /[!?"“”]/u.test(text) || /[.!?]\s+\p{L}/u.test(text)
    || tokens.some(token => finiteVerbs.has(token) || /['’](?:m|re|ve|ll|d|t)$/u.test(token))) return;
  // Credits, recording directions and the end announcement are not titles.
  if (/\b(?:copyright|narrated|narration|narrator|recorded|recording|abridged|unabridged|audiobook|audible|libri\s?vox|published|publisher|produced|production|end of|the end|thank you|thanks for|listening|music|silence|applause)\b/i.test(text)) return;
  return cleanChapterTitle(text.replace(/[.,;:]+$/u, ''));
}

// Only complete, short word-timed phrases bounded by long pauses qualify.
// Segment boundaries and punctuation alone never establish a title boundary.
export function findIsolatedTitles(words: AlignedWord[], duration: number): IsolatedTitle[] {
  if (!Number.isFinite(duration) || duration <= 0 || words.some((word, i) =>
    !Number.isFinite(word.startSeconds) || !Number.isFinite(word.endSeconds)
    || word.startSeconds < 0 || word.endSeconds < word.startSeconds
    || word.endSeconds > duration || (i > 0 && word.startSeconds < words[i - 1].startSeconds))) return [];
  const titles: IsolatedTitle[] = [];
  let coveredUntil = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i], gapStart = coveredUntil;
    coveredUntil = Math.max(coveredUntil, word.endSeconds);
    const gap = word.startSeconds - gapStart;
    if (i < 3 || gap < 8 || gap > 60 || word.startSeconds > duration - EDGE_MARGIN) continue;
    const before = words.slice(i - 3, i);
    if (!before.every(lexical) || gapStart - before[0].startSeconds > 6) continue;
    let phraseEnd = word.endSeconds;
    for (let j = i; j < Math.min(words.length - 3, i + 14); j++) {
      const current = words[j], next = words[j + 1];
      if (!lexical(current) || (j > i && current.startSeconds - phraseEnd > 1.2)) break;
      phraseEnd = Math.max(phraseEnd, current.endSeconds);
      if (phraseEnd - word.startSeconds > 8) break;
      const pauseAfter = next.startSeconds - phraseEnd;
      if (pauseAfter < 2.5) continue;
      // A phrase needs resumed narration, not an outro or a second title.
      const after = words.slice(j + 1, j + 4);
      if (pauseAfter <= 30 && after.every(lexical) && after[2].endSeconds - next.startSeconds <= 6) {
        const title = titleText(words.slice(i, j + 1));
        if (title) titles.push({ start: word.startSeconds, end: phraseEnd, wordIndex: i, wordEndIndex: j, title, gapStart, pauseAfter });
      }
      break;
    }
  }
  return titles;
}

const distinct = (a: IsolatedTitle, b: IsolatedTitle) => a.title.toLowerCase() !== b.title.toLowerCase()
  && Math.abs(a.start - b.start) >= MIN_SPACING;

export function scoreTitleBoundaries(features: TitleEvidence[], spokenStarts: number[], duration: number): TitleDecision[] {
  const plausible = (cue: TitleEvidence) => cue.acoustic.duration >= 5 && cue.acoustic.duration <= 60
    && cue.acoustic.tonalFraction >= 0.8 && cue.acoustic.variation >= 0.008;
  const internal = features.filter(cue => cue.start >= EDGE_MARGIN && cue.start <= duration - EDGE_MARGIN && plausible(cue));
  const recurring = internal.filter(cue => internal.some(other => distinct(cue, other)));
  const result: TitleDecision[] = [];
  for (const cue of features) {
    const supportingTitles = recurring.filter(other => distinct(cue, other)).length;
    let reason = 'Isolated spoken title with tonal transition and repeated title structure';
    if (!plausible(cue)) reason = 'Insufficient changing tonal audio before title';
    else if (cue.start > duration - EDGE_MARGIN) reason = 'Outro margin';
    else if (recurring.length < 2 || (cue.start >= EDGE_MARGIN && !supportingTitles)) reason = 'At least two independently spaced internal titles are required';
    else if (spokenStarts.some(start => Math.abs(start - cue.start) < MIN_SPACING)) reason = 'Existing spoken heading takes priority';
    else if (result.some(prior => prior.accepted && Math.abs(prior.start - cue.start) < MIN_SPACING)) reason = 'Too close to another title boundary';
    const accepted = reason === 'Isolated spoken title with tonal transition and repeated title structure';
    result.push({ ...cue, accepted, supportingTitles, reason, confidence: accepted ? Math.min(0.9, 0.74 + supportingTitles * 0.03) : 0 });
  }
  return result;
}

export async function detectTitleBoundaries(audio: string, words: AlignedWord[], spoken: ChapterCandidate[], options: {
  signal?: AbortSignal; log?: (message: string) => void;
} = {}): Promise<ChapterCandidate[]> {
  options.signal?.throwIfAborted();
  if (!words.length) return spoken;
  const duration = pcmDataRange(audio).length / 32000;
  const titles = findIsolatedTitles(words, duration);
  const internal = titles.filter(title => title.start >= EDGE_MARGIN);
  if (!internal.some(title => internal.some(other => distinct(title, other)))) {
    options.log?.('Named titles: no repeated isolated title structure; skipping acoustic analysis.');
    return spoken;
  }
  const acoustic = await analyzeMusicGaps(audio, titles.map(title => ({ start: title.gapStart, end: title.start, wordIndex: title.wordIndex })), options);
  options.signal?.throwIfAborted();
  const features = titles.map((title, index) => ({ ...title, acoustic: acoustic[index] }));
  const spokenStarts = spoken.map(candidate => (parseChapterTimestamp(candidate.candidate_start) ?? 0) / 1000);
  const decisions = scoreTitleBoundaries(features, spokenStarts, duration);
  for (const cue of decisions.slice(0, 30)) options.log?.(`Named title ${formatTimestampMs(cue.start * 1000)}: ${cue.accepted ? 'accepted for review' : 'rejected'}; ${cue.acoustic.duration.toFixed(1)}s tonal audio, ${cue.pauseAfter.toFixed(1)}s pause after, ${cue.supportingTitles} other title boundaries; ${cue.reason}.`);
  options.log?.(`Named titles: ${decisions.filter(cue => cue.accepted).length} accepted for review, ${decisions.filter(cue => !cue.accepted).length} rejected${decisions.length > 30 ? '; detail limited to 30 titles' : ''}.`);
  const candidates: ChapterCandidate[] = decisions.filter(cue => cue.accepted).map(cue => ({
    candidate_id: 0, candidate_start: formatTimestampMs(cue.start * 1000), candidate_end: formatTimestampMs(cue.end * 1000),
    proposed_title: cue.title, matched_text: words.slice(cue.wordIndex, cue.wordEndIndex + 1).map(word => word.word).join(' '),
    context_before: words.slice(Math.max(0, cue.wordIndex - 18), cue.wordIndex).map(word => word.word).join(' '),
    context_after: words.slice(cue.wordEndIndex + 1, cue.wordEndIndex + 27).map(word => word.word).join(' '),
    transcriptWordIndex: cue.wordIndex, headingType: 'chapter_like', confidence: String(cue.confidence), status: 'review',
    notes: `Spoken title without a chapter label; ${cue.acoustic.duration.toFixed(1)}s tonal transition, isolated title phrase, and ${cue.supportingTitles} other title boundaries. Heuristic evidence, not music probability. Title and timestamp come from saved words; listen to verify transcription.`,
    words: words.slice(Math.max(0, cue.wordIndex - 18), cue.wordEndIndex + 27),
  }));
  return [...spoken, ...candidates].sort((a, b) => (parseChapterTimestamp(a.candidate_start) ?? 0) - (parseChapterTimestamp(b.candidate_start) ?? 0))
    .map((candidate, index) => ({ ...candidate, candidate_id: index + 1 }));
}
