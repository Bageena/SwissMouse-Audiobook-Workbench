import type { AudiobookMetadata } from '../src/types';

export interface MatchBook {
  id: string;
  metadata: AudiobookMetadata;
  durationSeconds?: number;
  chapterCount?: number;
  formats: string[];
  fileSizes: number[];
  missing?: boolean;
  logicalBookId?: string;
}
export type MatchKind = 'book' | 'audio' | 'uncertain';
export interface BookMatch { a: string; b: string; kind: MatchKind; reasons: string[] }
export const pairKey = (a: string, b: string) => [a, b].sort().join('\u0000');
export const normalizeMatchText = (value?: string) => (value || '').normalize('NFKD').toLowerCase()
  .replace(/\p{M}/gu, '').replace(/['’‘]/g, '').replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();

const MAX_MATCHES = 2000;
const MAX_EXAMINED = 20000;
const unknownPerson = /^(?:unknown(?: author)?|various(?: authors)?|n a|none)$/;
const genericTitle = /^(?:(?:cd|disc|disk|track|chapter|part|book|volume|vol|audio|audiobook|unknown|untitled|file)(?:\s+\d+)?|unknown title|\d{1,3})$/;
const audioDecoration = /^(?:(?:unabridged|abridged|audiobook|audio book|audible|audio|edition|mp3|m4[ab]|aac|flac|opus|ogg|wav|stereo|mono|kbps|kb s|khz|bit|\d+)\s*)+$/;
const isAudioDecoration = (value: string) => audioDecoration.test(value) && /[a-z]/.test(value);
const partNumber = /\b(?:book|volume|vol|part)\s*\.?\s*(\d+(?:\.\d+)?)\b/i;

// Structured people preserve comma-containing names; legacy strings can be
// "Last, First", or lists separated with semicolons, &, commas, and "and".
function authorKeys(metadata: AudiobookMetadata): string[] {
  const names = metadata.authors?.some(name => name.trim()) ? metadata.authors : (metadata.author || '').split(/\s*(?:;|&|\band\b|\|)\s*/i)
    .flatMap(name => {
      const pieces = name.split(',').map(piece => piece.trim()).filter(Boolean);
      return pieces.length > 1 && pieces.every(piece => normalizeMatchText(piece).split(' ').length >= 2) ? pieces : [name];
    });
  return [...new Set(names.map(name => normalizeMatchText(name).replace(/\b(?:[a-z] ){1,}[a-z]\b/g, initials => initials.replace(/ /g, '')))
    .filter(name => name && !unknownPerson.test(name)).map(name => name.split(' ').sort().join(' ')))].sort();
}

type AliasKind = 'title' | 'normalized' | 'subtitle';
/** Persistent candidate buckets; verification still uses the same conservative matcher. */
export function matchCandidateKeys(book: MatchBook): string[] {
  const value = profile(book), keys = [...value.titles.keys()].flatMap(title => [
    ...value.authors.map(author=>`author-title:${author}:${title}`), `title:${title}`]);
  for (const field of ['isbn','asin'] as const) {
    const id = (book.metadata[field] || '').replace(/[\s-]/g,'').toUpperCase();
    if (field === 'isbn' ? /^(?:\d{13}|\d{9}[\dX])$/.test(id) : /^[A-Z0-9]{10}$/.test(id)) keys.push(`${field}:${id}`);
  }
  if (book.fileSizes.length && book.fileSizes.every(size => Number.isFinite(size) && size > 0)) keys.push(`size:${[...book.fileSizes].sort((a,b)=>a-b).join(',')}`);
  return keys;
}
interface Profile {
  book: MatchBook;
  titles: Map<string, AliasKind>;
  authors: string[];
  canonical: string;
  sequence: string;
}

function profile(book: MatchBook): Profile {
  const metadata = book.metadata;
  const titles = new Map<string, AliasKind>();
  const add = (title: string, kind: AliasKind) => {
    const key = normalizeMatchText(title);
    const withoutExtension = normalizeMatchText(title.replace(/\.(?:m4[ab]|mp3|flac|ogg|opus|wav)\s*$/i, ''));
    if (key && !genericTitle.test(withoutExtension) && !titles.has(key)) titles.set(key, kind);
  };
  add(metadata.title, 'title');
  let title = (metadata.title || '').replace(/\.(?:m4[ab]|mp3|flac|ogg|opus|wav)\s*$/i, '').trim();
  let sequence = metadata.seriesSequence?.trim() || '';
  // Preserve volume identity when removing an annotation: distinct novels in
  // a series must not match merely through their shared series name.
  title = title.replace(/\[([^\]]+)\]|\(([^)]+)\)/g, (whole, square: string, round: string) => {
    const text = square || round, normalized = normalizeMatchText(text);
    const number = text.match(partNumber) || text.match(/#\s*(\d+(?:\.\d+)?)/);
    const series = normalizeMatchText(metadata.series);
    if (isAudioDecoration(normalized)) return '';
    if (number || series && (normalized === series || normalized.startsWith(series + ' '))) {
      sequence ||= number?.[1] || '';
      return '';
    }
    return whole;
  }).trim();
  // File order and collection codes: "01 FW1.0 Earth Unaware" / "Ender09 - ...".
  // Four-digit years and numbers within titles remain significant.
  title = title.replace(/^\d{1,3}(?:\s*[-._)]\s*|\s+)(?=\S)/, '')
    .replace(/^[a-z]{1,12}\d+(?:\.\d+)*\s*[-:]\s*|^[a-z]{1,5}\d+(?:\.\d+)+(?:\s+)/i, '');
  const seriesSuffix = title.match(/\s*:\s*[^:]+[,;]\s*(?:book|volume|vol\.?|part)\s+(\d+(?:\.\d+)?)\s*$/i);
  if (seriesSuffix) { sequence ||= seriesSuffix[1]; title = title.slice(0, seriesSuffix.index).trim(); }
  const suffix = title.match(/(?:\s*[-,:]\s*|\s+)(?:book|volume|vol\.?|part)\s+(\d+(?:\.\d+)?)\s*$/i);
  if (suffix) { sequence ||= suffix[1]; title = title.slice(0, suffix.index).trim(); }
  // Tagged series and author text often occurs at an end of a filename title.
  const segments = title.split(/\s+[-–—]\s+|\s*:\s*/);
  const series = normalizeMatchText(metadata.series);
  const authors = authorKeys(metadata);
  const isContext = (segment: string) => {
    const value = normalizeMatchText(segment);
    if (isAudioDecoration(value)) return true;
    if (series && (value === series || value.replace(/\s+(?:(?:book|volume|vol)\s+)?\d+(?:\s+\d+)?$/, '') === series)) return true;
    const people = authorKeys({ ...metadata, authors: undefined, author: segment });
    return people.length === 1 && authors.includes(people[0]);
  };
  while (segments.length > 1 && isContext(segments[0])) segments.shift();
  while (segments.length > 1 && isContext(segments[segments.length - 1])) segments.pop();
  title = segments.join(': ').trim();
  const canonical = normalizeMatchText(title);
  add(title, 'normalized');
  // A separately tagged subtitle is reliable. Untagged subtitle omissions also
  // need author, narrator, and runtime agreement in titleBasis below.
  if (metadata.subtitle) {
    const subtitle = normalizeMatchText(metadata.subtitle);
    if (canonical.endsWith(' ' + subtitle)) add(canonical.slice(0, -subtitle.length).trim(), 'normalized');
  }
  const colon = title.indexOf(':');
  if (colon > 0) {
    const main = normalizeMatchText(title.slice(0, colon));
    const subtitle = normalizeMatchText(title.slice(colon + 1));
    if (main.length >= 6 && subtitle.split(' ').length >= 4) add(main, 'subtitle');
  }
  return { book, titles, authors, canonical,
    sequence: sequence && Number.isFinite(Number(sequence)) ? String(Number(sequence)) : normalizeMatchText(sequence) };
}

const sameRuntime = (a: MatchBook, b: MatchBook) => !!a.durationSeconds && !!b.durationSeconds
  && Math.abs(a.durationSeconds - b.durationSeconds) < Math.max(30, Math.max(a.durationSeconds, b.durationSeconds) * .01);
const sharedAuthor = (a: Profile, b: Profile) => a.authors.some(author => b.authors.includes(author));

function titleBasis(a: Profile, b: Profile): AliasKind | undefined {
  if (a.authors.length && b.authors.length && !sharedAuthor(a, b)) return;
  for (const [title, kindA] of a.titles) {
    const kindB = b.titles.get(title);
    if (!kindB) continue;
    if (kindA === 'title' && kindB === 'title') return 'title';
    if (a.sequence && b.sequence && a.sequence !== b.sequence) continue;
    if (kindA !== 'subtitle' && kindB !== 'subtitle') return 'normalized';
    // Different subtitles sharing a series prefix are not matching books.
    if (title !== a.canonical && title !== b.canonical) continue;
    const narratorA = normalizeMatchText(a.book.metadata.narrator), narratorB = normalizeMatchText(b.book.metadata.narrator);
    if (sharedAuthor(a, b) && narratorA && narratorA === narratorB && sameRuntime(a.book, b.book)) return 'subtitle';
  }
}

// Each book is normalized once and indexed by title and individual author.
// Candidate generation needs neither all-library fuzzy comparisons nor I/O.
export function findBookMatches(books: MatchBook[], dismissed: ReadonlySet<string> = new Set()): BookMatch[] {
  const profiles = books.filter(book => !book.missing).map(profile);
  const matches: BookMatch[] = [];
  const considered = new Set<string>();
  let examined = 0;
  const full = () => matches.length >= MAX_MATCHES || examined >= MAX_EXAMINED;
  const consider = (a: Profile, b: Profile, fallback?: 'size' | 'isbn' | 'asin') => {
    if (full()) return;
    examined++;
    const key = pairKey(a.book.id, b.book.id);
    if (a.book.id === b.book.id || considered.has(key) || dismissed.has(key) || a.book.logicalBookId && a.book.logicalBookId === b.book.logicalBookId) return;
    const basis = titleBasis(a, b) || fallback;
    if (!basis) return;
    considered.add(key);
    const reasons = [basis === 'title' ? 'Matching title' : basis === 'normalized' ? 'Matching title after removing naming and format annotations'
      : basis === 'subtitle' ? 'Matching main title; subtitle differs or is omitted' : basis === 'size' ? 'Matching file counts and sizes; compare hashes to confirm' : 'Matching ' + basis.toUpperCase()];
    const sameAuthors = !!a.authors.length && a.authors.join('\u0000') === b.authors.join('\u0000');
    if (sameAuthors) reasons.push('Matching author');
    else if (sharedAuthor(a, b)) reasons.push('Overlapping authors');
    else if (a.authors.length && b.authors.length) reasons.push('Different authors');
    const narratorA = normalizeMatchText(a.book.metadata.narrator), narratorB = normalizeMatchText(b.book.metadata.narrator);
    if (narratorA && narratorB) reasons.push(narratorA === narratorB ? 'Matching narrator' : 'Different narrators');
    const editionA = normalizeMatchText(a.book.metadata.edition), editionB = normalizeMatchText(b.book.metadata.edition);
    if (editionA && editionB && editionA !== editionB) reasons.push('Different editions');
    const seriesA = normalizeMatchText(a.book.metadata.series), seriesB = normalizeMatchText(b.book.metadata.series);
    if (seriesA && seriesB && seriesA !== seriesB) reasons.push('Different series');
    if (a.sequence && b.sequence && a.sequence !== b.sequence) reasons.push('Different series numbers');
    if (sameRuntime(a.book, b.book)) reasons.push('Similar runtime');
    if (a.book.chapterCount && a.book.chapterCount === b.book.chapterCount) reasons.push('Matching chapter count');
    if ([...a.book.formats].sort().join(',') !== [...b.book.formats].sort().join(',')) reasons.push('Different formats');
    matches.push({ a: a.book.id, b: b.book.id, kind: basis === 'size' || basis === 'subtitle' || !sameAuthors || !narratorA || !narratorB ? 'uncertain' : 'book', reasons });
  };
  const addIndex = (index: Map<string, Profile[]>, key: string, entry: Profile) => { const group = index.get(key); if (group) group.push(entry); else index.set(key, [entry]); };
  const titles = new Map<string, Profile[]>();
  for (const entry of profiles) for (const title of entry.titles.keys()) addIndex(titles, title, entry);
  interface CandidateGroup { entries: Profile[]; fallback?: 'size' | 'isbn' | 'asin'; unknown?: Profile[] }
  const groups: CandidateGroup[] = [];
  for (const group of titles.values()) {
    if (group.length < 2) continue;
    const authors = new Map<string, Profile[]>();
    for (const entry of group) for (const author of entry.authors.length ? entry.authors : ['']) addIndex(authors, author, entry);
    for (const entries of authors.values()) if (entries.length > 1) groups.push({ entries });
    const unknown = authors.get('');
    if (unknown?.length) { const known = group.filter(entry => entry.authors.length); if (known.length) groups.push({ entries: known, unknown }); }
  }
  // Identifiers and exact size multisets find copies despite conflicting tags.
  // Neither proves recording or byte identity; comparison still must.
  for (const field of ['isbn', 'asin', 'size'] as const) {
    const index = new Map<string, Profile[]>();
    for (const entry of profiles) {
      const value = field === 'size' ? entry.book.fileSizes : undefined;
      const identifier = field !== 'size' ? (entry.book.metadata[field] || '').replace(/[\s-]/g, '').toUpperCase() : '';
      const key = value ? value.length && value.every(size => Number.isFinite(size) && size > 0) ? value.length + ':' + [...value].sort((a, b) => a - b).join(',') : ''
        : field === 'isbn' ? /^(?:\d{13}|\d{9}[\dX])$/.test(identifier) ? identifier : '' : /^[A-Z0-9]{10}$/.test(identifier) ? identifier : '';
      if (key) addIndex(index, key, entry);
    }
    for (const entries of index.values()) if (entries.length > 1) groups.push({ entries, fallback: field });
  }
  function* pairs(group: CandidateGroup): Generator<[Profile, Profile]> {
    if (group.unknown) {
      for (const known of group.entries) for (const unknown of group.unknown) yield [known, unknown];
    } else {
      // Adjacent edges cover a whole group before the rest of its quadratic
      // pairs. Round-robin groups keep one popular title from filling the cap.
      for (let distance = 1; distance < group.entries.length; distance++)
        for (let i = 0; i + distance < group.entries.length; i++) yield [group.entries[i], group.entries[i + distance]];
    }
  }
  let pending = groups.map(group => ({ iterator: pairs(group), fallback: group.fallback }));
  while (pending.length && !full()) {
    const next: typeof pending = [];
    for (const group of pending) {
      if (full()) break;
      const pair = group.iterator.next();
      if (pair.done) continue;
      consider(pair.value[0], pair.value[1], group.fallback);
      next.push(group);
    }
    pending = next;
  }
  return matches;
}
