import { metadataFromTags } from './audio-metadata';

const normalize = (value: unknown) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

/** Tags are evidence, never a global identity key. Missing tags require human confirmation. */
export function checkRelinkIdentity(expected: { title?: string; narrator?: string }, sources: Record<string, unknown>[], single: boolean) {
  let incomplete = !sources.length;
  for (const tags of sources) {
    const found = metadataFromTags(tags, '', single);
    for (const field of ['title', 'narrator'] as const) {
      const before = normalize(expected[field]), after = normalize(found[field]);
      if (before && after && before !== after) return {
        code: 'RELINK_DIFFERENT_RECORDING',
        error: `The selected audio has a different ${field}: “${found[field]}”. Import it as a new book to keep the original project separate.`,
      };
      if (!before || !after) incomplete = true;
    }
  }
  return incomplete ? {
    code: 'RELINK_CONFIRM_IDENTITY',
    error: 'The audio tags cannot confirm both the book and narrator. Have you checked that this is the same book and the same narrator?',
  } : null;
}
