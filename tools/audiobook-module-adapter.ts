import type { AudiobookJob } from '../src/types';

/** Temporary composition adapter. No transcript, audio, cover bytes or mutable project escapes. */
export function audiobookReadAdapter(get: (id: string) => AudiobookJob | undefined) {
  return async (id: string): Promise<Readonly<Record<string, unknown>> | undefined> => {
    const job = get(id);
    if (!job) return undefined;
    return JSON.parse(JSON.stringify({ id: job.id, name: job.name, author: job.author, metadata: { ...job.metadata, cover: undefined } }));
  };
}
