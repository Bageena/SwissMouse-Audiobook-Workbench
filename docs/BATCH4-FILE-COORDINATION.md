# Batch 4: imports, source membership and Library transfers

Implemented October 28, 2026 on `codex/audiobook-batch1`. This is the second backend slice in stage 3 of the [Audiobook separation plan](AUDIOBOOK-SEPARATION-PLAN.md). Changes remain uncommitted alongside the preceding batches and Preferences work.

## What changed

The Audiobook package now decides which audio files belong to a book, their order, how imports become saved projects, how discovered books reconcile with existing projects, and how book transfers are planned and recovered. The server connects these decisions to the existing database, file engines and HTTP endpoints.

| Component | Responsibility |
| --- | --- |
| `packages/audiobooks/src/file-backend.ts` | Source membership/order, local selection and inspection, availability/path facts, cover and chapter-file commands; composes the file services. |
| `library-discovery.ts` | Inbox/Library discovery, reconciliation, refresh/rescan/rebuild, bounded scan work and progress. |
| `library-transfers.ts` | Associated project files, move/organize/export-folder plans, verified transfer coordination and interrupted-transfer recovery. |
| `import-providers.ts` | Staged upload adoption/rollback and the existing YouTube import commands. |
| `file-ports.ts` | Named store, file, media, provider, catalog and busy-state interfaces supplied by the built-in host. |
| `tools/audiobook-file-route.ts` | Adapts 26 existing HTTP handlers to plain command inputs and status/body replies. |

The package does not import Express or private host implementation/types. HTTP middleware stays at the original route locations, including multipart staging, dependency checks and global mutation/runtime guards. One shared activity state owns import locks, move status, scan promise/progress and warnings; the remaining Book Files and LibriVox adapters use that same state and the module-owned source helpers. Concurrent discovery requests still share the same scan promise.

The complete existing audiobook record types now live in `legacy-domain.ts`. Related transcription/provider contracts and pure source structure, book grouping, metadata, path, regrouping and relink rules also moved into the package. Old imports remain compatibility re-exports of the same definitions. This changes code ownership without migrating saved records or creating a second store.

## Existing safeguards retained

- Explicit source membership and stable surviving part/project IDs remain authoritative. Removing membership does not delete the source audio. Saved transcripts and personal ratings are retained.
- Import, processing, metadata-writing, scan and move guards continue to coordinate through the existing host and shared activity state.
- Ownership/path checks, destination previews, collision handling, verified copying, durable commit/rollback and journal evidence continue to use the established file engines. No replacement transfer engine was introduced.
- Startup calls the module's transfer recovery before scanning either root and before accepting HTTP requests. Ambiguous copies stay available for review; successful recovery does not guess which originals to delete.
- Existing SQLite records, legacy JSON compatibility, API URLs, response shapes and catalog publication paths remain in use. Discovery keeps the existing bounded scan worker behavior and lazy-store integration.
- Dependency installation policy and external tool selection are unchanged. No third-party program or model is bundled by this extraction.

## Temporary boundaries

The file ports describe the existing trusted, in-process built-in integration. Several decoder/engine replies and legacy HTTP payloads retain permissive types; these are provisional internal interfaces, not a finalized writable module SDK. The package still uses Node filesystem/process APIs. This is an ownership boundary, not process isolation.

`packages/sdk/file-transfers.ts` contains data-only shapes shared with the unchanged verified-transfer engine. Re-exporting those types grants no filesystem capability. The installed Batch 1 package remains read-only, and removing it still does not disable the built-in audiobook screens. The remaining host adapters still know about legacy audiobook storage, catalog views, media engines and cleanup.

Book Files and LibriVox route registration, processing/reruns, export/validation/finalization, configuration/dependency ownership and complete independent client packaging remain later extraction work. There is no separate repository, public installer or Core-only independence claim at this checkpoint.

## Validation

| Check | Result |
| --- | --- |
| TypeScript check and production build | Passed; existing large-browser-chunk warning remains |
| File service, backend boundary and relocated pure-rule checks | 33 passed, no failures or skips |
| Project API, Book Files, grouping, identity, playback and installed-module compatibility | 45 passed, no failures or skips |
| Full serial audio/regression suite | 402 passed, 3 optional skips, no failures |
| Whitespace checks | Passed |

The focused service tests cover early busy/membership rejection, release of import locks after invalid selection, preservation of source bytes and saved work during membership changes, and scan promise coalescing. The backend dependency guard checks runtime and type imports against package-local code, the public SDK and Node built-ins.

The compiled-server suites use disposable fixtures for import, source browsing, persisted membership, grouping, Inbox/Library reconciliation, collision rejection, transfers, rollback and restart recovery. Additional regression checks cover project APIs, Book Files, playback, relink identity and the assembled module installation proof. These checks do not measure real-library scale or real-model accuracy; no real library was modified and no browser/UI validation was performed for this backend change.

Run `npm.cmd run test:audiobook-files` for focused file coordination checks (its pretest builds the application). Broad suite logs are retained locally at `.cache/batch4-audio-serial.log`; additional compatibility checks are at `.cache/batch4-extra.log` and the new unit checks at `.cache/batch4-unit.log`.

## Next batch

Batch 5 has since extracted processing orchestration: preparation, transcription, chapter detection and reruns. Its [checkpoint](BATCH5-PROCESSING.md) records shared progress/cancellation, cache preservation, compatibility checks and the next export/validation/finalization slice.
