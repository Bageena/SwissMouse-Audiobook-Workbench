import type { AudiobookMetadata } from '../types';

export const DEFAULT_LIBRARY_TEMPLATE = '%Author%/%Series%/%Series Number% %Book Title% [%Narrator%]';
export const LIBRARY_FIELDS = ['Author', 'Series', 'Series Number', 'Book Title', 'Narrator', 'Subtitle'] as const;

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

export function libraryRelativePath(template: string, metadata: AudiobookMetadata): string[] {
  const error = validateLibraryTemplate(template);
  if (error) throw new Error(error);
  const sequence = metadata.seriesSequence?.trim() || '';
  const values: Record<typeof LIBRARY_FIELDS[number], string> = {
    Author: metadata.author || 'Unknown Author',
    Series: metadata.series || '',
    'Series Number': sequence ? /^\d+$/.test(sequence) ? sequence.padStart(3, '0') : sequence : '',
    'Book Title': metadata.title || 'Untitled Audiobook',
    Narrator: metadata.narrator || '',
    Subtitle: metadata.subtitle || '',
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
