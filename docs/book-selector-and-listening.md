# Header book selector and listening

The existing header selector now displays the saved cover, title, author/narrator credits, publication year when present, personal rating, and Quick Player. Switch book still returns to Library Manager. The single Import Book entry and tools menu remain available.

## Components and integration

- `src/components/Header.tsx` hosts `BookSelector.tsx`. `BookCover.tsx`, `BookInformation.tsx`, `PersonalRating.tsx`, and `QuickPlayer.tsx` are reusable presentation components using the existing theme.
- `src/utils/personalRating.ts` handles half-star hit testing, keyboard input, drag previews, and ordered persistence. Double-click clearing remains the final write even when earlier click requests are slow.
- `src/playback/QuickPlaybackController.ts` owns one native streaming HTML audio player, media transitions, cumulative time, checkpoint retries, and cancellation. `useQuickPlayback.ts` subscribes only the player UI to its external store; progress does not rerender the application/library.
- `src/playback/types.ts` and `timeline.ts` define the shared logical timeline and bookmark mapping. `tools/book-playback.ts` builds manifests using cached media-header inspection.
- `tools/playback-routes.ts` exposes authorized range streams and personal-data endpoints. `server.ts` supplies existing project/path/probe services and records export provenance.
- `src/App.tsx` awaits playback saving and metadata draft persistence before switching, offers to save unsaved chapter edits, and rejects stale open responses. Delayed rating, source inspection, and transfer results stay bound to their original book.

## Personal rating

`AudiobookJob.personalRating` in the existing project store is an integer from 0 through 10 (half stars), or `null` for explicitly unrated. Older records without the field are displayed as unrated. The compact `LibraryBook` summary includes the value for future sorting/filtering.

The dedicated rating endpoint validates the value and saves through `ProjectStore`. Personal ratings are separate from `AudiobookMetadata`, provider tags, sidecars, and metadata revisions. Stable book IDs retain ratings through supported refreshes and file moves. Automatic regrouping preserves records with personal data.

Input supports each star's left/right half, dragging in either direction, double-click clearing, arrows for half stars, Home for zero, End for five, and Delete/Backspace for unrated. Drag previews do not write to disk until release.

## Listening storage

`tools/listening-store.ts` writes one small record per book under `APP_ROOT/listening/local/<SHA256(book-id)>.json`. The directory name is the implicit profile; no account or profile UI is introduced. Each versioned record contains profile ID, stable book ID, cumulative position, segment ID/offset, media signatures, segment durations, completion, and timestamps. Paths are not bookmark identities.

Writes use the same flushed temporary-file/atomic-rename primitive as the project store, with a previous valid backup. Recovery preserves damaged bytes. Checkpoints never rewrite `jobs.json` or exported audio metadata. Sequence numbers reject older unload/periodic requests from the same player session. The listening directory is ignored by Git.

The player checkpoints approximately every 15 seconds, on Stop, file transitions, completion, and switching. Page shutdown sends the newest position with `keepalive`; sudden process termination may lose progress since the last successful checkpoint. Failed writes remain visible and retryable; a failed Stop save prevents switching away.

## Audio and bookmark selection

Successful, current finalized outputs are preferred, with M4B first. Different full-book export formats are alternatives, never concatenated. The manifest adapter also accepts an explicit ordered multipart finalized output; the current exporter produces full-book format alternatives.

Otherwise, playback uses only associated `job.parts`, in saved processing order, with all selected members required to exist. It does not enumerate the containing directory or include sibling books. Media streams use HTTP ranges; the browser does not decode a full audiobook into memory. Missing or unsupported audio produces a visible error. Starting an editor preview stops Quick Player; starting Quick Player pauses page audio previews.

The passive progress bar and elapsed/total times represent all segments. Stop retains position. Play resumes; a completed book begins a new listen at zero. Book switching cancels outstanding loads and releases the old stream.

Verified moves and renames retain signatures when file identity data and timestamps are preserved. Reordering can recover the exact offset in an unchanged segment, with a notice. Untrimmed exports record the source timeline signature when output duration agrees within 0.15 seconds; this provenance permits source-to-finalized continuation even after originals are archived. Older exports without provenance, changed recordings, or trimmed exports restart safely with a notice when no exact mapping exists. Equal total duration alone is not treated as proof.

## Validation completed

- `npm run lint`: passed.
- `npm run test:player`: 48 tests passed, including real WAV/M4B headers, exact HTTP range bytes, persistence across server restart, independent profiles/books, stale request ordering, copies/moves, metadata isolation, half-star input, completion, cancellation, and corrupted-store recovery.
- `npm run test:library`: 80 existing library/import/metadata/duplicate/transfer tests passed.
- `node --import tsx --test tools/finalization-workflow.test.ts`: 2 tests passed with added checks for bookmarks through real export, source ZIP archival, and a Library move.
- Production build passed. Vite retains its advisory about a main bundle above 500 kB.
- An isolated live browser fixture verified saved title/cover updates without reload, rating keyboard input and pointer changes/double-click clearing, automatic transition into the second file, retained Stop position, bookmark/rating restoration after reload, independent second-book state, completion/restart at zero, and switching out of playback. Persisted data confirmed the second-file offset. These checks used generated test audio and separate application storage.

The browser fixture was checked at the narrow panel width. The browser tool's desktop viewport override did not render a reliable full-width capture, so desktop visual inspection is not claimed. Mouse hit testing is also covered independently using actual star bounds. Real concurrent transcription/export playback and every browser/codec combination were not manually tested; the checkpoint endpoint bypasses unrelated processing locks and does not touch audio state. No changes were made to the user's audio library by validation.

## Future work, not implemented

An expanded player can reuse the controller and profile store for seeking, queues, listening history, and additional controls. Rating sorting, shelves, profile switching, and workspace rearrangement remain future work. No accounts, playlist system, or workspace framework was added.
