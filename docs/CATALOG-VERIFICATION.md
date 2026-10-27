# Catalog verification - October 20, 2026

## Completion audit, October 20

- Fixed File Manager polling retaining the one-shot manual-refresh flag, which could start another scan after the requested scan completed.
- Failed directory observations now retain cached results and wait a minute before automatic retry. Manual Refresh bypasses the delay, while interrupted work with no recorded I/O failure resumes immediately.
- Visible rows reuse indexed metadata instead of requesting the same unchanged audio details again.
- All **11 focused directory, incremental catalog, and durable-project tests passed**, including offline retry and interrupted-directory restart regressions. Type-check and production build passed.
- In the isolated 1,200-file browser fixture, Refresh moved from updating to a settled 500-entry All window; the directory generation advanced exactly once. The UI retained its bounded window.

The measurements and broader regression results below are from October 19; the 500k benchmark was not repeated for these refresh fixes.

## Synthetic scale run

Command: `node --import tsx tools/catalog-benchmark.ts 500000`

Local Windows run, Node.js v24.21.0, SQLite 3.53.4. One run immediately after import, with other development work on the machine; these are measurements, not latency guarantees or percentile statistics.

| Measurement | Result |
| --- | ---: |
| Logical books | 500,000 |
| File records (one per book) | 500,000 |
| Total resources (work + recording + file) | 1,500,000 |
| Initial index creation | 1,527.997 seconds (25.5 minutes) |
| First 50-book page, including total count | 113.75 ms |
| Targeted substring search | 16.42 ms |
| First arbitrary deep-page jump | 1,666.43 ms |
| Following cursor page | 89.39 ms |
| Freeze selection of all 500,000 books | 4,098.78 ms |
| Membership check against that selection | 0.52 ms |
| Generic file-resource page | 70.16 ms |
| Serialized first-page response | 41,177 bytes |
| Process RSS after queries | 264.3 MiB |
| Main catalog database after WAL checkpoint | 3,937.7 MiB |

The first arbitrary deep-page jump builds an ordered ID snapshot on disk. This replaces repeated deep OFFSET walks; sequential scrolling uses indexed cursors without that snapshot cost. The database size excludes the separate durable identity/collection database.

The script verifies counts, late-record search, cursor order, and selection membership. Its temporary database is removed after completion. It creates no media files and does not benchmark filesystem discovery, tags, decoding, thumbnails, network storage, duplicate maintenance, or project-state migration. The RSS result describes the benchmark process, not the entire running app. The run began before the final duplicate-key/version-ordering refinements; those refinements were covered by focused tests, not another 500k run.

## Automated checks

- TypeScript type-check and production frontend/server/catalog-worker builds passed. Vite retains its existing large-chunk advisory.
- `npm run test:library`: **80 tests passed**, covering imports, refresh, source preservation, transfers, archives, metadata, grouping, duplicate decisions, and rollback.
- The focused catalog/project/directory/player/audio regression run has **51 passing tests and 2 optional skips**, after correcting a test fixture that left its directory database open on Windows. All seven checks in that fixture passed on rerun. Counts overlap other suites and are not a distinct-test total.
- Skips concern the optional external Audiobookshelf parser and actual Whisper recognition fixture/runtime; source-preserving FFmpeg audio checks passed.
- Durable project tests cover streaming legacy migration, changed-record saves, rollback, lazy assets, deletion tombstones, and nested edits retained across cache eviction.
- Incremental catalog tests cover checkpoint restart, browsing an existing index during updates, catalog rebuild preserving collection membership/ratings/identities, and stale background observations losing to newer edits/deletions.
- Directory tests use 1,200 real tiny files and cover whole-directory filename/previously indexed metadata search, sort and cursor traversal, unchanged metadata reuse, removals, and offline cache reads.
- Backend-state API read-back and duplicate API checks also passed against the new durable database.

## Browser verification

An isolated production server used 1,200 synthetic projects and a directory of 1,200 text files, separate from the user's library. Verified:

- Default 50-book page with the correct 1,200 total; search finds and opens Book 1199 from the first page.
- Library All-mode scrolls through overlapping windows past Book 900 while rendering only 26 nearby rows. Switching to Edit changes All to a bounded 100-record page.
- File Manager indexes the directory in the background and finds Note 1199 from the first page.
- File Manager keeps the 25/50/100/250/500/All choices; All holds at most 500 entries and renders about 24 nearby rows.
- Forward scrolling reaches entries 500-999 and 1000-1199; backward scrolling restores the preceding bounded window.

The synthetic text-only book has no playable audio, so its expected unavailable-audio response is not a playback failure.

Earlier browser checks also covered frozen whole-library selections, collections surviving reload, and metadata edits outside the initial compatibility page. The current regression tests cover their persistence through the storage change.

No third-party plugin, mobile sync, hosted Server boundary, or real-media scale claim is implied. The [catalog guide](RESOURCE-CATALOG.md#scope-and-scale-limits) describes remaining proportional-memory discovery inventories, first-run costs, and backup requirements. The [vision](SWISSMOUSE-VISION.md) separates current foundations from future modules and services.
