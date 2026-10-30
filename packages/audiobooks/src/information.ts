import type { InformationBundle, InformationDefinition, InformationField, InformationReadItem, ReadValue } from '../../sdk/information';
import type { LibraryBook } from './legacy-domain';

const base = { owner: 'audiobooks', definitionVersion: 1, public: true } as const;
const textFields = ['author-text', 'narrator-text', 'series', 'series-sequence', 'published-year', 'publisher', 'language'];
const manyFields = ['authors', 'narrators', 'genres', 'tags', 'collections', 'additional-series'];
const allFields = [...textFields, ...manyFields, 'personal-rating', 'explicit'];
const field = (name: string): InformationField => ({ ...base, definition: 'field', id: `audiobooks.${name}`, label: name,
  target: 'resource', appliesTo: ['audiobooks.book'], cardinality: manyFields.includes(name) ? 'many' : 'one',
  valueType: name === 'personal-rating' ? 'decimal' : name === 'explicit' ? 'boolean' : 'text',
  filterOperators: ['eq', 'in'], sortable: !manyFields.includes(name) });
export const audiobookInformationBundle: InformationBundle = {
  owner: 'audiobooks', prototypeVersion: 1,
  definitions: [
    { ...base, definition: 'type', id: 'audiobooks.book', label: 'Audiobook work', baseKind: 'core.work', fieldIds: ['core.title', ...allFields.map(id => `audiobooks.${id}`)], relationshipIds: ['core.edition-of'], taxonomyIds: ['audiobooks.genre'] },
    { ...base, definition: 'type', id: 'audiobooks.recording', label: 'Audiobook recording', baseKind: 'core.recording', fieldIds: ['core.title'], relationshipIds: ['core.edition-of'], taxonomyIds: [] },
    ...allFields.map(field),
    { ...base, definition: 'taxonomy', id: 'audiobooks.genre', label: 'Audiobook genres', appliesTo: ['audiobooks.book'], hierarchy: 'flat', maxDepth: 0, cardinality: 'many', userCreatedTerms: true },
    ...['authors', 'narrators', 'series', 'genres', 'tags', 'collections', 'additional-series'].map(name => ({ ...base, definition: 'provider', id: `audiobooks.suggest-${name}`, label: `${name} suggestions`,
      fieldId: `audiobooks.${name}`, valueKind: 'text', matching: ['prefix', 'contains'], minimumContainsLength: 3, defaultLimit: 20, maxLimit: 100 } as InformationDefinition)),
    { ...base, definition: 'view', id: 'audiobooks.library', label: 'Audiobook library', typeIds: ['audiobooks.book'], modes: ['list', 'grid', 'shelf'],
      columnIds: ['core.title', 'audiobooks.authors', 'audiobooks.series'], filterIds: ['audiobooks.genres', 'audiobooks.authors'] },
  ],
};

/** Read bridge over an existing bounded catalog summary; never loads a job or probes files.
 * Genres remain text observations here: no canonical taxonomy term IDs are invented. */
export function audiobookInformationItem(book: LibraryBook, catalogRevision: number, options: { complete?: boolean } = {}): InformationReadItem {
  if (!book.resourceId || !book.recordingId) throw new Error('Existing catalog identities are required.');
  const fields: Record<string, ReadValue> = { 'core.title': book.name };
  const omitted: string[] = [];
  const text = (id: string, value: unknown) => { if (typeof value === 'string') fields[`audiobooks.${id}`] = value; };
  const values = (id: string, value: unknown) => {
    if (!Array.isArray(value)) return;
    if ((!options.complete && value.length > 128) || value.some(item => typeof item !== 'string')) { omitted.push(`audiobooks.${id}`); return; }
    fields[`audiobooks.${id}`] = [...value];
  };
  const m = book.metadata;
  text('author-text', m.author); text('narrator-text', m.narrator);
  // Preserve contributor arrays exactly. A legacy scalar name containing commas is
  // one unresolved text value; it is not evidence for multiple person identities.
  values('authors', m.authors ?? (m.author ? [m.author] : [])); values('narrators', m.narrators ?? (m.narrator ? [m.narrator] : []));
  values('genres', m.genres); values('tags', m.tags);
  text('series', m.series); text('series-sequence', m.seriesSequence); text('published-year', m.publishedYear); text('publisher', m.publisher); text('language', m.language);
  if (typeof m.explicit === 'boolean') fields['audiobooks.explicit'] = m.explicit;
  if (typeof book.personalRating === 'number' && Number.isFinite(book.personalRating)) fields['audiobooks.personal-rating'] = book.personalRating;
  const memberships: InformationReadItem['memberships'][number][] = [];
  for (const [name, entries] of [['collections', m.collections], ['additional-series', m.additionalSeries]] as const) {
    if (!entries) continue;
    if (!options.complete && entries.length > 100) omitted.push(`audiobooks.${name}`);
    const bounded = options.complete ? entries : entries.slice(0, 100);
    fields[`audiobooks.${name}`] = bounded.map(entry => entry.name);
    for (const entry of bounded) memberships.push({ providerId: `audiobooks.suggest-${name}`, legacyId: entry.id, label: entry.name, ...(entry.sequence !== undefined ? { sequence: entry.sequence } : {}) });
  }
  const representations = [...new Set([book.recordingId, ...(book.representations || []).map(item => item.resourceId).filter(Boolean)])];
  if (!options.complete && representations.length > 100) omitted.push('core.edition-of');
  return {
    descriptor: { id: book.resourceId, kind: 'core.work', typeIds: ['core.work', 'audiobooks.book'], owner: 'audiobooks', title: book.name,
      revision: catalogRevision, revisionScope: 'catalog-snapshot', archived: false },
    fields, memberships, omitted,
    relationships: (options.complete ? representations : representations.slice(0, 100)).map(fromId => ({ fromId, toId: book.resourceId, relationshipId: 'core.edition-of' })),
  };
}
