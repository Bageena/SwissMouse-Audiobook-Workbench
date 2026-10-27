// Discovery evidence only: these groups never authorize project membership.
export interface GroupFile {
  relativePath: string;
  tags?: Record<string, string>;
  trackNumber?: number;
  discNumber?: number;
}
export interface BookGroup { id: string; title: string; author: string; directory: string; files: string[]; evidence: string }
function withoutSequence(value: string): string {
  return value
    .replace(/\(\s*\d+\s*(?:of|\/)\s*\d+\s*\)\s*$/i, '')
    .replace(/\(\s*\d{1,3}\s*\)\s*$/, '')
    .replace(/(?:[\s._(\[-]+|^)(?:part|disc|disk|cd|volume|vol)\s*[._-]*\d+(?:\s*(?:of|\/)\s*\d+)?\s*[)\]]?\s*$/i, '')
    .trim();
}
export function normalizeBookTitle(value: string): string {
  return withoutSequence(value.normalize('NFKC').toLowerCase())
    .replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const normalizeLabel = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const collectionLabel = /\b(?:books?|vol(?:ume)?s?|series|saga|trilogy|collection|omnibus|complete|anthology|set)\b/i;
function parentBookTitle(value: string): string {
  // Square brackets commonly annotate the narrator or audio format. Keep
  // collection and volume annotations, which may identify a different book.
  return value.replace(/\s*\[([^\]]+)\]\s*$/, (suffix, annotation: string) =>
    collectionLabel.test(annotation) || (/\d/.test(annotation) && !/\b(?:mp3|m4[ab]|flac|aac|opus|ogg|wav|kbps|khz|bits?)\b/i.test(annotation)) ? suffix : '').trim();
}
type MultipartTitle = { title: string; number: number; total?: number; bare: boolean };
function multipartTitle(value: string): MultipartTitle | undefined {
  const match = /^(.*?)\s*(?:\(\s*(\d+)\s*(?:of|\/)\s*(\d+)\s*\)|(?:[\s._(\[-]+|^)(?:part|disc|disk|cd)\s*[._-]*(\d+)(?:\s*(?:of|\/)\s*(\d+))?\s*[)\]]?|\(\s*(\d{1,3})\s*\))\s*$/i.exec(value);
  if (!match) return undefined;
  const number = Number(match[2] || match[4] || match[6]);
  const total = Number(match[3] || match[5]) || undefined;
  if (!number || (total && total < number)) return undefined;
  return { title: match[1].trim(), number, total, bare: !!match[6] };
}
export function isSequenceFolder(value: string, parentTitle?: string): boolean {
  if (/^(?:(?:disc|disk|cd|part|chapters?|track)[\s._-]*\d+(?:\s*[-._ ]\s*.*)?|\d{1,3}|\d{1,3}(?:%7c|[\s._|-])+(?:disc|disk|cd|part|chapters?|track)\b.*)$/i.test(value)) return true;
  // A named series entry is not a disc folder. Only repeated book names under
  // their own book folder may inherit that folder's membership.
  const part = multipartTitle(value);
  if (!part || part.bare || !part.title || !parentTitle) return false;
  const title = normalizeLabel(part.title);
  const parentName = parentBookTitle(parentTitle);
  const parent = normalizeLabel(parentName);
  if (title === parent || parent.startsWith(`${title} by `)) return true;
  if (parent.startsWith(`${title} `)) {
    const qualifier = parent.slice(title.length + 1);
    if (/^(?:(?:special )?(?:\d+(?:st|nd|rd|th) )?anniversary edition|(?:revised|expanded|updated|illustrated|special) edition|unabridged|abridged)(?: (?:unabridged|abridged))?$/.test(qualifier)) return true;
  }
  // Also recognize "Book title - Author Name", but never a numbered sequel
  // or a collection label after the separator.
  const separated = /^(.*?)\s+[-–—]\s+(.+)$/.exec(parentName);
  return !!separated && normalizeLabel(separated[1]) === title && !collectionLabel.test(separated[2]) &&
    /^[\p{L}\p{M}.'’ -]+$/u.test(separated[2]) && normalizeLabel(separated[2]).split(' ').length > 1;
}
export function probableBookGroups(files: GroupFile[], rootTitle?: string): BookGroup[] {
  const groups = new Map<string, BookGroup>();
  const wholeBooks = new Map<string, { group: BookGroup; candidates: { file: string; title: string; part?: MultipartTitle }[] }>();
  const observed = new Set<string>();
  for (const file of files) {
    const relative = file.relativePath.replace(/\\/g, '/');
    if (observed.has(relative)) continue;
    observed.add(relative);
    const segments = relative.split('/');
    const stem = segments.pop()!.replace(/\.[^.]+$/, '');
    let folderPart: MultipartTitle | undefined;
    while (segments.length && isSequenceFolder(segments[segments.length - 1], segments.length === 1 ? rootTitle : segments[segments.length - 2])) {
      folderPart ||= multipartTitle(segments[segments.length - 1]);
      segments.pop();
    }
    const directory = segments.join('/');
    const tags = Object.fromEntries(Object.entries(file.tags || {}).map(([key, value]) => [key.toLowerCase(), value]));
    const namedBook = /^(.+?)\s+-\s+\d{4}\s+-\s+(.+)$/.exec(stem);
    const author = tags.author || tags.album_artist || tags.albumartist || tags.artist || namedBook?.[1] || '';
    const format = relative.match(/\.([^.]+)$/)?.[1].toLowerCase() || '';
    if (format === 'm4b') {
      const filenameTitle = namedBook?.[2] || stem;
      // An M4B normally contains a complete book. Shared album/series tags,
      // track numbers and even identical titles are not multipart evidence.
      const part = multipartTitle(filenameTitle) || multipartTitle(tags.title || '') || folderPart;
      const displayTitle = tags.title || filenameTitle || tags.album || directory;
      const partTitle = part?.title || tags.title || filenameTitle;
      const narrator = tags.narrator || tags.composer || '';
      const key = JSON.stringify([directory.toLowerCase(), normalizeBookTitle(author), normalizeBookTitle(part ? partTitle : displayTitle), format, narrator.toLowerCase()]);
      const pending = wholeBooks.get(key) || { group: { id: key, title: part ? partTitle : displayTitle, author, directory, files: [], evidence: 'Explicit multipart filenames or titles' }, candidates: [] };
      pending.candidates.push({ file: relative, title: displayTitle, part });
      wholeBooks.set(key, pending);
      continue;
    }
    const album = normalizeBookTitle(tags.album || '');
    // Track titles describe chapters, not necessarily the book. Whole-file titles
    // and multipart filenames are useful when no album is present.
    const numbered = /^(?:(?:track|chapter)\s*[._-]*)?\d{1,3}(?:%7c|[\s._|-]|$)/i.test(stem) || (!!file.trackNumber && !/\.m4[ab]$/i.test(relative));
    const displayTitle = withoutSequence(tags.album || (numbered ? '' : tags.title || namedBook?.[2] || stem));
    const title = normalizeBookTitle(displayTitle);
    const identity = title || normalizeBookTitle(directory) || 'numbered tracks';
    // Different formats are alternative representations, never consecutive parts.
    const key = JSON.stringify([directory.toLowerCase(), normalizeBookTitle(author), identity, format]);
    const group = groups.get(key) || { id: key, title: displayTitle || directory || rootTitle || 'Numbered tracks', author, directory, files: [],
      evidence: album ? 'Matching album, author and folder' : numbered ? 'Numbered tracks in the same book folder' : 'Matching title and folder' };
    // Repeated observations were removed above without scanning each group.
    group.files.push(relative);
    groups.set(key, group);
  }
  for (const { group, candidates } of wholeBooks.values()) {
    const parts = candidates.filter(candidate => candidate.part);
    const numbers = new Set(parts.map(candidate => candidate.part!.number));
    const totals = new Set(parts.map(candidate => candidate.part!.total).filter(Boolean));
    // Ambiguous duplicate part numbers or a complete book next to '(1)' copies
    // remain individual books for duplicate review, never a concatenation.
    if (parts.length > 1 && parts.length === candidates.length && numbers.size === parts.length && totals.size <= 1) {
      group.files = parts.sort((a, b) => a.part!.number - b.part!.number).map(candidate => candidate.file);
      groups.set(group.id, group);
    } else for (const candidate of candidates) {
      const id = JSON.stringify([group.id, candidate.file]);
      groups.set(id, { ...group, id, title: candidate.title, files: [candidate.file], evidence: 'Separate audiobook file' });
    }
  }
  const discoveryOrder = new Map([...observed].map((file, index) => [file, index]));
  return [...groups.values()].sort((a, b) => discoveryOrder.get(a.files[0])! - discoveryOrder.get(b.files[0])!);
}
