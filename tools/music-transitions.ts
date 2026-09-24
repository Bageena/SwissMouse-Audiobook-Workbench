import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { AlignedWord, ChapterCandidate } from '../src/types';
import { formatTimestampMs, parseChapterTimestamp, formatChapterTitle } from '../src/utils/chapters';
import { ensureAnalysis, pcmDataRange } from './audio-analysis';

export const MUSIC_DETECTOR_VERSION = 2;
const MIN_SPACING = 120;
const EDGE_MARGIN = 60;
const MIN_GAP = 1.5;
const MAX_GAP = 45;
const FRAME = 1024;
const BANDS = 24;
const TIME_BINS = 8;
export interface MusicGap { start: number; end: number; wordIndex: number }
export interface MusicEvidence extends MusicGap {
  duration: number;
  tonalFraction: number;
  variation: number;
  silenceBefore: number;
  silenceAfter: number;
  fingerprint: number[];
}
export interface MusicDecision extends MusicEvidence {
  confidence: number;
  repeats: number;
  accepted: boolean;
  reason: string;
}

function lexical(word: AlignedWord) {
  return /[\p{L}\p{N}]/u.test(word.word)
    && (word.confidence === undefined || word.confidence >= 0.35);
}

// ASR may emit a marker as one token ("[Music]") or several ("[soft",
// "instrumental", "music]"). These describe audio, not transcribed speech.
// Plain words such as "music" and unknown bracketed text remain speech barriers.
function annotationIndices(words: AlignedWord[]): Set<number> {
  const ignored = new Set<number>();
  const marker = /^(?:(?:soft|quiet|loud|background|instrumental|dramatic|gentle|upbeat|theme|classical)\s+)*(?:music(?:\s+(?:plays|playing|continues|fades|ends))?|applause|silence|sound\s+effects?|non[ -]?speech|no\s+speech)$/i;
  for (let i = 0; i < words.length; i++) {
    const value = words[i].word.trim();
    if (/^[\s♪♫♬♩]+$/u.test(value)) { ignored.add(i); continue; }
    const opener = value[0];
    if (opener !== '[' && opener !== '(') continue;
    const closer = opener === '[' ? ']' : ')';
    let label = '';
    for (let end = i; end < Math.min(words.length, i + 8); end++) {
      label += `${label ? ' ' : ''}${words[end].word}`;
      if (!label.includes(closer)) continue;
      if (label.trim().endsWith(closer) && marker.test(label.trim().slice(1, -1).trim())) {
        for (let j = i; j <= end; j++) ignored.add(j);
        i = end;
      }
      break;
    }
  }
  return ignored;
}

// Word timings provide speech evidence, not a claim of VAD/music probability.
// No intro/outro gap, no segment-time approximation, and no analysis beneath
// continuous narration. Reject malformed/unsorted timelines conservatively.
export function musicGaps(words: AlignedWord[], duration: number): MusicGap[] {
  const gaps: MusicGap[] = [];
  if (!Number.isFinite(duration) || duration <= 0) return gaps;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!Number.isFinite(word.startSeconds) || !Number.isFinite(word.endSeconds)
      || word.startSeconds < 0 || word.endSeconds < word.startSeconds
      || (i > 0 && word.startSeconds < words[i - 1].startSeconds)) return [];
  }
  const annotations = annotationIndices(words);
  const speech = words.map((word, index) => ({ word, index })).filter(({ index }) => !annotations.has(index));
  let coveredUntil = 0;
  for (let i = 0; i < speech.length; i++) {
    const { word, index } = speech[i];
    const gap = word.startSeconds - coveredUntil;
    if (i >= 3 && i + 2 < speech.length && gap >= MIN_GAP && gap <= MAX_GAP
      && coveredUntil >= EDGE_MARGIN && word.startSeconds <= duration - EDGE_MARGIN) {
      const before = speech.slice(i - 3, i).map(entry => entry.word), after = speech.slice(i, i + 3).map(entry => entry.word);
      if (before.every(lexical) && after.every(lexical)
        && coveredUntil - before[0].startSeconds <= 6
        && after[2].endSeconds - word.startSeconds <= 6) {
        gaps.push({ start: coveredUntil, end: word.startSeconds, wordIndex: index });
      }
    }
    coveredUntil = Math.max(coveredUntil, word.endSeconds);
  }
  return gaps;
}

// Small radix-2 FFT; only 64 ms every 100 ms of a shortlisted speech gap.
// Normalized spectral bands over eight time bins retain the cue's changing
// acoustic signature. Duration alone never establishes recurrence.
function spectrum(pcm: Buffer, offset: number) {
  const real = new Float64Array(FRAME), imag = new Float64Array(FRAME);
  let energy = 0;
  for (let i = 0; i < FRAME; i++) {
    const sample = pcm.readInt16LE((offset + i) * 2) / 32768;
    energy += sample * sample;
    real[i] = sample * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME - 1)));
  }
  for (let i = 1, j = 0; i < FRAME; i++) {
    let bit = FRAME >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let size = 2; size <= FRAME; size *= 2) {
    const angle = -2 * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let base = 0; base < FRAME; base += size) {
      let cr = 1, ci = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = base + j, b = a + size / 2;
        const tr = cr * real[b] - ci * imag[b], ti = cr * imag[b] + ci * real[b];
        real[b] = real[a] - tr; imag[b] = imag[a] - ti;
        real[a] += tr; imag[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
  const bands = Array(BANDS).fill(0);
  let total = 0, logPower = 0, bins = 0;
  for (let i = 5; i < FRAME / 2; i++) {
    const power = real[i] ** 2 + imag[i] ** 2 + 1e-18;
    const band = Math.min(BANDS - 1, Math.floor(Math.log(i / 5) / Math.log((FRAME / 2) / 5) * BANDS));
    bands[band] += power;
    total += power; logPower += Math.log(power); bins++;
  }
  const norm = Math.sqrt(bands.reduce((sum, n) => sum + n * n, 0)) || 1;
  return { bands: bands.map(n => n / norm), rms: Math.sqrt(energy / FRAME), flatness: Math.exp(logPower / bins) / (total / bins) };
}

export function musicFeatures(pcm: Buffer, gap: MusicGap): MusicEvidence {
  const frames: ReturnType<typeof spectrum>[] = [];
  for (let offset = 0; offset + FRAME <= pcm.length / 2; offset += 1600) frames.push(spectrum(pcm, offset));
  // Cue loudness varies greatly across books and editions. A relative threshold
  // tolerates quiet copies/fades; the PCM quantization floor excludes digital
  // silence. The 99th percentile prevents one click setting the whole threshold.
  const levels = frames.map(frame => frame.rms).sort((a, b) => a - b);
  const threshold = Math.max(2 / 32768, (levels[Math.max(0, Math.ceil(levels.length * 0.99) - 1)] ?? 0) * 0.04);
  const active = frames.map((f, i) => f.rms >= threshold ? i : -1).filter(i => i >= 0);
  const first = active[0] ?? 0, last = active.at(-1) ?? -1;
  const fingerprint = Array(BANDS * TIME_BINS).fill(0);
  const counts = Array(TIME_BINS).fill(0);
  let tonal = 0, variation = 0;
  for (let index = 0; index < active.length; index++) {
    const i = active[index];
    const bin = Math.min(TIME_BINS - 1, Math.floor((i - first) / Math.max(1, last - first + 1) * TIME_BINS));
    counts[bin]++;
    frames[i].bands.forEach((value, band) => { fingerprint[bin * BANDS + band] += value; });
    if (frames[i].flatness < 0.18) tonal++;
    const previous = active[index - 1];
    if (previous !== undefined) variation += Math.max(0, 1 - frames[i].bands.reduce((sum, value, j) => sum + value * frames[previous].bands[j], 0));
  }
  for (let bin = 0; bin < TIME_BINS; bin++) {
    for (let band = 0; band < BANDS; band++) fingerprint[bin * BANDS + band] /= counts[bin] || 1;
  }
  return { ...gap, duration: active.length ? (last - first) * 0.1 + FRAME / 16000 : 0,
    tonalFraction: tonal / Math.max(1, active.length), variation: variation / Math.max(1, active.length - 1),
    silenceBefore: first * 0.1, silenceAfter: active.length ? Math.max(0, gap.end - gap.start - (last * 0.1 + FRAME / 16000)) : 0,
    fingerprint };
}

function similarity(a: number[], b: number[]) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return dot / (Math.sqrt(aa * bb) || 1);
}
function plausible(cue: MusicEvidence) {
  return cue.duration >= 1.5 && cue.duration <= 18 && cue.tonalFraction >= 0.65 && cue.variation >= 0.008;
}

export function scoreMusicTransitions(features: MusicEvidence[], spokenStarts: number[], duration: number): MusicDecision[] {
  const hasSilence = (cue: MusicEvidence) => cue.silenceBefore >= 0.2 && cue.silenceAfter >= 0.2;
  const eligible = (cue: MusicEvidence) => plausible(cue) && cue.start >= EDGE_MARGIN && cue.end <= duration - EDGE_MARGIN;
  // Build direct, symmetric matches once. Intro/outro cues cannot corroborate
  // interior boundaries, and several nearby snippets cannot count as repeats.
  const matches = features.map(() => new Map<number, number>());
  for (let i = 0; i < features.length; i++) {
    if (!eligible(features[i])) continue;
    for (let j = i + 1; j < features.length; j++) {
      const a = features[i], b = features[j];
      if (!eligible(b) || Math.abs(a.end - b.end) < MIN_SPACING
        || Math.abs(a.duration - b.duration) > Math.max(0.6, Math.min(a.duration, b.duration) * 0.15)) continue;
      const agreement = similarity(a.fingerprint, b.fingerprint);
      if (agreement >= 0.94) { matches[i].set(j, agreement); matches[j].set(i, agreement); }
    }
  }
  const acceptedReason = 'Recurring tonal cue between transcribed speech regions';
  const result: MusicDecision[] = features.map((cue, index) => {
    const peers = [...matches[index].keys()].sort((a, b) => Number(hasSilence(features[b])) - Number(hasSilence(features[a]))
      || matches[index].get(b)! - matches[index].get(a)! || features[a].end - features[b].end);
    // Require mutually matching, independently spaced evidence, rather than a
    // chain A~B~C where A and C need not share a cue. Seed a triple when one
    // exists; two isolated neighboring matches must not manufacture recurrence.
    let group = peers.length ? [index, peers[0]] : [index];
    findTriple: for (let i = 0; i < peers.length; i++) {
      for (let j = i + 1; j < peers.length; j++) {
        if (matches[peers[i]].has(peers[j])) { group = [index, peers[i], peers[j]]; break findTriple; }
      }
    }
    for (const peer of peers) {
      if (!group.includes(peer) && group.every(member => matches[member].has(peer))) group.push(peer);
    }
    const silence = hasSilence(cue);
    const silencePeer = group.slice(1).some(peer => hasSilence(features[peer]));
    const confidence = plausible(cue) ? Math.min(0.95, 0.45 + Math.min(group.length - 1, 2) * 0.18 + (silence ? 0.1 : 0)) : 0;
    let reason = acceptedReason;
    if (cue.duration < 1.5) reason = 'Active audio is shorter than the 1.5 second cue minimum';
    else if (cue.duration > 18) reason = 'Active audio exceeds the 18 second recurring-sting limit';
    else if (cue.tonalFraction < 0.65) reason = 'Insufficient tonal content';
    else if (cue.variation < 0.008) reason = 'Steady tone or ambient audio lacks musical change';
    else if (cue.start < EDGE_MARGIN || cue.end > duration - EDGE_MARGIN) reason = 'Intro/outro margin';
    else if (spokenStarts.some(start => Math.abs(start - cue.end) < MIN_SPACING)) reason = 'Spoken heading takes priority within minimum spacing';
    else if (group.length < 2) reason = 'Isolated cue; recurrence required';
    else if (group.length < 3 && !(silence && silencePeer)) reason = 'Two cues need silence on both sides; otherwise three are required';
    return { ...cue, confidence, repeats: group.length, accepted: reason === acceptedReason, reason };
  });
  // Resolve competition by evidence strength before time, so input order or a
  // weaker early cue cannot suppress the strongest nearby boundary.
  const selected: MusicDecision[] = [];
  for (const cue of result.filter(cue => cue.accepted).sort((a, b) => b.confidence - a.confidence || b.repeats - a.repeats || a.end - b.end)) {
    if (selected.some(prior => Math.abs(prior.end - cue.end) < MIN_SPACING)) {
      cue.accepted = false;
      cue.reason = 'Too close to a stronger music boundary';
    } else selected.push(cue);
  }
  return result;
}

interface MusicAnalysisOptions {
  signal?: AbortSignal; log?: (message: string) => void;
}

// Shared with named-title detection: both use the same bounded PCM windows and
// persisted acoustic features, while each applies its own evidence requirements.
export async function analyzeMusicGaps(audio: string, gaps: MusicGap[], options: MusicAnalysisOptions = {}): Promise<MusicEvidence[]> {
  options.signal?.throwIfAborted();
  if (!gaps.length) return [];
  const manifest = await ensureAnalysis(audio);
  if (gaps.some(gap => !Number.isFinite(gap.start) || !Number.isFinite(gap.end) || gap.start < 0
    || gap.end <= gap.start || gap.end > manifest.duration || gap.end - gap.start > 60
    || !Number.isInteger(gap.wordIndex) || gap.wordIndex < 0)) throw new Error('Invalid acoustic analysis window');
  // Hash only the small gap descriptor list, never reread/hash the source book.
  const key = createHash('sha256').update(JSON.stringify({ version: MUSIC_DETECTOR_VERSION, signature: manifest.signature, gaps })).digest('hex');
  const cachePath = `${manifest.directory}/music-${key}.json`;
  let features: MusicEvidence[];
  try {
    const saved = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
    if (saved.key !== key || !Array.isArray(saved.features) || saved.features.length !== gaps.length
      || !saved.features.every((f: MusicEvidence, i: number) => f && f.start === gaps[i].start && f.end === gaps[i].end && f.wordIndex === gaps[i].wordIndex
        && [f.duration, f.tonalFraction, f.variation, f.silenceBefore, f.silenceAfter].every(value => Number.isFinite(value) && value >= 0)
        && Math.max(f.duration, f.silenceBefore, f.silenceAfter) <= f.end - f.start + 0.1 && f.tonalFraction <= 1 && f.variation <= 2
        && f.fingerprint?.length === BANDS * TIME_BINS && f.fingerprint.every(value => Number.isFinite(value) && value >= 0))) throw new Error('Invalid music cache');
    features = saved.features;
    options.log?.(`Music feature cache: Hit (${gaps.length} speech gaps).`);
  } catch {
    options.log?.(`Music feature cache: Miss; analyzing ${gaps.length} short speech gaps from the existing PCM preview.`);
    features = [];
    const range = pcmDataRange(audio);
    const fd = await fs.promises.open(audio, 'r');
    try {
      for (const gap of gaps) {
        options.signal?.throwIfAborted();
        const first = Math.round(gap.start * 16000) * 2;
        const length = Math.min(Math.round((gap.end - gap.start) * 16000) * 2, range.length - first);
        if (length <= 0) throw new Error('Music gap exceeds PCM preview');
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await fd.read(buffer, 0, length, range.start + first);
        if (bytesRead !== length) throw new Error('Incomplete music preview read');
        features.push(musicFeatures(buffer, gap));
        await yieldToEventLoop();
      }
    } finally { await fd.close(); }
    options.signal?.throwIfAborted();
    const stat = await fs.promises.stat(audio);
    if (`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` !== manifest.signature) throw new Error('Preview changed during music analysis');
    const temporary = `${cachePath}.${randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporary, JSON.stringify({ key, features }));
      await fs.promises.rename(temporary, cachePath);
    } finally { await fs.promises.rm(temporary, { force: true }); }
  }
  options.signal?.throwIfAborted();
  // A cached read is asynchronous too: replacement during that read must never
  // associate old acoustic evidence with a newly prepared source generation.
  const finalStat = await fs.promises.stat(audio);
  if (`${finalStat.size}:${finalStat.mtimeMs}:${finalStat.ctimeMs}` !== manifest.signature) throw new Error('Preview changed during music analysis');
  return features;
}

export async function detectMusicTransitions(audio: string, words: AlignedWord[], spoken: ChapterCandidate[], options: MusicAnalysisOptions = {}): Promise<ChapterCandidate[]> {
  options.signal?.throwIfAborted();
  const manifest = await ensureAnalysis(audio);
  const gaps = musicGaps(words, manifest.duration);
  if (!gaps.length) { options.log?.(`Music transitions: no eligible ${MIN_GAP}–${MAX_GAP} second gaps between speech regions.`); return spoken; }
  const features = await analyzeMusicGaps(audio, gaps, options);
  const starts = spoken.map(c => (parseChapterTimestamp(c.candidate_start) ?? 0) / 1000);
  const decisions = scoreMusicTransitions(features, starts, manifest.duration);
  // Summary plus bounded detail: avoid one log line for every ordinary pause.
  const interesting = decisions.filter(c => c.accepted || plausible(c) || (c.duration > 18 && c.tonalFraction >= 0.65 && c.variation >= 0.008));
  for (const cue of interesting.slice(0, 30)) options.log?.(`Music ${formatTimestampMs(cue.end * 1000)}: ${cue.accepted ? 'accepted for review' : 'rejected'}; cue ${cue.duration.toFixed(1)}s, score ${cue.confidence.toFixed(2)}, similar cues ${cue.repeats}, silence ${cue.silenceBefore.toFixed(1)}/${cue.silenceAfter.toFixed(1)}s, speech before/after; ${cue.reason}.`);
  options.log?.(`Music transitions: ${decisions.filter(c => c.accepted).length} accepted for review, ${decisions.filter(c => !c.accepted).length} rejected${interesting.length > 30 ? '; detail limited to 30 cues' : ''}.`);
  const rejections = new Map<string, number>();
  for (const cue of decisions.filter(c => !c.accepted)) rejections.set(cue.reason, (rejections.get(cue.reason) ?? 0) + 1);
  if (rejections.size) options.log?.(`Music rejection summary: ${[...rejections].map(([reason, count]) => `${count}: ${reason}`).join('; ')}.`);
  const music: ChapterCandidate[] = decisions.filter(c => c.accepted).map(cue => ({
    candidate_id: 0, candidate_start: formatTimestampMs(cue.end * 1000),
    candidate_end: formatTimestampMs(words[cue.wordIndex].endSeconds * 1000),
    proposed_title: '', matched_text: 'Musical transition',
    context_before: words.slice(Math.max(0, cue.wordIndex - 18), cue.wordIndex).map(w => w.word).join(' '),
    context_after: words.slice(cue.wordIndex, cue.wordIndex + 26).map(w => w.word).join(' '),
    transcriptWordIndex: cue.wordIndex, headingType: 'music_transition',
    confidence: String(cue.confidence), status: 'review',
    notes: `Experimental music boundary: ${cue.duration.toFixed(1)}s cue, ${cue.repeats} similar transitions, heuristic score ${cue.confidence.toFixed(2)}. Start anchored to resumed transcript word; listen to verify.`,
    words: words.slice(Math.max(0, cue.wordIndex - 18), cue.wordIndex + 26),
  }));
  const merged = [...spoken, ...music].sort((a, b) => (parseChapterTimestamp(a.candidate_start) ?? 0) - (parseChapterTimestamp(b.candidate_start) ?? 0));
  const openingOffset = merged[0]?.candidate_start === '00:00:00.000' ? 1 : 2;
  return merged.map((candidate, index) => ({
    ...candidate, candidate_id: index + 1,
    ...(candidate.headingType === 'music_transition' ? { proposed_title: formatChapterTitle(index + openingOffset, 'numerical') } : {}),
  }));
}
