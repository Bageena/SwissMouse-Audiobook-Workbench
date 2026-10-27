export type FileKind = 'audio' | 'video' | 'image' | 'document' | 'folder' | 'other';
export type FileView = 'details' | 'list' | 'small' | 'large';
export type MetadataColumn = 'title' | 'author' | 'narrator' | 'year';
export interface BrowserEntry {
  path: string; name: string; relativePath: string; type: 'file' | 'folder';
  sizeBytes?: number; modifiedMs?: number; durationSeconds?: number; audio?: boolean;
  stamp?: string;
  included?: boolean; unavailable?: boolean;
  metadata?: FileDetails;
}
export interface FileDetails {
  title?: string; author?: string; narrator?: string; year?: string;
  writable: MetadataColumn[]; durationSeconds?: number; error?: string;
}
const extensions: Record<Exclude<FileKind, 'folder' | 'other'>, Set<string>> = {
  audio: new Set('mp3 m4b m4a flac ogg opus wav aac aiff aif wma'.split(' ')),
  video: new Set('mp4 mkv avi mov webm m4v'.split(' ')),
  image: new Set('jpg jpeg png webp gif bmp avif svg'.split(' ')),
  document: new Set('pdf epub mobi azw azw3 txt md doc docx rtf cbz cbr'.split(' ')),
};
export function fileKind(entry: Pick<BrowserEntry, 'name' | 'type'>): FileKind {
  if (entry.type === 'folder') return 'folder';
  const ext = entry.name.split('.').pop()?.toLowerCase() || '';
  return (Object.keys(extensions) as (keyof typeof extensions)[]).find(kind => extensions[kind].has(ext)) || 'other';
}
export function visibleSelection(entries: BrowserEntry[], selected: Set<string>) {
  return entries.filter(entry => selected.has(entry.path));
}
export function selectFile(entries: BrowserEntry[], current: Set<string>, path: string, anchor: string | undefined, additive: boolean, range: boolean) {
  if (range && anchor) {
    const first = entries.findIndex(entry => entry.path === anchor), last = entries.findIndex(entry => entry.path === path);
    if (first >= 0 && last >= 0) return new Set([...(additive ? current : []), ...entries.slice(Math.min(first, last), Math.max(first, last) + 1).map(entry => entry.path)]);
  }
  if (!additive) return new Set([path]);
  const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next;
}
export const fileViews: { value: FileView; label: string }[] = [
  { value: 'details', label: 'Details' }, { value: 'list', label: 'List' },
  { value: 'small', label: 'Small Thumbnails' }, { value: 'large', label: 'Large Thumbnails' },
];
