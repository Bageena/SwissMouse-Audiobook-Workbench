# Shared information contracts — proposed Alpha 6 design

Prepared October 29, 2026 after the Batch 6 source review. **This is a concrete proposal for review, not an implemented API, database schema or performance claim.** Names and TypeScript examples below describe the proposed next contract. They do not extend the installed SDK today.

## The proposal in plain language

SwissMouse should keep a shared address book for the information it manages. Each item has a permanent ID, a basic description and a declared type. Modules add their own details and tools. The shared browser can show an item without knowing how to edit its audiobook transcript or note contents.

Classification is one part of this system. A category such as Fiction > Fantasy is a taxonomy term. An author is a person relationship when we know the person's identity. A publication year is a field. A book's place in a series belongs to its membership in that series. A file path is a location. Keeping these meanings separate makes filtering and future modules easier to support.

The recommendation is to extend the existing SQLite/worker foundation, retain all existing audiobook identities and saved work, and introduce the design in small compatible steps. No language rewrite, second competing library, automatic person merging or reimport is required.

## What exists today

These facts were checked against the current source, not inferred from the product vision:

| Current code | What it establishes | Remaining gap |
| --- | --- | --- |
| [`src/core/resources.ts`](../src/core/resources.ts) | Resource contract 1: stable IDs, summaries, kinds, links and pages. | No generalized field/taxonomy registration or durable generic descriptor service. |
| [`tools/catalog-projection.ts`](../tools/catalog-projection.ts) | Translates an audiobook job into summaries and file memberships without probing media. | `CatalogProject`, `book` and duplicate matching remain audiobook-shaped. |
| [`tools/catalog-store.ts`](../tools/catalog-store.ts) | Indexed resources, relations, audiobook summaries, cursors, selections and durable identity/collection data. | Resource descriptions and most links live in the rebuildable index; Core cannot yet rebuild them independently of audiobook interpretation. |
| [`tools/catalog-service.ts`](../tools/catalog-service.ts) | Worker-backed queries, background observations and bounded durable-feed updates. | Its source feed and default projection still require audiobook jobs. |
| [`tools/durable-project-store.ts`](../tools/durable-project-store.ts) | Authoritative audiobook records, lazy access, versions and recovery. | Not a universal resource store and should not become one through arbitrary fields. |
| Catalog suggestion methods | Distinct existing field values; collections/additional-series matching and author-related choices. | Ordinary suggestions use JSON extraction and `DISTINCT ... LIKE ... LIMIT 100`. Limits bound replies, not all database work. |
| [`packages/sdk/index.ts`](../packages/sdk/index.ts) | Installed contract 1 supplies trusted read-only record access and packaged panels. | These proposed registrations, query/write services and private module settings are not installed SDK capabilities. |

Current authoritative audiobook records are in `jobs.json.sqlite`. The catalog is `catalog.sqlite`; its attached durable identity/collection database is `catalog.sqlite.user.sqlite`. Do not describe the whole catalog family as disposable: deleting the user database loses authoritative information.

Collection quick choices currently infer recency from membership row order. Series quick choices infer it from stored timestamps. Author association compares saved names/author arrays. These are useful hints, not a recorded history of actual selections or proof of person identity.

## Recommended decisions

| Area | Proposed rule |
| --- | --- |
| Resource identity | Opaque permanent IDs. Preserve existing work, recording, file, project and alias mappings. Titles, locations and current grouping are not new IDs. |
| Type system | Registered concrete types/facets augment existing coarse `kind`; they do not replace existing resource IDs. |
| Hierarchy | Optional single-parent taxonomy trees for the first version. Flat vocabularies have no parent. No multiple-parent graph in Alpha 6. |
| Terms and entities | Stable term/entity IDs; labels can change. Matching labels or search keys never merge people, series or resources automatically. |
| Shared classifications | Explicitly register/reuse a vocabulary ID. Identical category labels in two modules are not automatically one vocabulary. |
| Storage | Evolve the existing durable user database for Core-owned information and retained descriptors; retain module stores for their authoritative content. |
| Search | Indexed typed projections, incrementally maintained in the worker; bounded pages and work budgets. No media probing to render a result page. |
| Autocomplete | One query/history service, several declared providers and field-specific policies. Suggestions can return text values, terms or entity references. |
| Missing module | Retain descriptors, identities, classifications and references. Show a generic read-only item with unavailable actions. |
| Rollout | Registration and an audiobook read adapter first. User-data/schema migration and public writable installation remain separate review gates. |

## 1. Resources, types and identity

A resource represents managed information: one work, recording, note, file or another declared item. It may have one file, many files or none. A file resource describes a physical file; a missing file does not erase its record. Copies and arbitrary external moves still require identity evidence rather than assumptions based on names.

Keep the existing `core.work`, `core.recording` and `core.file` meanings and IDs for audiobooks. Proposed concrete type IDs such as `audiobooks.book` and `audiobooks.recording` describe those existing resources. Do not create a duplicate book resource merely to attach its new type. A proposed `core.item` kind accommodates new information without requiring media concepts; Notes could contribute `notes.note` without audio duration, chapters, cover art or a physical file.

Definitions use owner-qualified IDs, independent definition/schema versions and retained display labels. Core validates duplicate IDs, ownership, allowed references and compatibility before activation. Another module can explicitly use a public definition; it cannot redefine it. Breaking changes require a migration or a new definition ID. Renaming a UI label does not rename the registered ID.

Illustrative declarations, **not current SDK code**:

```ts
type ResourceTypeDefinition = {
  id: string;                 // e.g. audiobooks.book
  owner: string;              // audiobooks
  definitionVersion: number;
  label: string;
  baseKind: string;           // e.g. core.work
  fieldIds: readonly string[];
  relationshipIds: readonly string[];
  taxonomyIds: readonly string[];
};
type GenericDescriptor = {
  id: string;
  kind: string;
  typeIds: readonly string[];
  owner: string;
  title: string;
  revision: number;
  archived: boolean;
  source?: { adapterId: string; recordId: string; epoch: string; version: number };
};
```

Core retains the last published generic descriptor durably, together with a versioned generic publication of its queryable fields, relationships, term assignments, aliases and tombstones. A module-derived title is a retained snapshot of module data, not a second independently editable title. Ownership and provenance distinguish module facts from Core-authored information. Removing executable code must not remove these publications or run module deserialization to show them. This retained publication, rather than the module's opaque payload, supplies module-absent index rebuilding.

Resource revisions, source-feed versions, catalog revisions and definition versions have different purposes. Mutations check the appropriate expected resource/source revision; a display version or changed label is not a concurrency token.

A source epoch identifies a coherent feed history. Restoring an older authoritative backup needs an explicit reconciliation/new-epoch procedure; otherwise a retained high-water mark could incorrectly discard its lower source versions. Epoch changes invalidate projections/checkpoints as declared while preserving resource IDs and aliases.

## 2. Fields, relationships and memberships

Each field declares its ID, owner, applicable types, value type, cardinality, constraints, authority and supported filter/sort/search operations. Initial value types should cover text, boolean, integer, decimal, date-only, timestamp and references. Lists declare item limits. Missing, explicit empty, zero and false remain distinguishable. Dates are not silently converted between a calendar date and a timezone timestamp. Existing partial publication-year strings stay representable through the audiobook adapter.

Only declared queryable fields receive typed indexes. Specialized module payloads can remain opaque. A query must not perform arbitrary JSON expressions or execute module code per result row. Unregistered fields/operators fail with a useful validation error rather than silently scanning every payload.

| Example | Representation | Why |
| --- | --- | --- |
| Publication year, language, personal rating | Typed field, with an explicit storage/export owner | These are values, not parent categories. Personal ratings do not become embedded media tags. |
| Known author or narrator | Typed resource relationship and role | One person can have several roles and spellings. |
| Imported author/narrator strings | Ordered legacy field values until identity is resolved | A name alone cannot establish a unique person. Preserve contributor arrays; do not split every comma. |
| Series | Series resource plus membership attributes | Sequence belongs to the member's position in that series, not the series itself. |
| Collection | Core-owned collection plus membership | A collection can have metadata/manual order and need not be a taxonomy tree. |
| Genre or topic | Registered taxonomy and term assignments | Can support flat or hierarchical filtering. |
| Source/export/cover file | Resource link with a declared role | Moving a file differs from changing category membership. |

Relationship definitions declare permitted source/target types, direction, cardinality, reverse label and allowed edge fields. Core validates endpoints and writes only the owning facts. Cross-module relationships may use public IDs without permission to edit the target's content. The initial trusted in-process model is not a security sandbox.

Memberships retain stable IDs, raw sequence text, manual order and provenance where present. Preserve values such as `1.5` and `Omnibus`; optional numeric ordering is a separately declared, validated projection and must not overwrite the original text. Existing `MetadataMembership.id` values and legacy series aliases remain recoverable. Identical series names across authors do not prove one series.

Grouping remains an adapter/view concern. Current collections have project memberships while the Library displays grouped works. Preserve those underlying recording/project memberships and derive the group's displayed union. A later group split must not permanently give every recording all of its former group's collections. Existing group-wide add/remove commands must keep their current explicit expansion semantics through the compatibility adapter.

Notes/references target resource IDs with optional versioned owner-defined anchors. An audiobook timestamp targets its recording identity, not merely the abstract work or current filename. Retain an unavailable owner's anchor as opaque data; if content changes, report an unresolved anchor rather than silently relocating it. This defines a reference boundary, not the full Notes feature set.

## 3. Taxonomy

A taxonomy definition declares stable ID/owner/version, labels, applicable types, flat versus tree behavior, single versus multiple selection, creation/rename policy and supported filters. A term has its own permanent ID, taxonomy ID, label, optional parent ID, revision and archived status. Labels need not be globally unique; the UI can show the parent path to distinguish them. Creation can flag an apparent duplicate for confirmation without conflating IDs.

For the first version:

- One parent per term; reject self-parenting, cycles and cross-taxonomy parents in a transaction. Bound depth and traversal, initially 32 levels. Multiple classifications use multiple assignments, not multiple parents.
- Filters explicitly choose exact term or term-and-descendants. Show that choice in the UI. Counts use distinct displayed resources, not assignment-row totals; OR within one chosen vocabulary and AND between vocabularies is the default, with explicit alternatives in the query.
- Reparenting changes subtree matching, not resource identities or assignments. Term rename retains IDs. Archive retains references; destructive deletion requires an explicit reassignment/removal plan.
- Term merge is an explicit operation with preview, alias/redirection, revision checks and recovery material. Search normalization is not a merge operation.
- Use an adjacency parent link as authority. Benchmark an indexed closure projection against recursive queries before selecting the hierarchy index. Very broad trees can make closure tables expensive; do not implement both maintained strategies by default.

Start legacy genres/tags in explicit audiobook-owned vocabularies or retain them as projected fields until their mapping is approved. Do not silently merge them into a universal `core.genre` or `core.tag`. New shared tags may be Core-owned and reused by declared consumers. Series, collections and people are not converted into taxonomy terms just to reuse a picker.

## 4. One autocomplete service

All standard pickers use the same bounded service and result contract. Providers declare what they offer, which scopes may query them, allowed matching modes and whether selecting a result writes text, a term assignment or a relationship. Specialized collection/series rules stay in providers and membership editors, not separate autocomplete engines.

```ts
type SuggestionRequest = {
  providerId: string;
  fieldId: string;
  query: string;
  contextResourceIds?: readonly string[];
  limit: number;              // proposed default 20, hard maximum 100
  cursor?: string;
};
type Suggestion = {
  key: string;                // stable provider-qualified identity
  label: string;
  value: string;              // resource/term ID or preserved text value
  valueKind: 'text' | 'term' | 'resource';
  reason: 'exact' | 'prefix' | 'match' | 'recent' | 'related' | 'pinned';
  detail?: string;            // e.g. taxonomy path or relationship context
};
```

Use an indexed value directory for plain-text suggestions and term/entity indexes for references. Text value keys are scoped to a provider/vocabulary and a versioned equality policy; matching text values is not merging person identities. Retain selected/pinned value identities and labels durably so clearing the index does not break history. Rebuild observations and usage counts from their authoritative sources.

Keep display text unchanged. Use conservative versioned equality normalization—Unicode normalization, whitespace handling and defined case rules—and a separate, more permissive search key. Search may ignore accents without treating differently accented people or terms as one entity. Changing normalization requires versioned index rebuilding and explicit collision handling.

For typed text, rank exact and prefix matches ahead of weaker contains matches; then use pins, recency and contextual relevance as declared tie-breaks. For an empty query show pinned, truly recent and contextual options with clear reasons. Use stable ID tie-breaks, deduplicate by identity and retain already-selected values even when they are outside the current result page. Never limit the searchable universe to the first 100 fetched names.

Queries must cancel obsolete UI requests and ignore late replies. Proposed input bounds are 256 query characters and eight context resource IDs. Prefix matching supports short input. Indexed contains matching starts at three normalized characters; broader short searches require a narrower scope or an explicit bounded fallback. Compatibility endpoints keep their old behavior until callers migrate. A result limit does not justify an unlimited scan.

### Recent choices and author-related choices

Store actual selection history separately: local profile, provider/field, selected identity and preserved display value, committed time, use count and optional bounded context references. Resolve the profile from the host session, not an arbitrary module-supplied profile ID; a single-user installation can use its default local profile without adding a multi-user system. Merely opening a menu, highlighting an option, cancelling or failing a save must not make an item recent. Record after a successful canonical save; use a mutation receipt/idempotency key so retries do not count twice. Proposed retention is the latest 50 distinct values per profile/provider/field and 5,000 overall per profile, with oldest-entry eviction and a Clear history action. Selection history stays out of media tags, sidecars and other profiles.

Author-related choices are a different, rebuildable index of observed relationships/memberships. A confirmed author resource ID can give strong context. Legacy author names can give labelled heuristic context within the audiobook provider, without claiming person identity or merging records. Store/index the relevant associations incrementally; do not rescan every project's JSON for each keystroke. When an assignment is removed, update its observation counts; actual selection history is unaffected. Imported timestamps and collection row order are not backfilled as invented user selections.

## 5. Queries, browser views and bulk actions

The proposed generic query declares resource types, typed predicates, taxonomy inclusion mode, relationships, text, sort, requested projection and cursor. Core validates identifiers/operators and binds values; modules do not send SQL. Sorts define missing-value behavior and always end in a stable ID. Default result limit is 50, maximum 500; relation pages and picker pages are separately bounded.

Retain revision-bound cursors and explicit stale-cursor responses. The generic page may expose `total` as exact, pending or unavailable; it must not report a partial count as exact or delay every first page for an expensive aggregate. Keep contract-1 responses unchanged behind adapters. A new response shape needs a separately versioned contract and compatible callers.

Modules contribute declared columns, filters, display fields, artwork/preview descriptors, supported view modes and command IDs. The browser owns list/grid/shelf rendering, virtualization, selection, keyboard behavior, loading and missing-module presentation. Load specialized details only when opened, not for all results. Artwork is optional; title/icon/details are the generic fallback. UI labels never determine identity.

Descriptions returned with resource data are inert data, not executable code, HTML or filesystem access instructions. Commands resolve only to active registered handlers. Activation can add executable contributions; deactivation removes them while retaining safe descriptors and saved layouts. Local assets/previews use host-resolved handles. These contracts do not introduce remote publication or unrestricted plugin execution.

Bulk selection freezes IDs plus query revision and expiry, using the existing disk-backed selection approach. It does not grant filesystem authority. Commands validate ownership, current revisions, applicability and actual paths again when they execute. Large operations run in bounded chunks with explicit progress, cancellation boundaries, per-item outcomes and retry identity. No promise of one transaction across thousands of files. Adding an item to a collection must never imply moving its physical file.

## 6. Durable ownership and indexing

Proposed ownership using the existing store family:

| Information | Authority | Rebuild behavior |
| --- | --- | --- |
| Audiobook processing state/content and linked legacy metadata | Existing `jobs.json.sqlite`, interpreted by Audiobooks | Retained; never rebuilt from a browse index. |
| Generic descriptors, aliases, identity mappings and retained definition labels | Evolved `catalog.sqlite.user.sqlite`, managed by Core | Survive module absence and catalog deletion/rebuild. Module-derived snapshots retain provenance. |
| Core-authored terms, assignments, entities/relationships, collections and explicit history | Evolved durable user database | Backed up and migrated as user data. |
| Legacy module-authored classifications/relationships | Module source facts, with versioned durable descriptor/provenance publication | Replayed by adapter; not independently editable copies. |
| FTS, normalized keys, typed field indexes, hierarchy projections, observed associations/counts | Rebuildable `catalog.sqlite` projections | Recreate from durable Core facts and module publications/checkpoints; show pending freshness. |
| Preview/waveform/media observations | Existing explicitly owned caches/artifacts | Keep their existing lifecycle; no automatic probing during resource queries. |

Every editable fact has one authoritative writer. For a legacy-linked field, the browser invokes its owner command and observes the resulting publication. Core-native taxonomy edits go to Core. Do not create two writable copies of the same author, genre or collection membership, and do not silently decide that a recent index row wins.

Existing collection writes already bridge durable catalog membership and project metadata through a callback, and project projection can update those memberships again. Inventory that bridge explicitly before moving collection authority. Add reconciliation/version checks and failure/restart tests so an old projection cannot undo a newer collection edit; do not treat either existing side as a disposable duplicate during migration.

Use transactions within each authoritative database and a durable change feed/outbox recorded with its source mutation. Publication captures a consistent source snapshot and monotonic source version; acknowledgements/checkpoints make replay idempotent, and older observations cannot overwrite newer edits or tombstones. Do not assume one atomic transaction across separate WAL databases. If projection publication fails after a successful save, return saved/pending status with a receipt; replay publication rather than reapplying the edit. A caller may wait boundedly for that receipt to be indexed, then show pending freshness.

The worker schedules interactive reads ahead of bounded indexing/maintenance batches, with progress, cancellation and backpressure. Pausing a background rebuild must not prevent browsing the last usable generation. A replacement generation is published only after validation and catch-up; retain the old usable generation on failure. Core-only rebuilding must use durable generic publications even if no audiobook adapter is installed. Before planned module removal, attempt a bounded publication catch-up. If it cannot complete, retain the opaque source data and checkpoints and label the last publication stale; do not imply it contains the latest unpublished edits. Reinstallation resumes publication.

Candidate physical tables/indexes are **a benchmark input, not approved DDL**: definitions/descriptors; typed scalar and multi-value projections; relationship endpoints plus declared attributes; taxonomy terms/assignments and candidate hierarchy projection; scoped value entries/observations; local selection history; change feed/checkpoints/tombstones. Index both relationship directions and both resource-to-term and term-to-resource membership access. Do not index arbitrary plugin JSON or create an index for every possible field automatically.

## 7. Migration and compatibility gates

1. **Inventory and recovery first.** Verify old schema versions before writes. Quiesce mutations and take verified SQLite snapshots that include committed WAL content, plus source-version/identity/count manifests. A raw database-file copy while writers run is insufficient. Preserve existing backups and the original JSON compatibility files.
2. **Declarations and read adapter.** Add a framework-independent registry behind a development path, validating namespaces/types/collisions. Adapt existing audiobook summaries/identities to the proposed descriptors. Keep current APIs, editing and storage authoritative. This step does not introduce writable installed SDK access.
3. **Versioned durable descriptors.** Add reviewed migrations and future-version refusal for the user database before adding authoritative data. Backfill in bounded, checkpointed batches using consistent source versions. Preserve all existing aliases, work/recording/file IDs, group links, membership IDs and tombstones. Retain enough labels/descriptors for module-absent browsing. Do not rehash titles or paths into new identities.
4. **Shadow projections.** Build typed indexes and a value directory without switching the UI. Compare IDs, grouped counts, exact/empty values, order, term/relationship assignments and late-name suggestions against source facts. Preserve old series/collection scope; flag ambiguous identity mappings rather than merging them. Legacy strings remain intact.
5. **One write path per migrated fact.** Keep legacy-linked fields module-owned until an explicit ownership migration is reviewed. Core-native fields may be added separately. Before migrating a fact's authority, specify compatibility serialization, crash recovery, conflicts and rollback; do not keep uncoordinated bidirectional dual writes.
6. **Switch bounded reads and pickers.** Enable per feature after correctness/performance gates pass. Preserve selection and unsaved drafts. A feature switch can roll back reads while old schema-compatible writes continue; it does not downgrade an incompatible authoritative database.
7. **Core-only acceptance and package boundary.** Rebuild the browse index with Audiobooks code physically absent. Browse retained descriptors/classifications, disable unavailable commands and require no audiobook model initialization. Reinstall restores module interpretation without reimport/transcription. Only then expand installed SDK capabilities through a separately versioned trusted contract and complete repository separation.

On any migration failure, keep originals/recovery material, leave the last usable reads available where safe and present the actual problem. An older app must refuse unsupported authoritative schemas before modifying them. After new-format user edits, downgrade requires an explicit supported export/restore path; merely toggling a flag is not safe rollback.

## 8. Proposed acceptance targets

These are **initial engineering budgets to test and revise openly**, not measured results. Record CPU, RAM, SSD, OS, Node/SQLite versions, database/WAL sizes, dataset seed, index generation and query plans. The proposed reference is a local SSD machine with at least four logical CPU cores and 16 GiB RAM; results on network shares are a separate workload.

| Workload | Initial p95 target |
| --- | --- |
| Warm first resource page / following cursor, 50 summaries | 200 ms baseline; 400 ms scale |
| Prefix autocomplete, up to 20 items | 100 ms baseline; 200 ms scale |
| Indexed contains autocomplete, query length at least three | 200 ms baseline; 350 ms scale |
| Taxonomy exact/descendant filter first page | 250 ms baseline; 500 ms scale |
| Reopen Core's existing stores to usable cached browse | 3 s baseline; 5 s scale; measure full startup separately |
| Ordinary single edit to visible indexed result | 1 s baseline; 2 s scale, with saved/pending feedback immediately after commit |

Baseline data must include at least 40,000 file records and representative resource/group memberships. The scale profile retains the existing benchmark's 500,000 logical entries and 500,000 files; report work/recording/file resource totals separately, rather than calling them all files. Add sparse and dense taxonomy/relationship variants, including at least 5 million assignments in the dense scale profile. Test repeated names, late-alphabet names, Unicode, multi-author records, empty values, heavily reused terms, 32-level trees and large descendant subtrees. Additional real file-type readers/editors remain deferred; synthetic generic descriptors are a contract test, not proof that those modules exist.

Measure warm/cold results separately, p50/p95/p99 over repeated runs, and concurrent indexing, playback, edits and bulk operations. Record count/selection completion separately from first-page response. Broad counts may stay pending; bulk selection and large imports are cancellable jobs with measured throughput and durable restart checkpoints. Fail the design gate if keystrokes scan every payload, browsing probes files, short/common queries become unbounded or maintenance starves playback.

After warm-up, repeated browsing must retain bounded windows/cache entries and show no continuing retained-memory growth; set a measured resident-memory budget before acceptance. Report total app/worker memory separately from benchmark-process memory and include user database, catalog and WAL growth. Do not infer a universal guarantee from one favorable query or the historical [catalog benchmark](CATALOG-VERIFICATION.md).

## 9. Next executable batches

Implementation checkpoints: [Batch 8](BATCH8-REGISTRY-READ-BRIDGE.md) supplies the registry/read bridge; [Batch 9](BATCH9-DURABLE-FOUNDATIONS.md) supplies opt-in durable foundations. The table remains the approved scope/gate sequence. Review [storage activation and recovery](INFORMATION-DURABILITY-MIGRATION.md) before using the new migration on authoritative data.

[Batch 10](BATCH10-DIRECTORY-AND-PICKER.md) now supplies the opt-in directory/history and Series picker pilot. Its implementation record distinguishes supported text/term queries from resource providers/pins and full taxonomy operations that remain unavailable, and links the scoped measurements and schema-2 recovery review.

| Batch | Deliverable | Gate before the following batch |
| --- | --- | --- |
| 8: declarations and read bridge | Type/field/relationship/taxonomy/provider/view registry contracts and an audiobook adapter exercised against existing records. No new authoritative user-data schema. | Existing IDs/behavior match; invalid registrations fail; absence of owner yields inert descriptors. Review the contract shape. |
| 9: durable foundations | Version guards, verified backup/recovery, durable generic descriptors and replay/checkpoint infrastructure. | Crash/restart, future-schema refusal and module-absent index rebuild preserve data and identities. Review migrations. |
| 10: indexed directory and picker pilot | Indexed value/term projections, actual local selection history and one existing metadata picker using the shared service. | Late-value search, cancelled/failed saves, recency/context distinction and performance budgets pass. |
| 11: remaining Core extraction | Neutral browse/playback/logging interfaces, module-owned settings/requirements, complete package loading and Core-only acceptance. | Full enabled/absent/reinstalled installations preserve saved work; then separate repository delivery. Split this batch further when its implementation inventory is known. |

This sequence supports Alpha 6's shared browser and Notes core without committing to a complete universal content system, workflow editor or future module catalogue. The detailed physical schema and public writable SDK are intentionally not finalized by this review document.
