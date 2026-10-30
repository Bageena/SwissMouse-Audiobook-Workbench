import type { AudiobookMetadata, ChapterEntry } from './domain';
import { audiobookshelfMetadata } from './audiobookshelf-metadata';

export const EXTENDED_METADATA_FILE = 'exmetadata.json';
export const fileTagFields = ['title','subtitle','author','narrator','authors','narrators','series','seriesSequence','edition','genres','tags','publishedYear','releaseDate','publisher','language','isbn','asin','description','abridged','explicit','copyright'] as const;
export { cleanMemberships } from './memberships';
import { cleanMemberships } from './memberships';
/** fileTags are the values offered to the media tag writer; internal values never enter it. */
export function extendedMetadata(metadata: AudiobookMetadata, chapters: ChapterEntry[] = [], resourceId?: string) {
  return { format:'swissmouse.extended-metadata', schemaVersion:1, resourceId,
    metadata:audiobookshelfMetadata(metadata,chapters),
    fileTags:Object.fromEntries(fileTagFields.filter(field => metadata[field] !== undefined).map(field => [field,metadata[field]])),
    internal:{ seriesAddedAt:metadata.seriesAddedAt, collections:cleanMemberships(metadata.collections), additionalSeries:cleanMemberships(metadata.additionalSeries), ...(metadata.cover !== undefined ? { cover:metadata.cover } : {}) },
  };
}
export function readExtendedMetadata(json: unknown): Record<string, unknown> {
  const data = json as ReturnType<typeof extendedMetadata>;
  if (!data || data.format !== 'swissmouse.extended-metadata' || data.schemaVersion !== 1 || !data.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata) || !data.fileTags || typeof data.fileTags !== 'object') throw new Error('Unsupported or invalid exmetadata.json format');
  return { ...data.metadata, ...data.fileTags,
    ...(typeof data.internal?.seriesAddedAt === 'string' ? { seriesAddedAt:data.internal.seriesAddedAt } : {}),
    ...(data.internal?.collections !== undefined ? { collections:cleanMemberships(data.internal.collections) } : {}),
    ...(data.internal?.additionalSeries !== undefined ? { additionalSeries:cleanMemberships(data.internal.additionalSeries) } : {}),
    ...(data.internal?.cover !== undefined ? { cover:data.internal.cover } : {}),
  };
}
