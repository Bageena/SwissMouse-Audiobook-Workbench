import type { LibraryBook } from '../types';

export type LibraryFilters = { creator: string; narrator: string; series: string; tag: string; format: string };
export const emptyLibraryFilters: LibraryFilters = { creator: '', narrator: '', series: '', tag: '', format: '' };
export type LibraryCollection = { id: string; name: string; bookIds: string[]; count?: number };
export type SavedLibrarySearch = { id: string; name: string; root: 'inbox' | 'library' | 'workbench'; query: string; filters: LibraryFilters; availability: 'available' | 'missing' | 'all'; sort: string; descending: boolean; collectionId?: string };
export function readStored<T>(key: string, fallback: T, session = false): T {
  try { const value = (session ? sessionStorage : localStorage).getItem(key); return value === null ? fallback : JSON.parse(value) as T; } catch { return fallback; }
}
export function writeStored(key: string, value: unknown, session = false) {
  try { (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
const text = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
export function matchesLibraryFilters(book: LibraryBook, filters: LibraryFilters, query = '') {
  const metadata = book.metadata;
  const tags = [...(metadata.tags || []), ...(metadata.genres || [])];
  const searchable = [book.name, metadata.title, metadata.subtitle, metadata.author, ...(metadata.authors || []), metadata.narrator, ...(metadata.narrators || []), metadata.series, metadata.description, ...tags, ...(book.formats || [])];
  const contains = (value: unknown, term: string) => !text(term) || text(value).includes(text(term));
  return contains(searchable.join(' '), query)
    && contains([metadata.author, ...(metadata.authors || [])].join(' '), filters.creator)
    && contains([metadata.narrator, ...(metadata.narrators || [])].join(' '), filters.narrator)
    && contains(metadata.series, filters.series)
    && contains(tags.join(' '), filters.tag)
    && (!filters.format || (book.formats || []).some(format => text(format) === text(filters.format)));
}
export function validFilters(value: unknown): LibraryFilters {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.keys(emptyLibraryFilters).map(key => [key, typeof record[key] === 'string' ? record[key].slice(0, 500) : ''])) as LibraryFilters;
}
export function loadCollections(): LibraryCollection[] {
  const value = readStored<unknown>('swissmouse-collections', []);
  return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.bookIds)).map(item => ({ id: item.id, name: item.name.slice(0, 100), bookIds: [...new Set<string>(item.bookIds.filter((id: unknown) => typeof id === 'string'))] })) : [];
}
export function loadSavedSearches(): SavedLibrarySearch[] {
  const value = readStored<unknown>('swissmouse-saved-searches', []);
  return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && ['inbox', 'library', 'workbench'].includes(item.root)).map(item => ({ id: item.id, name: item.name.slice(0, 100), root: item.root, query: typeof item.query === 'string' ? item.query.slice(0, 500) : '', filters: validFilters(item.filters), availability: ['available', 'missing', 'all'].includes(item.availability) ? item.availability : 'available', sort: typeof item.sort === 'string' ? item.sort : 'title', descending: item.descending === true, collectionId: typeof item.collectionId === 'string' ? item.collectionId : undefined })) : [];
}

export type LibraryBrowseSnapshot = { root?: string; view?: string; query?: string; sort?: string; descending?: boolean; availability?: string; page?: number; catalogOffset?: number; scrollTop?: number; windowScroll?: number; selected?: string[]; filters?: LibraryFilters; collectionId?: string };
export function loadLibraryBrowse(): LibraryBrowseSnapshot {
  const raw = readStored<unknown>('swissmouse-library-workspace', {}, true);
  if (!raw || typeof raw !== 'object') return {};
  const v = raw as Record<string, unknown>;
  return { root: ['inbox', 'library', 'workbench'].includes(String(v.root)) ? String(v.root) : undefined, view: ['cover', 'list', 'edit'].includes(String(v.view)) ? String(v.view) : undefined,
    query: typeof v.query === 'string' ? v.query.slice(0, 500) : '', sort: typeof v.sort === 'string' ? v.sort : 'title', descending: v.descending === true,
    availability: ['available', 'missing', 'all'].includes(String(v.availability)) ? String(v.availability) : 'available',
    page: typeof v.page === 'number' && Number.isFinite(v.page) ? Math.max(0, Math.floor(v.page)) : 0,
    catalogOffset: typeof v.catalogOffset === 'number' && Number.isSafeInteger(v.catalogOffset) ? Math.max(0,v.catalogOffset) : 0,
    scrollTop: typeof v.scrollTop === 'number' && Number.isFinite(v.scrollTop) ? Math.max(0, v.scrollTop) : 0,
    windowScroll: typeof v.windowScroll === 'number' && Number.isFinite(v.windowScroll) ? Math.max(0, v.windowScroll) : 0,
    selected: Array.isArray(v.selected) ? [...new Set<string>(v.selected.filter(id => typeof id === 'string'))] : [], filters: validFilters(v.filters), collectionId: typeof v.collectionId === 'string' ? v.collectionId : '' };
}
