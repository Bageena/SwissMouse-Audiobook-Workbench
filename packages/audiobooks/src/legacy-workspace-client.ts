/** Adapter for the existing audiobook HTTP protocol during extraction.
 * These legacy response shapes are internal, not additional public SDK contracts.
 * It performs transport/error handling; confirmations, queues and state stay in the controller.
 */
export function createLegacyAudiobookWorkspaceClient(
  request: typeof fetch = (input, init) => fetch(input, init),
  readJson: (response: Response, operation: string) => Promise<any> = response => response.json(),
) {
  const job = (id: string, suffix = '') => `/api/jobs/${encodeURIComponent(id)}${suffix}`;
  const library = (id: string, suffix: string) => `/api/library/${encodeURIComponent(id)}${suffix}`;
  const post = (body?: object, catalog = false): RequestInit => ({ method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(catalog ? { 'X-SwissMouse-Catalog': '1' } : {}) },
  });
  async function exchange(path: string, options?: RequestInit, context?: string) {
    const response = await request(path, options);
    const data = context ? await readJson(response, context) : await response.json();
    return { response: { ok: response.ok, status: response.status }, data };
  }
  async function checked(path: string, options: RequestInit | undefined, fallback: string, context?: string) {
    const { response, data } = await exchange(path, options, context);
    if (!response.ok) throw new Error(data.error || fallback);
    return data;
  }
  return {
    libraryPage: (signal?: AbortSignal, context?: string) => exchange('/api/library?limit=50', { signal }, context),
    scanStatus: async (signal?: AbortSignal) => (await exchange('/api/library/scan-status', { signal })).data,
    async startProcessing(id: string, options: object) {
      const { response, data } = await exchange(job(id, '/process-step1'), post(options));
      if (!response.ok) throw new Error(data.error || data.message || 'Step 1 failed');
      return data;
    },
    async pipelineProgress() {
      const response = await request('/api/step1/progress');
      return { response: { ok: response.ok, status: response.status }, data: response.ok ? await response.json() : undefined };
    },
    saveSettings: (id: string, settings: object, failure = 'Could not save source settings.') => checked(job(id, '/step1-settings'), post(settings), failure),
    rerun: (id: string, step: string, confirmReplaceManualChapters: boolean) => exchange(job(id, `/rerun/${encodeURIComponent(step)}`), post({ confirmReplaceManualChapters })),
    inspectImport: (id: string) => checked(job(id, '/inspect-import'), post(), 'Could not read source metadata.'),
    startImport: () => checked('/api/jobs', post({ name: 'New book', importPending: true, parts: [] }), 'Could not start import.'),
    removeProject: (id: string, failure = 'Delete failed') => checked(job(id), { method: 'DELETE' }, failure),
    bookReadiness: (id: string) => exchange(job(id, '/book-files')),
    finishImport: (id: string, metadata: object, process: boolean, writeSource: boolean, expectedRevision: number) => checked(job(id, '/finish-import'), post({ metadata, process, writeSource, expectedRevision }), 'Could not finish import.'),
    organizePlan: (id: string) => checked(job(id, '/organize-library'), undefined, 'Could not plan the Library folder.'),
    organize: (id: string, source: string, target: string) => checked(job(id, '/organize-library'), post({ source, target }), 'Could not organize the Library folder.'),
    folderMovePlan: (id: string) => exchange(job(id, '/export-folder-move')),
    moveExportFolder: (id: string, confirmedMoves: readonly object[]) => exchange(job(id, '/export-folder-move'), post({ confirmedMoves })),
    exportProgress: (id: string, signal: AbortSignal) => exchange(job(id, '/export-progress'), { signal }),
    build: (id: string, options: object) => exchange(job(id, '/build-m4b'), post(options)),
    validate: (id: string) => checked(job(id, '/validate'), post(), 'Validation failed'),
    purgeProject: (id: string, purgeType: string, confirmation?: string) => checked(job(id, '/purge'), post({ purgeType, confirmation }), 'Cleanup failed'),
    saveLibraryMetadata: (changes: readonly object[]) => checked('/api/library/metadata', post({ changes }), 'Could not save library metadata.'),
    writeAudioMetadata: (id: string) => exchange(library(id, '/write-audio-metadata'), post()),
    sourceInformation: (id: string) => checked(job(id), undefined, 'Could not load the source information.'),
    relinkSource: (id: string, path: string, confirmSameRecording: boolean) => exchange(job(id, '/source-file'), post({ path, relink: true, confirmSameRecording })),
    openFolder: (id: string) => checked(library(id, '/open-folder'), post(), 'Could not open the book folder.'),
    refreshLibrary: () => checked('/api/library/refresh', post(undefined, true), 'Could not refresh the library.'),
    finish: (id: string, location: string, target: string) => checked(job(id, '/finish'), post({ location, target }), 'Could not finish this book.'),
    moveToLibrary: (id: string, mode: string, allowUnchecked: boolean) => checked(allowUnchecked ? library(id, '/send-to-library') : job(id, '/move-to-library'), post({ mode }, true), 'Could not move the book to Library.'),
    writeSavedMetadataJson: (id: string) => exchange(job(id, '/metadata-json'), post()),
    verifyAudio: (id: string) => checked(job(id, '/book-files/verify-audio'), post(), 'Could not recheck project audio.', 'Recheck project audio'),
  };
}
