import type { NormalizedSegment } from './transcription-engine';
import type { HeadingType } from '../src/types';

const units = 'one|two|three|four|five|six|seven|eight|nine';
const small = `zero|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|${units}`;
const tens = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const ordinalUnits = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth';
const ordinalSmall = `${ordinalUnits}|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth`;
const ordinalTens = 'twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth';
const underHundred = `(?:(?:${tens})(?: (?:${units}|${ordinalUnits}))?|${ordinalTens}|${ordinalSmall}|${small})`;
const writtenNumber = `(?:(?:${units}) hundred(?: (?:and )?${underHundred})?|${underHundred})`;
const numberPattern = `(?:\\d+|${writtenNumber}|[mdclxvi]+)`;
const numberAtStart = new RegExp(`^(${numberPattern})(?: |$)`);
const numberedLabels = new Set(['chapter', 'part', 'book', 'section']);
const headingTypes: Record<string, HeadingType> = {
  chapter: 'numbered_chapter', part: 'section_divider', book: 'section_divider', section: 'section_divider',
  introduction: 'front_matter', foreword: 'front_matter', preface: 'front_matter', prologue: 'front_matter',
  interlude: 'chapter_like', prelude: 'chapter_like', coda: 'chapter_like',
  epilogue: 'back_matter', afterword: 'back_matter', conclusion: 'back_matter',
  appendix: 'back_matter', appendices: 'back_matter', notes: 'back_matter',
  acknowledgments: 'back_matter', acknowledgements: 'back_matter',
};
const unnumberedLabels = new Set(Object.keys(headingTypes).filter(key => !numberedLabels.has(key)));
const numberValues = new Map<string, number>();
'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ')
  .forEach((word, i) => numberValues.set(word, i));
ordinalSmall.split('|').forEach((word, i) => numberValues.set(word, i + 1));
[tens, ordinalTens].forEach(list => list.split('|').forEach((word, i) => numberValues.set(word, (i + 2) * 10)));

function parseNumber(text: string): number | undefined {
  if (/^\d+$/.test(text)) return Number(text);
  if (/^[mdclxvi]+$/.test(text)) {
    if (!/^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/.test(text)) return undefined;
    const values: Record<string, number> = { m: 1000, d: 500, c: 100, l: 50, x: 10, v: 5, i: 1 };
    return [...text].reduce((sum, letter, i) => sum + (values[letter] < (values[text[i + 1]] || 0) ? -values[letter] : values[letter]), 0);
  }
  return text.split(' ').reduce((sum, word) => word === 'hundred' ? sum * 100 : sum + (numberValues.get(word) || 0), 0);
}

export interface DetectedHeading {
  start: number;
  end: number;
  text: string;
  headingType: HeadingType;
  chapterNumber?: number;
  recovered?: boolean;
  transcriptWordIndex?: number;
}

interface IndexedToken {
  normalized: string;
  offset: number;
  end: number;
  startTime: number;
  endTime: number;
  segmentStart: boolean;
  segmentEnd: boolean;
  transcriptWordIndex?: number;
}

interface TokenText { text: string; offset: number; end: number }
interface RecoveryCandidate { tokenIndex: number; tokenCount: number; chapterNumber: number }

// Each normalized token retains its original punctuation offsets and the
// timestamp of the Whisper word displayed by the transcript player.
function tokenize(text: string): TokenText[] {
  return Array.from(text.matchAll(/[\p{L}]+|\d+/gu), match => ({
    text: match[0], offset: match.index!, end: match.index! + match[0].length,
  }));
}

function validWords(segment: NormalizedSegment) {
  return (segment.words || []).map(word => ({
    word: String(word.word || '').trim(), start: Number(word.start), end: Number(word.end),
  })).filter(word => word.word && Number.isFinite(word.start) && Number.isFinite(word.end));
}

function buildTokenIndex(segments: NormalizedSegment[]): { source: string; tokens: IndexedToken[] } {
  const sourceParts: string[] = [];
  const tokens: IndexedToken[] = [];
  let sourceLength = 0;
  let transcriptWordOffset = 0;
  for (const segment of segments) {
    const words = validWords(segment);
    const wordTokens = words.flatMap((word, wordIndex) => tokenize(word.word).map(token => ({ ...token, word, wordIndex })));
    let text = segment.text;
    let textTokens = tokenize(text);
    const aligned = textTokens.length === wordTokens.length && textTokens.every((token, i) =>
      token.text.toLowerCase() === wordTokens[i].text.toLowerCase());
    if (wordTokens.length && !aligned) {
      text = words.map(word => word.word).join(' ');
      textTokens = tokenize(text);
    }
    for (let i = 0; i < textTokens.length; i++) {
      const token = textTokens[i];
      tokens.push({
        normalized: token.text.toLowerCase(),
        offset: sourceLength + token.offset,
        end: sourceLength + token.end,
        segmentStart: i === 0,
        segmentEnd: i === textTokens.length - 1,
        startTime: wordTokens.length ? wordTokens[i].word.start : segment.start,
        endTime: wordTokens.length ? wordTokens[i].word.end : segment.end,
        ...(wordTokens.length ? { transcriptWordIndex: transcriptWordOffset + wordTokens[i].wordIndex } : {}),
      });
    }
    sourceParts.push(text, ' ');
    sourceLength += text.length + 1;
    transcriptWordOffset += words.length;
  }
  return { source: sourceParts.join(''), tokens };
}

// Number phrases contain at most five tokens ("one hundred and twenty three").
// Only likely marker locations pay for this parsing work.
function numberFollowing(tokens: IndexedToken[], firstNumberIndex: number) {
  if (firstNumberIndex >= tokens.length) return undefined;
  const window = tokens.slice(firstNumberIndex, firstNumberIndex + 5).map(token => token.normalized).join(' ');
  const match = numberAtStart.exec(window);
  if (!match) return undefined;
  const chapterNumber = parseNumber(match[1]);
  if (chapterNumber === undefined || !Number.isSafeInteger(chapterNumber)) return undefined;
  return { chapterNumber, tokenCount: match[1].split(' ').length };
}

export function detectChapterHeadings(segments: NormalizedSegment[]): DetectedHeading[] {
  const { source, tokens } = buildTokenIndex(segments);
  const headings: (DetectedHeading & { tokenIndex: number })[] = [];
  const recoveryCandidates: RecoveryCandidate[] = [];
  const seen = new Set<string>();

  function addHeading(tokenIndex: number, tokenCount: number, headingType: HeadingType, chapterNumber?: number, recovered = false) {
    const first = tokens[tokenIndex];
    const last = tokens[tokenIndex + tokenCount - 1];
    if (!first || !last) return;
    const previous = tokens[tokenIndex - 1];
    const next = tokens[tokenIndex + tokenCount];
    if (!first.segmentStart && previous && !/[.!?\n\r]/.test(source.slice(previous.end, first.offset))) return;
    if (chapterNumber === undefined && !last.segmentEnd && next &&
        !/[.!?:;\n\r\u2013\u2014]/.test(source.slice(last.end, next.offset))) return;
    if (!Number.isFinite(first.startTime) || first.startTime < 0 ||
        !Number.isFinite(last.endTime) || last.endTime < first.startTime) return;
    const text = source.slice(first.offset, last.end).trim().replace(/\s+/g, ' ');
    const duplicateKey = `${headingType}\0${chapterNumber ?? ''}\0${first.startTime}\0${text.toLowerCase()}`;
    if (seen.has(duplicateKey)) return;
    seen.add(duplicateKey);
    headings.push({
      start: first.startTime, end: last.endTime, text, headingType,
      ...(chapterNumber !== undefined ? { chapterNumber } : {}),
      ...(recovered ? { recovered: true } : {}), tokenIndex,
      ...(first.transcriptWordIndex !== undefined ? { transcriptWordIndex: first.transcriptWordIndex } : {}),
    });
  }

  // One pass identifies likely heading markers. Expensive parsing and boundary
  // checks are restricted to this small candidate set.
  for (let i = 0; i < tokens.length; i++) {
    const label = tokens[i].normalized;
    if (numberedLabels.has(label)) {
      const number = numberFollowing(tokens, i + 1);
      if (number) addHeading(i, number.tokenCount + 1, headingTypes[label], number.chapterNumber);
      if (label === 'chapter' && tokens[i + 1]?.normalized === 'number') {
        const recovered = numberFollowing(tokens, i + 2);
        if (recovered) recoveryCandidates.push({ tokenIndex: i, tokenCount: recovered.tokenCount + 2, chapterNumber: recovered.chapterNumber });
      }
    } else if (unnumberedLabels.has(label)) {
      addHeading(i, 1, headingTypes[label]);
    } else if (label === 'chaptor') {
      const recovered = numberFollowing(tokens, i + 1);
      if (recovered) recoveryCandidates.push({ tokenIndex: i, tokenCount: recovered.tokenCount + 1, chapterNumber: recovered.chapterNumber });
    } else if (label === 'chap' && tokens[i + 1]?.normalized === 'ter') {
      const recovered = numberFollowing(tokens, i + 2);
      if (recovered) recoveryCandidates.push({ tokenIndex: i, tokenCount: recovered.tokenCount + 2, chapterNumber: recovered.chapterNumber });
    }
  }

  // Recover a single missing number only between two observed chapter anchors.
  // This searches the typo-candidate list, not the intervening transcript text.
  const chapters = headings.filter(heading => heading.headingType === 'numbered_chapter');
  let recoveryStart = 0;
  for (let i = 1; i < chapters.length; i++) {
    const before = chapters[i - 1];
    const after = chapters[i];
    if (after.chapterNumber! !== before.chapterNumber! + 2 || after.start <= before.start) continue;
    while (recoveryStart < recoveryCandidates.length && recoveryCandidates[recoveryStart].tokenIndex <= before.tokenIndex) recoveryStart++;
    const expected = before.chapterNumber! + 1;
    const possible: RecoveryCandidate[] = [];
    for (let j = recoveryStart; j < recoveryCandidates.length && recoveryCandidates[j].tokenIndex < after.tokenIndex; j++) {
      if (recoveryCandidates[j].chapterNumber === expected) possible.push(recoveryCandidates[j]);
    }
    if (possible.length !== 1) continue;
    const candidate = possible[0];
    const first = tokens[candidate.tokenIndex];
    if (first.startTime > before.start && first.startTime < after.start) {
      addHeading(candidate.tokenIndex, candidate.tokenCount, 'numbered_chapter', expected, true);
    }
  }

  return headings.sort((a, b) => a.tokenIndex - b.tokenIndex).map(({ tokenIndex, ...heading }) => heading);
}
