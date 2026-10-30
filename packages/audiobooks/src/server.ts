import type { ServerSdk, ServerContribution } from '@swissmouse/sdk';

/** Domain interpretation stays in the module; the host only supplies a snapshot. */
export function activate(sdk: ServerSdk): ServerContribution {
  return { reads: { 'audiobooks.summary': async ({ resourceId }) => {
    if (!resourceId) throw new Error('Open a resource before requesting book information.');
    const record = await sdk.readRecord(resourceId);
    if (!record) throw new Error('The saved book is unavailable.');
    const metadata = (record.metadata || {}) as Record<string, unknown>;
    const text = (value: unknown) => typeof value === 'string' ? value : '';
    const people = (value: unknown) => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
    return { id: resourceId, title: text(metadata.title) || text(record.name), metadata: {
      title: text(metadata.title), author: text(metadata.author) || text(record.author), narrator: text(metadata.narrator),
      authors: people(metadata.authors), narrators: people(metadata.narrators), publishedYear: text(metadata.publishedYear),
    } };
  } } };
}
