/** HTTP transport only. Save ordering, drafts and navigation belong to the controller. */
export function createAudiobookClient(request: typeof fetch = (input, init) => fetch(input, init)) {
  return {
    async loadBook<T extends { id: string }>(id: string, options: { signal?: AbortSignal; failure?: string; allowUnavailable?: boolean } = {}): Promise<T | undefined> {
      const response = await request(`/api/jobs/${encodeURIComponent(id)}`, { signal: options.signal });
      if (!response.ok) {
        if (options.allowUnavailable) return undefined;
        throw new Error(options.failure || 'Could not open this book. Refresh the library and try again.');
      }
      const result = await response.json();
      if (result.id !== id) throw new Error('The loaded book did not match the requested book. Please try again.');
      return result;
    },
    async saveRating(bookId: string, rating: number | null): Promise<{ bookId: string; rating: number | null }> {
      const response = await request(`/api/jobs/${encodeURIComponent(bookId)}/personal-rating`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save your rating.');
      if (result.bookId !== bookId || result.rating !== rating) throw new Error('The saved rating did not match this book. Please try again.');
      return { bookId: result.bookId, rating: result.rating };
    },
    async saveMetadataDraft(jobId: string, metadata: Readonly<object>, expectedRevision: number): Promise<void> {
      const response = await request(`/api/jobs/${encodeURIComponent(jobId)}/metadata-draft`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata, expectedRevision }),
      });
      if (!response.ok) throw new Error('Could not save the metadata draft.');
    },
    async saveChapters(jobId: string, chapters: readonly object[]): Promise<void> {
      const response = await request(`/api/jobs/${encodeURIComponent(jobId)}/chapters`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chapters }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to save chapters');
    },
    async saveMetadata<TJob, TLibraryBook>(jobId: string, metadata: Readonly<object>, expectedRevision: number, selection?: import('../../sdk/suggestions').PickerSelection): Promise<{ job: TJob; libraryBook?: TLibraryBook; historyPending?:boolean }> {
      const response = await request(`/api/jobs/${encodeURIComponent(jobId)}/metadata`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata, expectedRevision,...(selection?{selection}:{}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to save metadata');
      return result;
    },
    async updateMetadataJson(jobId: string, metadata: Readonly<object>, expectedRevision: number): Promise<string[]> {
      const response = await request(`/api/jobs/${encodeURIComponent(jobId)}/metadata-json`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata, expectedRevision }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update metadata.json.');
      return result.written;
    },
  };
}

export const audiobookClient = createAudiobookClient();
