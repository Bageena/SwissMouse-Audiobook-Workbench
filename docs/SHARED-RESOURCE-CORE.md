# Shared resource core: direction and performance requirements

Recorded October 28, 2026. This is design direction for Alpha 6, not a claim that the generalized systems below are implemented. Existing catalog and audiobook workflows remain the starting point.

## Three distinct experiences

- **File Browser:** navigates physical directories and files, with explicit filesystem operations.
- **Shared resource browser (working name):** presents information managed by SwissMouse in easy-to-browse views such as shelves, covers, thumbnails, and lists. Steam Big Picture is an experience reference, not a requirement to reproduce its appearance or implementation. The final product name is undecided.
- **Desktop:** a future desktop-like environment for opening modules and tools. Existing movable workspaces are a foundation, not proof that the complete desktop launcher is finished.

The current File Manager name is ambiguous. Do not rename existing UI or component IDs solely from this discussion. Clarify responsibility and preserve saved layouts before choosing names or moving components. The physical browser and managed-information browser may reuse rendering and selection infrastructure, while retaining different meanings for actions such as moving a file versus adding a resource to a collection.

## Immediate design scope

Focus on these related core services before adding more domain-specific implementations:

1. Registered resource types and stable resource identities.
2. Typed metadata fields with explicit validation, filtering, and sorting behavior.
3. Typed relationships among resources and entities.
4. Registered taxonomies, their terms, and resource assignments.
5. Shared query/view contracts and module-provided presentation descriptors.
6. Shared autocomplete infrastructure with provider-specific sources and rules.

These support the existing Alpha 6 goals; they do not constitute an additional commitment to ship every future module. Testing additional file/resource types is deferred until a later step at the maintainer's request. Design the contracts to support them without implementing their readers/editors now.

## General information, not only entertainment media

The model must accommodate books, recordings, games, spreadsheets, database files, list files, images, notes, and other information. A resource may reference one file, several files, or no physical file. A module decides which domain objects it exposes; recognizing a database file does not automatically import all of its tables and rows.

Do not require every resource to have an author, chapters, a cover, or audiobook processing state. Provide a generic title/icon/details fallback when a module cannot supply a richer presentation. View changes must retain resource identity and must not duplicate its stored content.

Modules contribute declarations and adapters to shared services rather than implementing their own competing library browser, taxonomy database, and autocomplete engine. Specialized viewers and editors remain appropriate module contributions.

## Taxonomy within the wider model

The WordPress-style registration concept is the reference: modules can declare taxonomies and associate them with supported resource types. A taxonomy describes a classification vocabulary; its terms are the selectable entries. Some vocabularies are flat; others have parent/child terms.

Keep classification separate from typed properties and entity relationships. For example, Finance > Budgets can classify a spreadsheet; a reporting date is a typed field; its creator is a relationship to a person. Series ordering is membership information, not automatically taxonomy parentage.

The proposed registration contract should define stable namespaced IDs, ownership, labels, applicable resource types, hierarchy rules, selection cardinality, and supported query/display behavior. Shared vocabularies require explicit reuse; matching labels alone do not merge terms or entities. Details such as single-parent versus multiple-parent hierarchies remain design decisions. Hierarchies must reject cycles and define whether a filter includes descendant terms.

User-created terms, assignments, aliases, and other authoritative edits need durable storage and migrations. Search indexes and computed counts may be rebuildable. Removing a module must preserve user information and enough type/term descriptors to support recovery rather than erase its resources.

## Speed is a design requirement

The maintainer's approximately 40,000 media files are a relevant baseline, not the maximum design scale. The existing 500,000-file direction remains a larger-scale target. Neither number is a current generalized-taxonomy performance guarantee. File count, logical resource count, term count, and assignment/relationship count must be measured separately.

Design requirements:

- Query indexed types, fields, term assignments, and relationships instead of repeatedly extracting and deduplicating values from every project's JSON during interactive use.
- Maintain search projections incrementally as saved records change; avoid whole-library rebuilds for ordinary edits.
- Bound response sizes and rendered rows. Use cursor-based browsing where appropriate, lazy thumbnails/details, and cancellable searches. A result limit alone does not bound database work.
- Plan efficient hierarchy queries, including descendant filters and counts. Compare candidate index/hierarchy representations against representative workloads before choosing the schema.
- Autocomplete must search beyond the first prefetched page of names, use the shared query infrastructure, and distinguish actual selection history from inferred recent membership.
- Keep heavy indexing and maintenance away from interactive request handling, and schedule background batches so they do not monopolize the catalog worker or disrupt playback.
- Identify when counts or observations are still updating. Cached results must have explicit invalidation/version rules rather than silently become stale.
- Do not scan/probe every source file or resolve every module's full payload simply to display a page of resource summaries.

Define and measure latency targets before calling the design optimized. Include first-page load, continued scrolling, typed suggestions, taxonomy filters (including descendants), counts, bulk selection, edits, startup, memory, and database growth. Record warm/cold behavior and latency distributions while indexing and playback run. Test broad/short queries, heavily reused terms, deep hierarchies, and resources with many assignments; a single favorable search is insufficient evidence.

Existing catalog measurements in CATALOG-VERIFICATION.md cover a narrower synthetic audiobook workload. They do not validate the future taxonomy schema or mixed-module workloads. Additional resource-type tests remain deferred; record them as future validation rather than claim coverage now.

## Next design deliverable

The [Batch 7 review](BATCH7-SHARED-CONTRACTS.md) now provides the [proposed shared information contracts](SHARED-RESOURCE-CONTRACTS.md): resource/type/field/relationship/taxonomy contracts, durable-versus-derived ownership, autocomplete/history and browser contributions, with migration and performance acceptance criteria. These remain a proposal, not shipped schemas or SDK capabilities. Review the contract shape before implementing a general schema or expanding module installation around it. The next proposed executable slice is the declaration registry and audiobook read bridge, keeping existing user-data authority intact.

Following maintainer approval, [Batch 8](BATCH8-REGISTRY-READ-BRIDGE.md) implements that registry/read-bridge slice as a session-only, opt-in read prototype. The next storage step remains the reviewed durable-publication/migration foundation. Taxonomy persistence, actual selection history, the new suggestion query engine and general browser UI are not implemented by the prototype.

[Batch 9](BATCH9-DURABLE-FOUNDATIONS.md) now implements an opt-in durable publication store, recovery safeguards and a generic index replay engine. The full host is still coupled to Audiobooks. Read the [migration review](INFORMATION-DURABILITY-MIGRATION.md) before activating it on authoritative data; taxonomy terms, selection history and performance acceptance remain separate work.

[Batch 10](BATCH10-DIRECTORY-AND-PICKER.md) now adds the opt-in text/term suggestion directory, retained local selection history and a Series picker pilot. [Measurements](BATCH10-PERFORMANCE.md) cover synthetic picker workloads, not complete mixed-library or taxonomy-filter acceptance. The full host/package separation, additional callers and general taxonomy operations remain outstanding.
