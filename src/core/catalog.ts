import type { LibraryBook } from '../types';
import type { LibraryFilters } from '../utils/libraryWorkspace';

export const catalogSorts = ['title', 'author', 'narrator', 'series', 'seriesSequence', 'publishedYear', 'createdAt', 'metadataUpdatedAt'] as const;
export interface CatalogQuery {
  root?: 'inbox' | 'library' | 'workbench';
  availability?: 'available' | 'missing' | 'all';
  query?: string;
  filters?: Partial<LibraryFilters>;
  sort?: (typeof catalogSorts)[number];
  descending?: boolean;
  collectionId?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  windowStep?: number;
}
export interface CatalogPage {
  items: LibraryBook[];
  total: number;
  offset: number;
  nextCursor?: string;
  windowCursor?: string;
  revision: number;
}
export interface CatalogSelection { token: string; count: number; revision: number; hasGroups?: boolean }
export interface CatalogCollection { id: string; name: string; bookIds: string[]; count?: number }

export function normalizeCatalogText(value: unknown): string {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
}

/** Stable natural sort key, independent of a machine's locale. IDs break remaining ties. */
export function catalogSortKey(value: unknown): string {
  return normalizeCatalogText(value).replace(/\d+/g, digits => {
    const significant = digits.replace(/^0+/, '') || '0';
    return `\u0001${String(significant.length).padStart(6, '0')}:${significant}`;
  });
}
