# Shared identities and the catalog

Updated October 20, 2026. Product direction: [SwissMouse vision](SWISSMOUSE-VISION.md). Theme instructions: [Custom Themes](../CUSTOM-THEMES.md).

## In ordinary language

Think of SwissMouse as a library with a card catalog. A book, a particular recording, and the actual files each get their own permanent identification number. Changing a title or moving a known file updates its card; it does not create a new identity. Similar titles do not automatically become the same book.

When you search, the catalog searches the whole library and sends the screen a small page of results. It does not send every book, transcript, and cover to your browser. In **All** view, scrolling replaces the loaded window while only nearby rows are drawn.

**Select all matching results** stores the selected IDs in the database. The screen holds a small selection token. Bulk operations read those IDs in batches, so changing a title during the operation does not change which books were selected. New books added afterward are not silently included. Selections expire after 24 hours; collections do not.

A collection is a list of references, not copies of the books or files. Current audiobook collections are saved in a separate durable user database and existing browser collections are imported once. A future notebook or plugin can refer to the same resource number. The notebook and plugin systems themselves are later work.

Themes control appearance using the existing design tokens. They do not need their own library database or their own version of search.

## What the code does

| File | Responsibility |
| --- | --- |
| `src/core/resources.ts` | Versioned, UI-independent resource types and core kind definitions. |
| `src/core/catalog.ts` | Query/page/selection contracts and consistent search and sort normalization. |
| `tools/durable-project-store.ts` | Authoritative per-project SQLite records, lazy loading, dirty-record commits, and a resumable change feed. |
| `tools/directory-index.ts` | Streamed directory observations, cached file details, and bounded server-side search/sort/paging. |
| `tools/catalog-projection.ts` | Converts an existing audiobook project into a compact catalog record. |
| `tools/catalog-availability.ts` | Checks source availability and valid surviving M4Bs during indexing; shares archive checks with the existing server. |
| `tools/catalog-store.ts` | SQLite schema, identities, relations, indexed search, paging, collections, selection snapshots, and transactions. |
| `tools/catalog-worker.ts` | Owns the database and performs its synchronous work away from the HTTP server's main thread. |
| `tools/catalog-service.ts` | Synchronizes committed projects in batches and dispatches typed application operations to the worker. |
| `tools/catalog-routes.ts` | Exposes bounded catalog APIs and a discoverable theme/resource contract. |
| `src/core/catalog-client.ts` | Shared request functions and a batch iterator for bulk selections. |
| `src/components/useCatalogPage.ts` | Debounces search, cancels obsolete requests, and holds a single result window. |
| `src/components/LibraryManager.tsx` | Uses catalog pages with the existing Cover/List/Edit interface and virtual rows. |

## Identity rules

- A **work** (`core.work`) is the catalog identity for a book.
- A **recording/edition** (`core.recording`) is a particular audiobook representation. It links to its work using `core.edition-of`.
- A **file** (`core.file`) is a physical file record. A recording links to its files using `core.contains`.
- `audiobooks` is the first module adapter. Domain types use namespaces so future modules can contribute different kinds without making them audiobook projects.
- Existing job IDs remain valid for existing processing routes. Catalog resource IDs are additional identities, derived from namespaced legacy IDs and persisted aliases, not from titles or file paths.
- A stable source-part ID retains its file resource ID through an app-managed move or relink. Matching normalized paths can share a file record. This is **not** content-hash deduplication: a copied file can have a different identity. An arbitrary external move cannot be recognized without scan/relink evidence.
- Explicit legacy book grouping is preserved. Grouped recordings retain their own resource IDs and links. Similar names never trigger an automatic merge.
- Removed project/file resources are retained as archived identities, so a caller can distinguish a known unavailable target from an unknown ID. This is not an undo system for deleted processing data.
- New note references should target a resource ID, with a separate edition-specific position/anchor. Do not store a title or container instance ID as the reference. Annotation/anchor storage is not implemented by this update.

## Catalog API, version 1

These are local Admin APIs. They expose local paths and are not a public Server publication API or a plugin sandbox.

| Request | Result |
| --- | --- |
| `GET /api/catalog/contract` | Contract version, kinds, supported sorts, theme token names, theme hooks, page bound, and extension status. |
| `GET /api/catalog/status` | Current revision, background indexing status, and worker failure status. |
| `POST /api/catalog/matches` | Bounded stored duplicate candidates or reviewed decisions; no matching or filesystem checks during browsing. |
| `POST /api/catalog/library/query` | Filtered/sorted audiobook summaries, total, revision, and next cursor. |
| `GET /api/resources?kind=core.file&limit=50` | Generic resource summaries with a continuation cursor. |
| `GET /api/resources/:id` | One resource, optional file location, and the first bounded page of incoming/outgoing relations. |
| `GET /api/resources/:id/relations?limit=50&cursor=…` | Further relation pages. |
| `POST /api/catalog/selections` | Frozen result selection `{token,count,revision,hasGroups}`. |
| `POST /api/catalog/selections/page` | Up to 500 IDs from a token; returns `nextOffset`. |
| `POST /api/catalog/selections/members` | Which of at most 500 supplied IDs belong to the token. |
| `GET /api/catalog/collections` | Collection names and counts without full membership arrays. |
| `POST /api/catalog/collections` | Create/rename, add/remove selected members, or remove a collection. |
| `POST /api/catalog/suggestions` | Up to 100 metadata suggestions for a supported field. |

Example using the shared client:

```ts
import { queryCatalog } from './src/core/catalog-client';

const page = await queryCatalog({
  root: 'library',
  query: 'dark tower',
  filters: { creator: 'Stephen King' },
  sort: 'series',
  limit: 50,
});

// Use book.resourceId for references, book.id for legacy audiobook commands.
// Fetch the next page with the same query and cursor: page.nextCursor.
```

All filtering and ordering happen before paging. Search supports normalized substrings, including accent-insensitive terms. SQLite FTS5 trigram indexes accelerate terms of three or more characters; shorter terms and broad filters can require scans. Natural title ordering places Book 2 before Book 10. Series sorting includes numeric sequence order.

Pages are bounded at 500 records. The UI retains 25/50/100/250/500 choices. **All** uses overlapping 500-record windows and the existing measured virtualizer; Edit remains paged (100 when switching from All). Sequential pages and overlapping All windows use indexed, revision-bound cursors. A random numbered-page jump materializes an ordered list of IDs on disk once for that query/revision, then seeks by position. Up to eight such lists are retained, with stale revisions and old lists evicted. This trades a slower first arbitrary deep jump for bounded memory and avoids repeatedly walking OFFSET rows. A changed catalog invalidates cursors with HTTP 409; restart the query. A frozen bulk selection is independent of those cursor revisions.

The compatibility `/api/library` and `/api/jobs` GET endpoints now return bounded summaries (100 by default, maximum 500), never whole processing collections. A caller that needs every item must page through the catalog API. New views/extensions must use the catalog APIs, then load one job only when opening its editor. Current Library Manager uses the bounded APIs. `X-SwissMouse-Catalog: 1` suppresses old whole-library response arrays on refresh/rebuild/transfer operations.

## Themes first

Start with `themes/_template`: copy the folder, change `theme.json`'s name/id, and set approved `--sm-*` values in `theme.css`. Use Settings → Reload Themes. [The existing theme guide](../CUSTOM-THEMES.md) documents all supported values and assets.

```css
:root {
  --sm-app-bg: #f4efe4;
  --sm-surface: #fffaf0;
  --sm-ink: #30291f;
  --sm-accent: #806132;
  --sm-border: #d6c7ad;
}
```

The resource contract advertises `data-resource-id`, `data-resource-kind`, and `data-sm-surface`. Library cards and rows carry stable resource attributes; the library root is `data-sm-surface="library"`. These identify rendered content for built-in UI work and later extension contracts. **Current custom theme files still accept approved tokens only**; arbitrary selectors, layout code, and scripts are not newly enabled.

Future plugin viewers should receive a resource ID and use the shared query/read contracts. Resource identity, a container's definition ID, and an individual container instance ID are separate concepts. Data access must not depend on the selected theme. There is no third-party loader, installation workflow, permission system, or plugin execution in this update. The discoverable contract explicitly reports `runtimePlugins: false`.

## Storage and migration

Use a supported LTS Node.js release: **22.13+ or 24+**, with built-in `node:sqlite` and FTS5. [Node 22.13 enabled SQLite without a flag](https://nodejs.org/download/release/v22.13.0/docs/api/cli.html#--no-experimental-sqlite). Development and production builds compile the database worker separately; `npm run dev` builds that worker first.

Application files live under `APP_ROOT`:

The durable project schema now uses `PRAGMA user_version` (version 1), independently of change-feed revisions. Existing unversioned databases receive a recovery snapshot before transactional migration; unsupported newer schemas are refused. See [installation and recovery](ALPHA5-INSTALL-AND-RECOVERY.md) for the fresh-install recommendation, exact backup contents and downgrade limits, and [extension boundaries](EXTENSION-CONTRACTS.md) for implemented versus provisional contracts.

| File/directory | Purpose | Rebuildable? |
| --- | --- | --- |
| `jobs.json.sqlite` | Authoritative project records: metadata, ratings, drafts, membership, processing state, duplicate decisions; previous committed payload per project and change versions. | **No** |
| `jobs.json.assets/` | Immutable large payloads, including transcripts and cover data referenced by project records. | **No** |
| `catalog.sqlite.user.sqlite` | Durable identity aliases and collection membership. | **No** |
| `listening/` | Existing per-profile listening records and backups. | **No** |
| `catalog.sqlite` | Search rows, resources/relations projected from saved identities, observed availability, duplicate candidates, temporary selections and query windows. | Yes, except temporary selections expire on rebuild. |
| `directories.sqlite` | Observed file-directory entries and cached details. | Yes |
| `jobs.json`, `jobs.json.bak` | Preserved legacy migration/recovery input. After migration these are not the current project database. | Retain as migration backups. |

On the first upgraded start, the project store streams the legacy JSON one object at a time into a transaction. Migration is marked complete only when all records commit; the original JSON remains unchanged. Subsequent starts load the ID list and hydrate project bodies only on access. Two small 32-record caches retain recent projects; active processing can retain its own project. Nested mutations mark only the affected record dirty. Saving commits changed rows rather than serializing the library. Large immutable assets retain their existing lazy representation. Use the current SQLite database and assets for backups; the preserved legacy JSON will not contain later edits.

The catalog consumes committed changes in batches of 100, including deletion tombstones. It saves a version checkpoint after each successful batch. Restarting resumes from that checkpoint; replay is idempotent. User edits can publish selected records immediately without waiting for a full reconciliation. Version checks prevent an older in-flight observation from overwriting a newer edit. Existing index results are available while background work runs; a first-ever empty index fills progressively.

Library refresh reuses saved file signatures and metadata, limits concurrent identification to four books, yields between project batches, and commits discovery approximately every 100 books. If interrupted, committed work survives and unchanged books do not need probing again. **Directory traversal itself restarts:** operating-system directory offsets are not treated as durable cursors. A full discovery pass still collects grouping/path inventories in memory to preserve ownership and conservative regrouping behavior. Missing/unreadable roots keep saved records. No watcher is required for correctness; Refresh and startup reconciliation remain the source of filesystem observations.

File Manager streams each directory with `opendir`, records 100 observations per batch, and returns at most 500 entries. Search/filter/sort apply to the entire indexed directory before paging. Its 25/50/100/250/500/All controls use forward/backward cursors; All evicts the preceding window and draws only nearby rows. Cached directory data remains readable while refresh runs or the directory is offline. Absences are removed only after a complete pass. A failed directory scan waits at least a minute before a browse request retries it; explicit Refresh bypasses that delay. Polling reads progress without repeating the refresh command, and an interrupted scan without an I/O error resumes immediately. Tags are read for small batches of visible files and reused when their file stamps match; entries with cached metadata do not trigger another probe merely because they become visible. Filename search covers every observed file, while tag search covers metadata already indexed. Opening or modifying a file still checks its current path and ownership.

Availability checks run in a separate observation worker. Browsing reads their last result; external changes appear after reconciliation, and opening/processing checks the actual files. Duplicate maintenance uses indexed title/author/identifier/size buckets with bounded neighbor checks, keeps up to 2,000 candidates ready, and refills when decisions make room. Similarity is a review suggestion, never permission to remove files. Confirmed comparisons and decisions live in durable project state. Thumbnails remain lazy and cached.

For a manual backup, stop SwissMouse and copy both durable SQLite databases, any remaining journal/WAL/SHM companions, the project asset directory, listening records, configuration, custom themes and media. Backing up the whole application data folder is simplest. Do not copy only a main SQLite file while the app is writing. Only the two explicitly rebuildable databases may be regenerated; never delete `jobs.json.sqlite` or `catalog.sqlite.user.sqlite` as cache cleanup. Automated backup/restore UI is future work.

## Scope and scale limits

The 500k-file target now has bounded browse responses and rendering, lazy project loading, individual-record saves, checkpointed indexing, and separate durable user state. It does not mean every operation is constant-memory or instantaneous:

- The first legacy migration and catalog build take time. Startup retains an ID list; discovery still allocates path/ownership/grouping inventories proportional to the files being reconciled. It re-enumerates directories after an interruption while reusing committed metadata.
- Search/counts on very broad or very short terms can scan many index rows. The first arbitrary deep-page jump builds its ordered ID snapshot; cursors avoid that cost for continuous browsing.
- Explicit large operations such as freezing a whole-library selection, bulk edits, and regrouping still do work proportional to their scope. A single unusually large project, description or recording group can exceed ordinary record sizes.
- The 500,000-record benchmark measures the catalog using synthetic books/files. It does not establish real NAS discovery, media-probe, thumbnail, transcription or playback throughput.
- Generic multi-module collections/series, notebooks, graph search, server publication, mobile privacy, sync and external plugin execution remain future phases. Theme tokens and shared resource/query contracts remain the supported extension boundary.

Run `npm run test:catalog` for focused API/store tests. The opt-in synthetic stress test is `node --import tsx tools/catalog-benchmark.ts 500000`; it creates and removes its own temporary database, adds 500,000 books with one file each, checks queries and selections, and reports timing and size. It does not scan 500,000 real audio files or benchmark decoding/playback.

See [verification results](CATALOG-VERIFICATION.md) for measurements and their limits.

See [Alpha 5 identity verification](IDENTITY-VERIFICATION.md) for packaged replacement, move/relink checks, portable storage requirements and remaining physical-device checks.
