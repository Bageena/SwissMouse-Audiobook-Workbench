# Batch 9 storage and recovery review

For the later directory/history schema-2 upgrades, see [Batch 10 activation and recovery](BATCH10-DIRECTORY-AND-PICKER.md#storage-activation-and-recovery). This document records the Batch 9 schema-1 migration and its recovery discipline.

October 29, 2026. This describes the implemented **experimental, opt-in** migration. It is not authorization to migrate an existing installation. Batch 9 was tested with disposable libraries; the maintainer's library has not been migrated or enabled.

## What changes, in plain language

SwissMouse needs to remember enough about an item to show its name, fields and connections even when the module that understands it is unavailable. This adds that retained description to Core's existing user database. Audiobooks still owns the actual book project, transcript, drafts and processing state.

The new generic index can be recreated from those retained descriptions without an audiobook adapter. The complete application still includes audiobook code. This is one foundation for module removal, not completion of that work.

| File | Responsibility after opting in |
| --- | --- |
| `jobs.json.sqlite` and its assets | Existing authoritative audiobook projects; format and ownership unchanged. |
| `catalog.sqlite.user.sqlite` | Existing authoritative identities/collections, plus retained generic definitions, publications, aliases, retirement markers and replay history. **Never delete this to rebuild an index.** |
| `catalog.sqlite` | Existing derived catalog plus a persistent capture queue and generic index. Its queue may contain the latest unpublished description; preserve it during failures/restores. |

## Exact migration

Normal startup now checks the user database read-only before writing the catalog. Unknown future versions, missing required current tables/columns and unrecognized legacy layouts are refused. With durability disabled, the known legacy user layout stays at version 0.

Setting `SWISSMOUSE_INFORMATION_DURABLE=1` before starting a development process enables version 0 → 1:

1. Recognize the existing five legacy tables: `aliases`, `file_identity`, `collections`, `collection_members` and `migration`. Keep their rows and identities.
2. For an existing nonempty user database, run an integrity check and create a SQLite `VACUUM INTO` recovery snapshot. This includes committed WAL data; a raw copy of the main database alone would not necessarily do so.
3. Snapshot the existing companion catalog and sibling `jobs.json.sqlite`, if present. Verify snapshot integrity/schema, flush files, calculate SHA-256 hashes, record legacy row counts and available source watermarks in a JSON manifest. Refuse migration if database change counters show concurrent writes during snapshotting.
4. In one user-database transaction, add the information tables and alias reverse index, then set `user_version=1`. Recheck the user schema/change counter before DDL. A failure rolls this transaction back and retains the recovery files. There is no automatic restore.
5. Register retained declarations and capture existing resources in bounded batches. On an empty installation there is no earlier nonempty user database to snapshot.

New authoritative tables are `information_sources`, `information_epochs`, `information_definitions`, `information_resources`, `information_receipts` and `information_changes`. They store plain JSON declarations/descriptions and identity/replay information, not executable module code. The catalog and project database retain their existing schema version; capture has its own version marker.

Before enabling this on a real installation, stop other SwissMouse processes/writers, review this migration and keep a complete stopped-installation backup. These snapshots are taken sequentially, with change detection; they are not a cross-database atomic transaction. The application must have space and permission to create snapshots beside the databases.

## Recovery and downgrade

Recovery files use names such as `catalog.sqlite.user.sqlite.schema-0-<uuid>.bak`, with a neighboring `.bak.json` manifest. Companion snapshots use `.information-<uuid>.bak`. Keep all manifest-listed files together. Treat them as private library data.

To recover, stop all writers first. Preserve the failed installation separately, including its databases, WAL/SHM files and pending queue. Check the manifest's hashes and snapshot integrity. Restore the **compatible complete store set** to a separate recovery location first, and validate identities, collections and saved work with the matching application version before replacing a live installation. Do not combine an older user database with a newer capture queue merely because their numeric checkpoints look similar. The new receipt/chain checks refuse mismatched histories instead of guessing.

Database snapshots do not copy `jobs.json.assets`, other assets, external media or browser-local layouts. Preserve those separately with the installation's existing backup procedure. Do not overlay a restored database onto unrelated live WAL/SHM files; restore into a stopped, clean recovery location.

There is **no automatic downgrade**. Older released SwissMouse builds may not understand or enforce this new user-schema guard. Turning the feature off does not undo the migration. A supported rollback requires a matching application and complete pre-migration stores/assets; it may discard later edits. Never delete authoritative information tables to make an older version open.

## How restart and replay work

There are several different counters; they serve different purposes:

| Value | Meaning |
| --- | --- |
| Source epoch | Identifies one capture history. Replacing the derived catalog starts a new history; retired epochs cannot be reactivated. |
| Source version and receipt | Contiguous publication number and content hash within that epoch. Exact delivery replay is harmless; gaps/conflicting replays fail. |
| Resource revision | Changes only when that retained item's content changes. Reobserving unchanged data does not manufacture an edit. It is not yet a public write token. |
| Change sequence and chain | Ordered generic changes, each retaining its exact historical payload. A consumer's checkpoint/hash identifies how far its own index has applied that history. |

Catalog mutation triggers mark affected resources dirty in the same source transaction. Capture creates complete descriptions and a persistent outbox entry in a catalog transaction. Delivery then commits the generic fact, aliases, receipt and change feed together in the user database. A separate catalog transaction acknowledges delivery. If the process stops between these steps, the outbox retries the same event. The generic index updates rows and its checkpoint/hash together in its own transaction.

No atomicity across separate WAL databases is assumed. Existing project-feed replay still carries saves into the catalog; this capture queue bridges the catalog-to-Core step. Publication errors leave the queue pending and appear in catalog status. The service retries with backoff from 1 to 30 seconds. Oversized/invalid records remain pending rather than being silently truncated or dropped; they can block later publication until corrected.

Explicit retirement keeps a tombstone and the last description. An empty rebuilt index does **not** mean every missing resource was deleted: older unobserved live descriptions remain retained and are counted as `staleRetained`. Outbox acknowledgements and generic index checkpoints check hashes as well as counters, so restoring a divergent history requires reviewed reconciliation or a derived projection reset.

## Limits and activation

The complete capture path does not use the earlier preview's shortened contributor/membership lists. A publication is limited to 4 MiB by the adapter; delivery batches use a byte budget below Core's 8 MiB limit. Generic pages use keyset cursors tied to their index checkpoint. This is bounded infrastructure, not a measured promise for a 40,000-file or larger library.

For an isolated development installation, durability requires `SWISSMOUSE_INFORMATION_DURABLE=1`. Read inspection additionally requires `SWISSMOUSE_INFORMATION_PREVIEW=1`; `GET /api/information-preview/durable-resources` returns retained definitions, descriptions and capture status. It accepts `limit` (1–500), `cursor` and `includeRetired=true|false`; responses are limited to 4 MiB. There is no new write endpoint or installed SDK capability.

The original preview endpoints retain their Batch 8 behavior. Local file paths in the new generic file descriptions are local Admin metadata, not a new public Server API or file-access permission. Disabling durability stops delivery but does not remove retained data; installed catalog triggers may continue collecting distinct dirty IDs for catch-up.

This does not migrate collection ownership, create canonical people/series/taxonomy terms, implement selection history, provide typed field/search indexes or detach the full application. Existing collection bridging remains in place. Receipts and exact change payload history are currently **unpruned**; large-library storage growth, maintenance/compaction and performance acceptance remain future work. A user-facing installation/removal flow must handle bounded catch-up and stale descriptions before full module-absence acceptance.
