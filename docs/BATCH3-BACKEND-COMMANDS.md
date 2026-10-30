# Batch 3: project, metadata and chapter commands

Implemented October 28, 2026 on `codex/audiobook-batch1`. This completes the first backend slice identified in the Batch 2 checkpoint. It does not complete every backend slice in stage 3 of the separation plan. Changes are uncommitted.

## What moved

The Audiobook package now owns commands for listing, creating, opening and removing projects; saving metadata and drafts; updating metadata sidecars; bulk metadata edits; saving/importing chapter lists; and downloading chapter CSV/FFmetadata.

`packages/audiobooks/src/backend.ts` is the built-in backend entry. `project-service.ts` implements commands without Express or private host implementation/type imports. `project-metadata.ts` owns metadata normalization, revision updates and dependent-result invalidation. Chapter rules, FFmetadata generation, metadata override tracking, membership cleaning, relevant domain types and pipeline-state helpers now live in the package. Existing helper/type paths re-export their implementations so the remaining application continues to use the same rules.

`server.ts` constructs a specific context around the existing project store, catalog views/publication, sidecar writer, source-import/processing guards and managed-file cleanup. `tools/audiobook-project-routes.ts` adapts the existing URLs and response shapes to the commands. Each route is registered once; the previous handlers were removed.

The service's `EditableProject` interface describes only fields interpreted by this slice. It is not a new durable schema or a replacement for the complete legacy project type. Creation retains the established IDs/defaults, and the existing SQLite store, rollback mechanism and lazy record access remain authoritative. List requests still use the bounded catalog query rather than loading every project.

## Existing behavior retained

- Existing project IDs, chapter IDs, metadata revisions, API paths, drafts, ratings and transcripts remain compatible. Explicit empty values, false values and removed covers remain meaningful.
- Shared library/runtime mutation middleware remains ahead of the extracted routes. The narrow read-only catalog allowances are unchanged. The command layer also checks source-import ownership and metadata revisions before writes; bulk edits validate the complete selection before changing records.
- The host still supplies its existing sidecar ownership checks, atomic sidecar writer, external-tool discovery and managed-file deletion rules. No dependency is automatically installed or bundled by this work.
- Durable saves use the existing commit/rollback path. A failed database save is not reported as success, and live references return to their prior durable state.
- Sidecar errors retain the established distinction: book details may have been saved even when exmetadata.json could not be updated. Filesystem sidecars and SQLite are not a single cross-filesystem transaction; this batch does not promise automatic rollback of every sidecar after a later database failure.

## Corrections made while extracting the commands

CSV chapter import previously changed the in-memory record without a durable save. It now uses the same validated save command as the chapter editor, refreshes FFmetadata and marks export/validation results stale. Imported chapters survive a restart.

Bulk metadata's allowed fields included collections/additional series, but its value validation rejected their array representation. It now accepts valid membership arrays, keeps stable membership IDs and preserves unrelated unfinished draft fields.

Final metadata commands reject malformed scalar/list values before normalization can partially change live project state. Drafts must be objects rather than arrays. This does not require every optional metadata field to be present or migrate existing records.

## Validation

| Check | Result |
| --- | --- |
| TypeScript check and production build | Passed; existing large-browser-bundle warning remains |
| Focused backend/storage/client/module regression group | 38 passed, no failures or skips |
| Final backend command rerun after input-validation changes | 7 passed, no failures or skips |
| Full serial audio/regression suite | 402 passed, 3 optional skips, no failures |
| Whitespace/import-boundary checks | Passed |

The API fixture runs the compiled server against private existing-format data. It exercises metadata/draft/chapter saves, revision conflicts, malformed input, chapter rejection, downloads, explicit sidecar writes, repeated restarts and project deletion. Real SQLite triggers force single-book and bulk commit failures; subsequent reads retain prior values. CSV imports survive restarting. Saved ratings/transcripts and unchanged legacy JSON bytes are checked. Source audio bytes and an existing third-party metadata.json remain unchanged.

The service tests exercise source-import/deletion/processing guards, validation before mutation, partial sidecar failures, bulk draft preservation and membership edits. A boundary test builds the backend entry using only package-local implementation and Node built-ins, then checks its source dependency graph—including type imports—to reject private host dependencies that a bundler could otherwise erase.

The existing assembled-host module-installation proof also passed after extraction. The three broad-suite skips are optional runtime/model tests; these checks do not establish new real-model accuracy or new hardware support. No real library was modified. No browser/UI validation was needed for this backend slice; behavior was checked through HTTP and durable storage.

Run the focused backend checks with `npm.cmd run test:audiobook-backend` (its pretest builds the application). The full serial suite used the file list in `test:audio` with Node's `--test-concurrency=1`; its output is retained at `.cache/batch3-audio-serial.log`.

## Boundaries still temporary

The host's context still adapts legacy audiobook storage, source availability, library projections, sidecar discovery and managed-file cleanup. Those helpers are not yet neutral Core contracts. The existing frontend screen adapter also remains compiled in.

The installed Batch 1 artifact remains read-only. This built-in backend service context was not added to the installed SDK's `readRecord`, and removing the example package does not disable the built-in audiobook application. No database migration, additional store, public marketplace, separate repository or Core-only independence is claimed.

At this checkpoint, import/source selection and ordering, library discovery/transfers, processing/reruns, export/validation/finalization, settings/dependency ownership and full independent screen packaging remained in the separation plan. Import/source coordination and discovery/transfers have since moved in [Batch 4](BATCH4-FILE-COORDINATION.md).

## Next batch

Batch 4 extracted the import/source-membership/order and book-specific discovery/transfer slice. Its [checkpoint](BATCH4-FILE-COORDINATION.md) records ownership, compatibility, validation and the next slice.

Preserve all existing uncommitted Batch 1/2, Preferences and documentation changes when resuming. The full [Audiobook separation plan](AUDIOBOOK-SEPARATION-PLAN.md) remains the acceptance reference.
