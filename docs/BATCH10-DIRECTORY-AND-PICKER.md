# Batch 10: shared suggestions and saved selection history

Implemented October 29, 2026 on `codex/audiobook-batch1`. This follows [Batch 9](BATCH9-DURABLE-FOUNDATIONS.md) and the approved [shared-information design](SHARED-RESOURCE-CONTRACTS.md). The feature remains **experimental and opt-in**. It has not been enabled for the maintainer's library.

## What the pilot does

The metadata editor's **Series Name** field uses the shared service when enabled. Typing searches the indexed vocabulary, including values beyond the old 100-name list. Opening **Series suggestions** offers explicit choices and a More button. Clearing the input shows saved recent choices and a bounded set of author-related suggestions. Ordinary text editing remains available if suggestions fail.

“Recent” means a choice was explicitly selected in this picker and then successfully saved with **Save book details**. Looking at suggestions, typing without selecting one, importing books, saving drafts, cancelling or failing the canonical save does not create recency. Other save/import/export actions and the older collection/series quick-choice interfaces have not been converted to this pilot.

“Related” means an indexed observation shares a saved author name with the current work. It is a labelled heuristic, not proof of a person's identity. It uses saved context; an unsaved author edit does not immediately replace that context. Removing or changing the source observation updates association counts without erasing genuine selection history.

The service is shared infrastructure; specialized membership rules remain outside it. Existing `/api/catalog/suggestions` and membership endpoints retain their behavior until their callers migrate.

## Boundaries and behavior

| Layer | Implementation |
| --- | --- |
| Provider declarations | Existing data-only provider/field definitions. Queries must name a matching registered pair. Modules cannot submit SQL. Text and canonical-term providers are supported; resource-entity suggestion providers are explicitly rejected for now. |
| Text directory | Provider/field-scoped stable keys with version-1 equality normalization: NFC, trimmed/collapsed whitespace and defined lowercase rules. Display strings are retained. Search additionally removes combining accents; `José` and `Jose` can match the same search without gaining the same identity. |
| Matching | Exact normalized search matches precede prefix matches, followed by indexed contains matches. Prefix works with short input, including supplementary Unicode characters. Contains starts at three normalized characters or the provider's higher minimum. |
| Paging | Stable keyset continuations are bound to the query, index configuration/checkpoints and current history. A changed cursor returns a conflict. Default 20, provider maximum at most 100. Selected keys can be resolved separately from a result page. |
| Bounded work | Maximum query text 256 characters, eight context resource IDs and 32 selected keys. Contains examines at most 201 indexed candidates per call; a broad search can return a continuation even with no additional matches on that call. Empty-query recommendations use at most 32 distinct contexts, 101 candidates per context and 200 unique candidates overall. These recommendation windows do not limit the typed searchable vocabulary. |
| Local history | Host-owned `local-default` profile. Latest 50 distinct values per provider/field and 5,000 overall, with committed timestamps, use counts and retained labels/values/context IDs. Profile IDs are not accepted from requests. Clear suggestion history clears this profile's history across providers, while receipt records prevent old deliveries from repopulating it. |
| Term foundation | Internal canonical terms retain their own IDs through rename/retirement, validate ownership/revisions/parent chains, and feed a separate incremental term projection. Parent retirement/subtree moves that need descendant reconciliation are refused. There is no new term-management screen, assignment API, hierarchy filter or silent conversion of legacy genre/tag text. |

Typed query ordering is deliberately stable rather than a universal relevance model: exact/prefix/contains class, indexed search order and key/row ordering determine pages. Empty queries put actual recency ahead of bounded contextual recommendations. Pins, resource-identity suggestions and configurable relevance tie-breaks remain later work.

The directory reads generic publications and declarations. It does not deserialize audiobook projects, probe media or scan every project's JSON on a keystroke. Definition/normalization changes and divergent restored histories require a reviewed derived-index rebuild. The generic directory/history/term dependency graph does not import the audiobook implementation. The full application still does.

## Save, crash and retry safety

Selecting a suggestion creates a receipt ID in the unsaved form. The host validates that the chosen value matches the series being saved and supplies the profile, provider, field, context and commit time.

The project save and `project_selection_outbox` entry commit in **one project-database transaction**. The receipt is not added to book metadata, tags, sidecars or media. Delivery writes history and its deduplication receipt in one user-database transaction, then acknowledges the source queue separately. Exact delivery replay does not increment use counts twice; conflicting receipt content is refused. Delivery time does not replace the recorded canonical commit time.

If delivery fails after a successful save, the response reports `historyPending`, the editor says the book was saved with history pending, and the queue retries every second, including after restart. A failure to update an existing sidecar still follows the older partial-save error path; that failed command does not produce a pilot selection receipt. History clearing first attempts to drain pending receipts and reports failure rather than silently clearing ahead of a blocked older delivery.

## Storage activation and recovery

Use only an isolated development installation until the migration is reviewed. Both `SWISSMOUSE_INFORMATION_DURABLE=1` and `SWISSMOUSE_INFORMATION_DIRECTORY=1` must be set before process startup. `SWISSMOUSE_INFORMATION_PREVIEW` is not required for the picker. Turning flags off does not downgrade or delete user data.

| Store | New opt-in format |
| --- | --- |
| `jobs.json.sqlite` | Schema 2 adds the authoritative `project_selection_outbox`. Ordinary new installations without the directory still create schema 1; this build can read the known schema-2 format with the feature off. |
| `catalog.sqlite.user.sqlite` | Schema 2 adds `information_history`, `information_history_receipts`, `information_terms`, `information_term_changes` and supporting indexes. Batch 9 durability alone still creates schema 1. |
| `catalog.sqlite` | Rebuildable `directory_*` entries, observations, context links/counts, checkpoints and an FTS5 trigram index. Catalog schema version remains 1. |

Existing nonempty stores are snapshotted before migration. The project upgrade verifies its WAL-aware SQLite snapshot and writes a SHA-256 manifest; the user upgrade uses Batch 9's verified snapshot/companion manifest path. DDL and schema markers commit transactionally, with source change-counter checks. Unknown future schemas and damaged required authoritative tables/columns are refused before catalog/project writes. Tests inject DDL/save/delivery failures rather than assuming these guarantees.

Preserve **the complete compatible store set**, pending queues, recovery manifests and `jobs.json.assets`; copy externally referenced media separately. Stop writers before backup/restore. Restore into a separate clean location and validate before replacing a live installation. Snapshots do not copy assets or media, and separate databases do not gain cross-WAL atomicity. See [Batch 9 recovery](INFORMATION-DURABILITY-MIGRATION.md) for the recovery procedure. Older builds may refuse schema 2 or fail to understand it; there is no automatic downgrade. Later edits can be lost if older snapshots are restored.

History deduplication receipts, term changes and Batch 9 publication/change history are currently unpruned. The visible history windows are bounded; long-term log growth and reviewed compaction remain future maintenance work.

## Code and inspection

| File | Role |
| --- | --- |
| `packages/sdk/suggestions.ts` | Internal experimental requests/results/receipt shapes, outside the installed SDK index. |
| `tools/information-directory.ts` | Generic incremental value/term projection, provider-scoped prefix/trigram search, contexts and checked paging. |
| `tools/information-history.ts`, `tools/information-terms.ts` | Authoritative history/receipts and internal canonical term operations. |
| `tools/information-directory-routes.ts` | Local Admin read/clear routes, source delivery and explicit Series pilot binding. |
| `tools/durable-project-store.ts`, `tools/project-schema.ts` | Atomic source receipt/save boundary and guarded source migration. |
| `src/components/SharedSuggestionInput.tsx` | Shared input with debouncing, cancellation, obsolete-response protection and preserved draft text. |
| `src/components/Step3Metadata.tsx` and audiobook command/client adapters | Pilot choice staging, canonical-save validation and pending feedback. |

`GET /api/information-directory/config?jobId=…` reports whether the pilot is active and supplies host context IDs. Enabled local Admin reads use `GET /api/information-directory/suggestions?request=<encoded JSON>`. `POST /api/information-directory/history/clear` accepts an empty body. No HTTP endpoint accepts arbitrary history commits or term writes; these are not public Server APIs or installed SDK permissions. Only the Series pilot has a save adapter.

## Validation and remaining gates

The isolated API fixture verifies default-off behavior, source/user upgrades, late-alphabet lookup, no imported/draft/failed-save recency, revision conflicts, successful receipt replay, pending delivery across restart, history clearing and rejection of request-supplied profiles. Unit tests cover Unicode/equality, paging, stale cursors, selected values, observation removals, retention, rollback, terms and the Core dependency boundary.

The isolated browser harness used the **actual shared input and actual fixture APIs**. It verified finding a value beyond the first 100, explicit selection/Save, recent-versus-related labels and rapid-query replacement. This is component integration evidence, not a full desktop/workspace acceptance pass. The fixture contained no personal library information.

See [performance measurements](BATCH10-PERFORMANCE.md) for the synthetic 40,000/500,000-entry profiles, five-million-association case and practical limits. Full mixed-library imports, cold-machine startup, taxonomy traversal, concurrent playback and module-absent host acceptance remain separate gates. This batch does not complete full Audiobook separation or replace every autocomplete caller.

Run `npm.cmd run test:information-directory`; its pretest builds the app. Run the synthetic benchmark separately with `npm.cmd run benchmark:information-directory`.

| Final validation | Result |
| --- | --- |
| TypeScript and production build | Passed; existing browser chunk-size warning remains. |
| Directory/history/term/migration, catalog/project, module-host, audiobook command/client/edit, metadata and import/fixture group | **119 passed**, no failures or skips. |
| Isolated actual-component browser check | Late-value lookup, explicit Save, recent/related distinction and replacement of obsolete query results verified. |
| Synthetic indexed-query budgets | Measured prefix/contains p95 below their proposed engine budgets at baseline and scale; see the separate report for exact scope and storage costs. |
| Tracked diff/new-file whitespace and documentation links | Passed. |

Two earlier group runs encountered intermittent legacy catalog/import fixture readiness timeouts. Those fixtures now use fresh connection-closing probes, per-probe timeouts, a bounded 30-second functional readiness window, child-exit checks and captured failure diagnostics. The helper has its own regression test, and the final full group passed. The exact cause of the earlier timings was not isolated. This is functional-test handling, not evidence that whole-app startup meets a 3/5-second performance target. A restricted-filesystem asset-rename test also passed when rerun in the approved unrestricted fixture context.

Logs: `.cache/batch10-lint.log`, `.cache/batch10-build.log`, `.cache/batch10-final-regression.log`, `.cache/batch10-startup-check.log` and `.cache/batch10-benchmark.log`. The sanitized result artifact is `docs/benchmarks/batch10-directory.json`; task changes remain uncommitted. The isolated preview tab/server was stopped and its disposable library removed. No dependencies were installed, no real library was migrated and no real-model processing accuracy is claimed.
