/** Module-owned session coordination. No React, dialogs, host imports or durable store. */
export interface ChapterDraft<C> { jobId: string; chapters: C[]; hasEdits?: boolean }
export interface MetadataDraft<M> { jobId: string; metadata: M }
export function createAudiobookEditController<M, C>(ports: {
  revision: (id: string) => number;
  writeDraft: (id: string, metadata: M, revision: number) => Promise<void>;
  writeRating: (id: string, rating: number | null) => Promise<{ rating: number | null }>;
  ratingSaved: (id: string, rating: number | null) => void;
}) {
  let draftWrite: Promise<void> = Promise.resolve();
  const ratingWrites = new Map<string, Promise<void>>();
  const ratingVersions = new Map<string, number>();
  const savedRatings = new Map<string, number | null>();
  let preparation: Promise<boolean> | undefined;
  let navigationGeneration = 0;
  let navigationRead = new AbortController();
  const state = {
    chapterDraft: null as ChapterDraft<C> | null,
    metadataDraft: null as MetadataDraft<M> | null,
    beginNavigation: () => {
      navigationRead.abort();
      navigationRead = new AbortController();
      return ++navigationGeneration;
    },
    navigationSignal: () => navigationRead.signal,
    cancelReads: () => { navigationRead.abort(); ++navigationGeneration; },
    isCurrentNavigation: (generation: number) => generation === navigationGeneration,
    withSavedRating<T extends { id: string; personalRating?: number | null }>(book: T): T {
      return savedRatings.has(book.id) ? { ...book, personalRating: savedRatings.get(book.id)! } : book;
    },
    withCurrentDraft<T extends { id: string; metadataDraft?: M }>(book: T): T {
      return state.metadataDraft?.jobId === book.id ? { ...book, metadataDraft: state.metadataDraft.metadata } : book;
    },
    metadataSaved(id: string, metadata: M) {
      if (state.metadataDraft?.jobId === id && state.metadataDraft.metadata === metadata) state.metadataDraft = null;
    },
    saveRating(id: string, rating: number | null): Promise<void> {
      const version = (ratingVersions.get(id) || 0) + 1;
      ratingVersions.set(id, version);
      const write = (ratingWrites.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
        const result = await ports.writeRating(id, rating);
        if (ratingVersions.get(id) !== version) return;
        savedRatings.set(id, result.rating);
        ports.ratingSaved(id, result.rating);
      });
      ratingWrites.set(id, write);
      void write.finally(() => { if (ratingWrites.get(id) === write) ratingWrites.delete(id); }).catch(() => {});
      return write;
    },
    saveDraft(id: string, metadata: M): Promise<void> {
      const expectedRevision = ports.revision(id);
      const write = draftWrite.catch(() => {}).then(() => ports.writeDraft(id, metadata, expectedRevision));
      draftWrite = write;
      return write;
    },
    /** Explicit final saves may recover a failed debounce; navigation never ignores it. */
    settleDraft: () => draftWrite.catch(() => {}),
    async flushDraft(id: string): Promise<void> {
      let draft = state.metadataDraft;
      if (draft?.jobId !== id) { await draftWrite; return; }
      while (draft?.jobId === id) {
        const metadata = draft.metadata;
        await state.saveDraft(id, metadata);
        draft = state.metadataDraft;
        if (draft?.jobId !== id || draft.metadata === metadata) return;
      }
    },
    prepareToLeave(ports: {
      id?: string;
      chaptersChanged: (draft: ChapterDraft<C>) => boolean;
      confirmChapters: () => boolean;
      saveChapters: (chapters: C[]) => Promise<void>;
      stopPlayback: () => Promise<void>;
    }): Promise<boolean> {
      if (preparation) return preparation;
      const prepare = (async () => {
        let draft = state.chapterDraft;
        if (ports.id && draft?.jobId === ports.id && ports.chaptersChanged(draft)) {
          if (!ports.confirmChapters()) return false;
          while (draft?.jobId === ports.id) {
            const chapters = draft.chapters;
            await ports.saveChapters(chapters);
            draft = state.chapterDraft;
            if (draft?.chapters === chapters) break;
          }
        }
        await ports.stopPlayback();
        if (ports.id) await state.flushDraft(ports.id);
        if (ports.id) await ratingWrites.get(ports.id);
        return true;
      })();
      preparation = prepare;
      void prepare.finally(() => { if (preparation === prepare) preparation = undefined; }).catch(() => {});
      return prepare;
    },
  };
  return state;
}
