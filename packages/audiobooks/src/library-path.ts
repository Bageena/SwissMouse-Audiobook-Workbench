import type { AudiobookMetadata } from './domain';
import { metadataPeople } from './metadata-people';

export const DEFAULT_LIBRARY_TEMPLATE = '%Author%/%Series%/%Series Number% %Book Title% [%Narrator%]';
export const LIBRARY_FIELDS = ['Author', 'Series', 'Series Number', 'Book Title', 'Narrator', 'Subtitle', 'Year', 'Publisher', 'Edition'] as const;

const token = /%([^%]+)%/g;
const safePart = (value: string) => {
  const cleaned = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/[. ]+$/g, '').trim();
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(cleaned) ? `_${cleaned}` : cleaned;
};

export function validateLibraryTemplate(template: string): string | null {
  if (!template.trim()) return 'Enter a folder pattern.';
  if (pathIsAbsolute(template) || template.split(/[\\/]/).some(part => part.trim() === '..')) return 'Use a relative folder pattern.';
  const fields = [...template.matchAll(token)].map(match => match[1]);
  if (fields.some(field => !LIBRARY_FIELDS.includes(field as typeof LIBRARY_FIELDS[number]))) return 'Use only the listed metadata fields.';
  if (template.replace(token, '').includes('%')) return 'Complete each metadata tag with a closing %.';
  return null;
}

function pathIsAbsolute(value: string) { return /^[\\/]/.test(value) || /^[a-zA-Z]:/.test(value); }

/** Short filesystem credit only; never replace the stored narrator credits. */
export function narratorPathCredit(metadata: AudiobookMetadata): string {
  const structured = metadata.narrators?.join(', ') === metadata.narrator;
  const seen = new Set<string>();
  const names = metadataPeople(metadata, 'narrator').flatMap(value => structured ? [value] : value.split(';'))
    .map(value => value.trim()).filter(value => {
      const key = value.toLocaleLowerCase('en');
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
  return names.length > 3 ? 'Full Cast' : names.length > 1 ? 'Cast' : names[0] || '';
}

export function libraryRelativePath(template: string, metadata: AudiobookMetadata): string[] {
  const error = validateLibraryTemplate(template);
  if (error) throw new Error(error);
  const sequence = metadata.seriesSequence?.trim() || '';
  const values: Record<typeof LIBRARY_FIELDS[number], string> = {
    Author: metadata.author || 'Unknown Author',
    Series: metadata.series || '',
    'Series Number': sequence ? /^\d+$/.test(sequence) ? sequence.padStart(3, '0') : sequence : '',
    'Book Title': metadata.title || 'Untitled Audiobook',
    Narrator: narratorPathCredit(metadata),
    Subtitle: metadata.subtitle || '',
    Year: metadata.publishedYear || '',
    Publisher: metadata.publisher || '',
    Edition: metadata.edition || '',
  };
  const parts = template.split(/[\\/]/).map(segment => {
    // A missing field drops its surrounding brackets and leaves no empty directory.
    const filled = segment.replace(/\s*\[%([^%]+)%\]/g, (_, field: string) => values[field as keyof typeof values] ? ` [${safePart(values[field as keyof typeof values])}]` : '');
    return safePart(filled.replace(token, (_, field: string) => safePart(values[field as keyof typeof values] || ''))
      .replace(/\s{2,}/g, ' ').replace(/^[-– ]+|[-– ]+$/g, ''));
  }).filter(Boolean);
  if (!parts.length) throw new Error('The folder pattern needs at least one value for this book.');
  return parts;
}

/** Processing workspaces are never final export destinations. */
export function finalOutputRoot(configured: string | undefined, libraryRoot: string): string {
  return configured?.trim() && !configured.split(/[\\/]/).some(part => part.toLowerCase() === '.swissmouse-work') ? configured : libraryRoot;
}

export function libraryLocationPreview(root: string, template: string, metadata: AudiobookMetadata): string {
  const sequence = metadata.seriesSequence?.trim();
  const values: Record<string, string | undefined> = {
    Author: metadata.author, Series: metadata.series, 'Series Number': sequence && (/^\d+$/.test(sequence) ? sequence.padStart(3, '0') : sequence),
    'Book Title': metadata.title, Narrator: narratorPathCredit(metadata), Subtitle: metadata.subtitle,
    Year: metadata.publishedYear, Publisher: metadata.publisher, Edition: metadata.edition,
  };
  const folder = root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root;
  return folder + '\\' + template.replace(token, (placeholder, field: string) => values[field]?.trim() ? safePart(values[field]!) : placeholder);
}
