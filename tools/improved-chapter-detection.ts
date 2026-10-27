import type { AlignedWord, AudioPart, ChapterCandidate, ChapterEntry } from '../src/types';
import { formatTimestampMs, parseChapterTimestamp } from '../src/utils/chapters';
import { parseHeadingNumber } from './chapter-detection';
import { titleText } from './title-boundaries';

export const IMPROVED_DETECTOR_VERSION = 1;
const seconds = (value: string) => (parseChapterTimestamp(value) ?? -1000) / 1000;
const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export interface SourceBoundary { start: number; title: string; origin: string; }
export interface HeadingPhrase {
  first: number; last: number; start: number; end: number; before: number; after: number;
  number?: number; title?: string; parent?: string;
}

export function sourceBoundaries(existing: ChapterEntry[], parts: AudioPart[], duration: number): SourceBoundary[] {
  const result = existing.flatMap(chapter => {
    const start = seconds(chapter.start);
    return start >= 0 && start < duration ? [{ start, title: chapter.title, origin: 'Embedded chapter or matched chapter file' }] : [];
  });
  let offset = 0;
  for (const part of parts) {
    const filename = (part.sourceRelativePath || part.name).split(/[\\/]/).at(-1)!.replace(/\.[^.]+$/, '');
    // Generic disc/track filenames cannot establish chapter structure.
    if (/^(?:chapter|section|part|book)\s+(?:\d+|[ivxlcdm]+)\b/i.test(filename)
      || /^\d+[\s._-]+[\p{L}]/u.test(filename) && !/\b(?:track|disc|cd|audio)\b/i.test(filename)) {
      result.push({ start: offset, title: filename.replace(/[_]+/g, ' '), origin: 'Named source file' });
    }
    if (!(part.durationSeconds > 0)) break; // Never invent subsequent offsets.
    offset += part.durationSeconds;
  }
  return result.filter(boundary => boundary.start < duration);
}

export function isolatedHeadingPhrases(words: AlignedWord[], spoken: ChapterCandidate[], duration: number): HeadingPhrase[] {
  if (!Number.isFinite(duration) || words.some((word, i) => !Number.isFinite(word.startSeconds)
    || !Number.isFinite(word.endSeconds) || word.startSeconds < 0 || word.endSeconds < word.startSeconds
    || word.endSeconds > duration || i > 0 && word.startSeconds < words[i - 1].startSeconds)) return [];
  const anchors = spoken.filter(candidate => candidate.headingType === 'numbered_chapter' || candidate.headingType === 'section_divider')
    .map(candidate => ({ start: seconds(candidate.candidate_start), timestamp: candidate.candidate_start })).sort((a, b) => a.start - b.start);
  const result: HeadingPhrase[] = [];
  let covered = 0;
  for (let i = 0; i < words.length - 3; i++) {
    const word = words[i], before = word.startSeconds - covered;
    covered = Math.max(covered, word.endSeconds);
    if (i < 3 || before < 1.2 || before > 60 || word.startSeconds > duration - 15) continue;
    if (words.slice(i - 3, i).some(w => (w.confidence ?? 1) < .35) || word.startSeconds - words[i - 3].endSeconds > before + 8) continue;
    for (let j = i; j < Math.min(i + 12, words.length - 3); j++) {
      const last = words[j];
      if (last.endSeconds - word.startSeconds > 8 || (last.confidence ?? 1) < .35
        || /[\[\]♪♫]/u.test(last.word) || j > i && last.startSeconds - words[j - 1].endSeconds > .8) break;
      const after = words[j + 1].startSeconds - last.endSeconds;
      if (after < .65) continue;
      const phrase = words.slice(i, j + 1), text = phrase.map(w => w.word).join(' ');
      const number = parseHeadingNumber(text);
      const title = before >= 2 && after >= 1.2 && parseHeadingNumber(phrase[0].word) === undefined ? titleText(phrase) : undefined;
      if (after <= 30 && (number !== undefined || title) && words[j + 3].endSeconds - words[j + 1].startSeconds <= 8) {
        result.push({ first: i, last: j, start: word.startSeconds, end: last.endSeconds, before, after, number, title,
          parent: anchors.filter(anchor => anchor.start < word.startSeconds).at(-1)?.timestamp });
      }
      break;
    }
  }
  return result;
}

export function phraseCandidate(phrase: HeadingPhrase, words: AlignedWord[], evidence: string[]): ChapterCandidate {
  const title = phrase.number === undefined ? phrase.title! : `Section ${phrase.number}`;
  return {
    candidate_id: 0, candidate_start: formatTimestampMs(phrase.start * 1000), candidate_end: formatTimestampMs(phrase.end * 1000),
    proposed_title: title, matched_text: words.slice(phrase.first, phrase.last + 1).map(w => w.word).join(' '),
    context_before: words.slice(Math.max(0, phrase.first - 12), phrase.first).map(w => w.word).join(' '),
    context_after: words.slice(phrase.last + 1, phrase.last + 19).map(w => w.word).join(' '),
    headingType: phrase.number === undefined ? 'chapter_like' : 'numbered_section', chapterNumber: phrase.number,
    parentChapterStart: phrase.parent, transcriptWordIndex: phrase.first, timingSource: 'transcript',
    suggestionOnly: true, status: 'review', confidence: '', evidence,
    notes: evidence.join('; ') + '. Listen and accept to add to the chapter list.',
    words: words.slice(Math.max(0, phrase.first - 12), phrase.last + 19),
  };
}

export function structuralSuggestions(words: AlignedWord[], spoken: ChapterCandidate[], duration: number, sources: SourceBoundary[] = []): ChapterCandidate[] {
  const phrases = isolatedHeadingPhrases(words, spoken, duration);
  const result: ChapterCandidate[] = [];
  for (const phrase of phrases) {
    if (spoken.some(candidate => Math.abs(seconds(candidate.candidate_start) - phrase.start) < 3)) continue;
    const matchingSource = sources.find(source => Math.abs(source.start - phrase.start) <= 12
      && (key(source.title) === key(phrase.title || '') || parseHeadingNumber(source.title.replace(/^(chapter|section|part|book)\s+/i, '')) === phrase.number && phrase.number !== undefined));
    let evidence: string[] = [];
    if (phrase.number !== undefined) {
      const sequence = phrases.filter(other => other.number !== undefined && other.parent === phrase.parent).sort((a, b) => a.start - b.start);
      const index = sequence.indexOf(phrase);
      // An actual consecutive triple is stronger than unrelated occurrences of numbers.
      const triple = [index - 2, index - 1, index].some(first => first >= 0 && first + 2 < sequence.length
        && sequence.slice(first, first + 3).every((item, offset, group) => !offset
          || item.number === group[offset - 1].number! + 1 && item.start - group[offset - 1].start >= 30));
      if (triple) evidence.push('Isolated spoken number in a consecutive section sequence');
    } else {
      const peers = phrases.filter(other => other.title && key(other.title) !== key(phrase.title!) && Math.abs(other.start - phrase.start) >= 60
        && other.before >= 2 && other.after >= 1.2);
      if (peers.some((peer, index) => peers.slice(index + 1).some(other => key(peer.title!) !== key(other.title!)
        && Math.abs(peer.start - other.start) >= 60))) evidence.push('Repeated isolated spoken-title pattern (at least three distinct titles)');
    }
    if (matchingSource) evidence.push(`Matches ${matchingSource.origin.toLowerCase()}`);
    if (!evidence.length) continue;
    evidence.push(`Pauses ${phrase.before.toFixed(1)}s before and ${phrase.after.toFixed(1)}s after`);
    if (phrase.parent && phrase.number !== undefined) evidence.push(`Section numbering within chapter at ${phrase.parent}`);
    result.push(phraseCandidate(phrase, words, evidence));
  }
  return result;
}

export function reconcileSources(candidates: ChapterCandidate[], sources: SourceBoundary[]): ChapterCandidate[] {
  const result = candidates.map(candidate => ({ ...candidate, evidence: [...candidate.evidence || []] }));
  for (const source of sources) {
    const nearby = result.find(candidate => Math.abs(seconds(candidate.candidate_start) - source.start) <= 3);
    if (nearby) {
      nearby.evidence.push(`${source.origin} agrees within 3 seconds: ${source.title}`);
      nearby.notes += ` Source corroboration: ${source.title}.`;
    } else if (!result.some(candidate => candidate.timingSource === 'source' && Math.abs(seconds(candidate.candidate_start) - source.start) < 1)) {
      result.push({ candidate_id: 0, candidate_start: formatTimestampMs(source.start * 1000), candidate_end: formatTimestampMs(source.start * 1000),
        proposed_title: source.title || 'Source chapter', matched_text: '', context_before: '', context_after: '',
        headingType: 'chapter_like', timingSource: 'source', suggestionOnly: true, status: 'review', confidence: '',
        evidence: [source.origin, 'No spoken heading within 3 seconds; review the source boundary'],
        notes: `${source.origin}: no spoken heading within 3 seconds. Source timestamps may differ from narration; listen before accepting.` });
    }
  }
  return result;
}

export function mergeDetectionSuggestions(spoken: ChapterCandidate[], suggestions: ChapterCandidate[]): ChapterCandidate[] {
  const result = [...spoken];
  for (const candidate of suggestions) {
    if (!result.some(other => Math.abs(seconds(other.candidate_start) - seconds(candidate.candidate_start)) < 1)) result.push(candidate);
  }
  return result.sort((a, b) => seconds(a.candidate_start) - seconds(b.candidate_start)).map((candidate, index) => ({ ...candidate, candidate_id: index + 1 }));
}
