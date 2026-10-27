import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AlignedWord, ChapterCandidate } from '../src/types';
import { formatTimestampMs, parseChapterTimestamp } from '../src/utils/chapters';
import { buildTranscriptWords } from '../src/utils/wordAlignment';
import { detectChapterHeadings } from './chapter-detection';
import { pcmDataRange } from './audio-analysis';
import { isolatedHeadingPhrases, phraseCandidate, type SourceBoundary } from './improved-chapter-detection';
import type { NormalizedTranscription } from './transcription-engine';

export interface RecoveryWindow { start: number; end: number; target: number; number?: number; title?: string; parent?: string; reason: string; }
const seconds = (value: string) => (parseChapterTimestamp(value) ?? 0) / 1000;
const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

/** No blind scan: only unresolved isolated announcements and gaps in a known sequence. */
export function recoveryWindows(words: AlignedWord[], spoken: ChapterCandidate[], suggestions: ChapterCandidate[], duration: number, sources: SourceBoundary[] = []): RecoveryWindow[] {
  const targets: Omit<RecoveryWindow, 'start' | 'end'>[] = [];
  const phrases = isolatedHeadingPhrases(words, spoken, duration);
  for (const phrase of phrases) {
    if (suggestions.some(candidate => Math.abs(seconds(candidate.candidate_start) - phrase.start) < 2)) continue;
    if (phrase.number !== undefined) {
      const neighbors = phrases.filter(other => other.parent === phrase.parent && other.number !== undefined);
      if (!neighbors.some(other => other.number === phrase.number! - 1 && other.start < phrase.start)
        || !neighbors.some(other => other.number === phrase.number! + 1 && other.start > phrase.start)) continue;
      targets.push({ target: phrase.start, number: phrase.number, parent: phrase.parent, reason: 'Unresolved number between neighboring sections' });
    }
  }
  const sectionAnchors = phrases.filter(phrase => phrase.number !== undefined).map(phrase => ({
    candidate_start: formatTimestampMs(phrase.start * 1000), chapterNumber: phrase.number, parentChapterStart: phrase.parent, headingType: 'numbered_section',
  }));
  const headings = [...spoken.filter(candidate => candidate.headingType === 'numbered_chapter'), ...sectionAnchors]
    .sort((a, b) => (a.headingType || '').localeCompare(b.headingType || '')
      || (a.parentChapterStart || '').localeCompare(b.parentChapterStart || '')
      || seconds(a.candidate_start) - seconds(b.candidate_start));
  for (let i = 1; i < headings.length; i++) {
    const before = headings[i - 1], after = headings[i];
    if (before.headingType !== after.headingType || before.parentChapterStart !== after.parentChapterStart) continue;
    if (after.chapterNumber !== (before.chapterNumber ?? -2) + 2) continue;
    const options: { target: number; pause: number }[] = [];
    for (let j = 1; j < words.length; j++) {
      const word = words[j], pause = word.startSeconds - words[j - 1].endSeconds;
      if (word.startSeconds > seconds(before.candidate_start) + 15 && word.startSeconds < seconds(after.candidate_start) - 15 && pause >= 1.5) {
        options.push({ target: word.startSeconds, pause });
      }
    }
    for (const option of options.sort((a, b) => b.pause - a.pause).slice(0, 3)) targets.push({ target: option.target,
      number: before.chapterNumber! + 1, parent: before.parentChapterStart,
      reason: before.headingType === 'numbered_section' ? 'Pause inside a missing numbered-section sequence' : 'Pause inside a missing spoken-chapter sequence' });
  }
  for (const source of sources) {
    if (source.start < 1 || spoken.some(candidate => Math.abs(seconds(candidate.candidate_start) - source.start) < 3)) continue;
    targets.push({ target: source.start, title: source.title, reason: 'Source boundary without a matching spoken heading' });
  }
  const result: RecoveryWindow[] = [];
  for (const target of targets) {
    if (result.length >= 8) break;
    if (!result.some(window => Math.abs(window.target - target.target) < 12)) result.push({ ...target,
      start: Math.max(0, target.target - 10), end: Math.min(duration, target.target + 14) });
  }
  return result;
}

export function recoveredCandidates(result: NormalizedTranscription, windows: (RecoveryWindow & { packedStart: number })[], original: AlignedWord[]): ChapterCandidate[] {
  const suggestions: ChapterCandidate[] = [];
  for (const window of windows) {
    const packedEnd = window.packedStart + window.end - window.start;
    const segments = result.segments.filter(segment => segment.start >= window.packedStart && segment.end <= packedEnd
      && (segment.noSpeechProbability ?? 0) < .5).map(segment => ({ ...segment,
        start: segment.start - window.packedStart + window.start, end: segment.end - window.packedStart + window.start,
        words: segment.words.filter(word => word.start >= window.packedStart && word.end <= packedEnd).map(word => ({ ...word,
          start: word.start - window.packedStart + window.start, end: word.end - window.packedStart + window.start })) }));
    const words = buildTranscriptWords(segments);
    // Require nearby ordinary words to agree with the saved transcript. A second
    // model pass alone is not independent evidence and may hallucinate in silence.
    const context = new Set(original.filter(word => word.startSeconds >= window.start && word.endSeconds <= window.end
      && Math.abs(word.startSeconds - window.target) > 2).flatMap(word => tokens(word.word)));
    const agreement = new Set(words.filter(word => Math.abs(word.startSeconds - window.target) > 2).flatMap(word => tokens(word.word)).filter(word => context.has(word)));
    if (agreement.size < 3) continue;
    const explicit = detectChapterHeadings(segments).filter(heading => Math.abs(heading.start - window.target) <= 5
      && (window.number === undefined || heading.chapterNumber === window.number));
    for (const heading of explicit) {
      const headingWords = words.filter(word => word.startSeconds >= heading.start && word.endSeconds <= heading.end + .01);
      if (!headingWords.length || headingWords.some(word => (word.confidence ?? 0) < .6)) continue;
      const first = words.indexOf(headingWords[0]), last = words.indexOf(headingWords.at(-1)!);
      const candidate = phraseCandidate({ first, last, start: heading.start, end: heading.end, before: 0, after: 0, title: heading.text }, words,
        [window.reason, 'Second transcription confirms a spoken heading and agrees with surrounding transcript']);
      suggestions.push({ ...candidate, headingType: heading.headingType, chapterNumber: heading.chapterNumber,
        proposed_title: heading.text, recovered: true, timingSource: 'recheck', transcriptWordIndex: undefined });
    }
    if (explicit.length) continue;
    const isolated = isolatedHeadingPhrases(words, [], window.end + 15).filter(phrase => Math.abs(phrase.start - window.target) <= 3
      && (window.number !== undefined ? phrase.number === window.number : phrase.title && tokens(phrase.title).join(' ') === tokens(window.title || '').join(' ')));
    for (const phrase of isolated) {
      if (words.slice(phrase.first, phrase.last + 1).some(word => (word.confidence ?? 0) < .6)) continue;
      const candidate = phraseCandidate({ ...phrase, parent: window.parent }, words,
        [window.reason, 'Second transcription confirms an isolated announcement and agrees with surrounding transcript']);
      suggestions.push({ ...candidate, recovered: true, timingSource: 'recheck', transcriptWordIndex: undefined });
    }
  }
  return suggestions;
}

export async function recheckChapterWindows(options: {
  audio: string; directory: string; windows: RecoveryWindow[]; original: AlignedWord[]; settingsKey: string;
  run: (audio: string, output: string) => Promise<NormalizedTranscription>;
  signal?: AbortSignal; log?: (message: string) => void;
}): Promise<ChapterCandidate[]> {
  const { windows, audio, signal } = options;
  if (!windows.length) return [];
  signal?.throwIfAborted();
  const stat = await fs.promises.stat(audio), signature = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const key = createHash('sha256').update(JSON.stringify({ version: 1, signature, windows, settings: options.settingsKey, original: options.original })).digest('hex');
  const cache = path.join(options.directory, `chapter-recheck-${key}.json`);
  const map = windows.map((window, index) => ({ ...window, packedStart: windows.slice(0, index).reduce((total, item) => total + item.end - item.start + 1, 0) }));
  try {
    const saved = JSON.parse(await fs.promises.readFile(cache, 'utf8'));
    if (saved.key === key && Array.isArray(saved.result?.segments)) {
      signal?.throwIfAborted();
      const current = await fs.promises.stat(audio);
      if (`${current.size}:${current.mtimeMs}:${current.ctimeMs}` !== signature) throw new Error('Preview changed during cached heading recheck');
      options.log?.(`Heading recheck: cache hit (${windows.length} short windows).`);
      return recoveredCandidates(saved.result, map, options.original);
    }
  } catch { signal?.throwIfAborted(); /* Missing or damaged cache: regenerate only the bounded clips. */ }
  await fs.promises.mkdir(options.directory, { recursive: true });
  const temporary = await fs.promises.mkdtemp(path.join(options.directory, 'chapter-recheck-'));
  try {
    const range = pcmDataRange(audio), input = await fs.promises.open(audio, 'r'), buffers: Buffer[] = [];
    try {
      for (const window of windows) {
        signal?.throwIfAborted();
        if (window.start < 0 || window.end <= window.start || window.end - window.start > 24.001 || window.end * 32000 > range.length + 2) throw new Error('Invalid heading recheck window');
        const buffer = Buffer.alloc(Math.round((window.end - window.start) * 16000) * 2);
        const { bytesRead } = await input.read(buffer, 0, buffer.length, range.start + Math.round(window.start * 16000) * 2);
        if (bytesRead !== buffer.length) throw new Error('Incomplete heading recheck audio');
        buffers.push(buffer, Buffer.alloc(32000));
      }
    } finally { await input.close(); }
    const pcm = Buffer.concat(buffers), header = Buffer.alloc(44);
    header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    const clip = path.join(temporary, 'windows.wav');
    await fs.promises.writeFile(clip, Buffer.concat([header, pcm]));
    options.log?.(`Heading recheck: ${windows.length} windows, ${(pcm.length / 32000).toFixed(0)}s total; existing engine/model, batching off. Original transcript is preserved.`);
    const result = await options.run(clip, path.join(temporary, 'result.json'));
    signal?.throwIfAborted();
    const current = await fs.promises.stat(audio);
    if (`${current.size}:${current.mtimeMs}:${current.ctimeMs}` !== signature) throw new Error('Preview changed during heading recheck');
    const suggestions = recoveredCandidates(result, map, options.original);
    const pending = path.join(temporary, 'cache.json');
    await fs.promises.writeFile(pending, JSON.stringify({ key, result }));
    await fs.promises.rename(pending, cache);
    options.log?.(`Heading recheck: ${suggestions.length} supported suggestions; original transcript unchanged.`);
    return suggestions;
  } finally { await fs.promises.rm(temporary, { recursive: true, force: true }); }
}
