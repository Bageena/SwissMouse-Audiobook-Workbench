# Module and extension boundaries

Alpha 6 development carries forward the released Alpha 5 audiobook foundation. These boundaries let future modules reuse shared services. Provisional sections describe future contracts, not implemented notebooks, a workflow editor, a plugin store, a server or a permission system.

The [Alpha 6 goals](ALPHA6.md) include complete Audiobook module extraction, contributed settings in Preferences, and a Notes core. [Batch 11](BATCH11-SEPARATE-APPLICATION.md) adds a separate Core entry point and a full trusted application contract: protocol 2, SDK 0.0.2, host React 18, a separate Node backend process and explicit install/restart/disable/remove lifecycle. The older contract 1 descriptions below cover the built-in registry and read-only proof, not the full application protocol. Repository delivery and final acceptance are tracked in the Batch 11 checkpoint.

## Implemented: built-in modules, contract 1

The separate [Batch 1 package proof](BATCH1-MODULE-PROOF.md) now adds a minimal trusted, locally approved module loading path alongside this temporary built-in composition. Its public types live in `packages/sdk`; it supports a packaged read-only panel/operation and restart-based lifecycle. It is not a general third-party plugin loader or complete Audiobook extraction.

`src/core/modules.ts` provides a trusted in-process registry. A manifest declares a stable lowercase ID, friendly name, contract version, resource kinds used and namespaced workspace descriptions. Registration rejects duplicate module IDs, unsupported contract versions and invalid workspace ownership. The returned contribution object retains its component types.

`packages/audiobooks/src/workspace-contributions.ts` owns audiobook workflow and panel descriptions. The old manifest path re-exports those definitions for compatibility. The temporary built-in client entry at `src/modules/audiobooks/index.ts` exposes its workspace/controller and activation. Startup calls activation explicitly; its reference-counted cleanup unregisters audiobook panels/workspace descriptions and preserves stored layouts. Standard header and file-browser panels remain in the shared catalog. Existing layout storage keys remain unchanged. These are compiled-in contributions, separate from the installed package proof. Registration does not grant security privileges or make arbitrary third-party code safe.

| Shared foundation | Audiobook responsibility |
| --- | --- |
| Resource IDs, catalog query/relations, durable aliases | Book identification, recording membership and audiobook metadata |
| Container shell, layout primitives, theme tokens and common feedback | Book Files, chapter review, processing, export and validation screens |
| Runtime discovery, installation ownership and dependency gates | Declaring which media tools an audiobook operation needs |
| Persistence mechanics and safe migration infrastructure | Current project payload and its interpretation |

The module's client controller/view now coordinate audiobook state and rendering. Module-owned HTTP services and a framework-independent edit controller live in `packages/audiobooks`; the legacy screen/type adapter remains compiled in, and existing backend routes still implement audiobook operations. This is not complete standalone extraction. The installed Batch 1 example remains read-only; disabling it does not disable the built-in workflow. Follow the [Audiobook separation plan](AUDIOBOOK-SEPARATION-PLAN.md) and [Batch 2 checkpoint](BATCH2-CHECKPOINT.md) for the remaining backend, shared-service, dependency, Core-only and separate-repository work. Reuse shared storage and runtimes rather than duplicating them in each module.

Batch 3 adds `packages/audiobooks/src/backend.ts` as the built-in command entry. Project access, metadata/draft saves, bulk library metadata, chapter saves/CSV import, and chapter/FFmetadata downloads delegate through `tools/audiobook-project-routes.ts`. The package receives specific store, catalog, sidecar and busy-guard interfaces; it does not import Express, private host types, or the database implementation. Shared request/runtime guards remain ahead of these routes. Compatibility exports retain the old type/helper paths. The installed SDK's `readRecord` stays read-only; this built-in backend context is not an additional permission grant to installed packages. See [Batch 3](BATCH3-BACKEND-COMMANDS.md) for ownership limits and validation.

Batch 4 adds module-owned file coordination for imports, source selection/order, discovery, transfers and startup transfer-journal recovery. `tools/audiobook-file-route.ts` adapts the existing 26 HTTP handlers to plain command inputs and replies; original route positions and middleware remain. The host supplies named file/media/provider services through `AudiobookFilePorts`, including the unchanged verified-transfer engine. Source imports, moves and scans share one activity state with the remaining built-in routes. Persisted legacy audiobook types and pure source/metadata rules now live in the package with compatibility re-exports at old paths. `packages/sdk/file-transfers.ts` describes existing transfer data only; it grants no file capabilities. These ports and legacy response shapes remain provisional internal contracts, including some untyped decoder replies. They are not a finalized writable extension SDK or a sandbox. See [Batch 4](BATCH4-FILE-COORDINATION.md).

Batch 5 adds module-owned source processing, transcription, chapter detection/extraction and independent reruns. Five HTTP registrations delegate to `processing-backend.ts` through the existing reply adapter. `processing-state.ts` holds the single running/abort/progress state used by both the coordinator and host busy guards. Background work yields so the adapter sends its start reply before synchronous probing. Existing engines and runtime discovery arrive through `AudiobookProcessingPorts`; pure transcription/cache/heading/alignment/eligibility rules live in the package with compatibility exports. Cancellation, cache keys, manual-chapter confirmation and experimental review-only suggestions retain their existing behavior. Export/finalization and settings/dependency ownership remain later slices. These are trusted built-in integration contracts, not new installed-module permissions. See [Batch 5](BATCH5-PROCESSING.md).

Batch 6 adds the completion backend and separate export, metadata-writing and cleanup services. Fifteen legacy HTTP registrations, including both export aliases and candidate CSV, delegate through `tools/audiobook-completion-route.ts`; middleware stays at the original route positions. Module state owns validation runs/controllers, export progress and metadata-writer locks and is shared with host busy checks. Archive journal recovery is explicitly called before transfer recovery, discovery and listening. Existing archive, audio, playback-provenance, Final Check and verified-transfer engines remain host-supplied. Format policy and sidecar serialization/writing now live in the package with old-path compatibility exports. These internal ports do not add installed-module permissions; removing the Batch 1 example still does not remove the built-in audiobook experience. See [Batch 6](BATCH6-COMPLETION.md).

## Implemented: resources and containers

For the proposed next contract, see [Shared information contracts](SHARED-RESOURCE-CONTRACTS.md) and the [Batch 7 review](BATCH7-SHARED-CONTRACTS.md). Those documents do not alter the implemented contract-1 resources or installed read-only SDK described here. Definition registration, durable generic publications, taxonomy, actual selection history and writable capabilities require the listed implementation/review gates.

[Batch 8](BATCH8-REGISTRY-READ-BRIDGE.md) now implements prototype declaration registration and an opt-in Audiobook summary read bridge. Its types are isolated in `packages/sdk/information.ts`, outside the installed SDK index. Registration is atomic, owner-scoped, version-checked and data-only; inactive-owner presentation retains labels in memory and exposes no actions. The preview uses existing catalog paging and IDs and has no writes or new schema. This is trusted built-in composition, not a generic executable plugin loader or durable missing-module recovery.

[Batch 9](BATCH9-DURABLE-FOUNDATIONS.md) adds a separately enabled authoritative publication store and generic replay index. It retains inert definitions and complete descriptions, with receipts/epochs/tombstones and a reviewed recovery path. Its internal publication type is not an installed SDK grant. The generic engine can rebuild without Audiobook imports; complete host/package absence has not yet been established. See the [migration review](INFORMATION-DURABILITY-MIGRATION.md) for exact storage and downgrade limits.

[Batch 10](BATCH10-DIRECTORY-AND-PICKER.md) implements experimental shared text/term provider queries and saved selection history behind the directory flag. Requests name validated provider/field IDs; text equality and search normalization are separate, paging/work are bounded and profile identity comes from the host. The Series pilot stages a choice until canonical Save, then uses an atomic source receipt and replayed Core history. Resource-entity providers, pins, general taxonomy writes and writable installed SDK capabilities remain unavailable.

Resource contract 1 is defined in `src/core/resources.ts` and exposed through `/api/catalog/contract`. References use stable resource IDs, never display names, folder paths or container IDs. Work, recording and file identity are distinct. Consumers must handle missing/archived resources and bounded, revision-aware query pages.

The container registration and layout types are exposed from `src/workspace/index.ts`. Definition IDs identify reusable container types; instance IDs identify placements. Browser-local layouts are presentation state, separate from project data. No arbitrary JavaScript or executable strings may be introduced through saved layout descriptions.

The same public entry point exports the [panel catalog](PANELS.md): `registerPanel`,
`getPanelDefinition`, and `listPanelDefinitions`. Each built-in panel has a stable
ID, unique friendly name and fixed Parent/Child role. Container kinds describe
presentation; roles control docking. This catalog is available without mounting
every screen and provides descriptors for future menus and theme tooling.

## Provisional: portable workspace descriptions

Proposed fields: `schemaVersion`, `moduleId`, `workspaceId`, `templateId`, and a bounded list of instances with `instanceId`, `definitionId`, layout and resource bindings. Friendly labels are editable; IDs are not labels. Store compact configuration and overrides, not copies of media, transcripts or catalog results. Whether templates use snapshots or inherited defaults needs a migration policy before implementation.

An unavailable module/component should produce a recoverable placeholder retaining its configuration. Switching layout mode must preserve content state. Importing a workspace must validate its version, IDs, bounds and installed contributions; it must not install or execute code automatically. Existing browser-local layouts are not yet this portable format.

## Provisional: resource bindings and notebook references

A binding should contain a resource ID and optional relation/query configuration, with the owning module and reference format version. Queries need paging, cancellation and access checks. References resolve through a shared service, not direct reads of another module's tables.

A notebook reference should use a stable notebook/entry ID and optional resource ID plus a typed anchor, such as a recording time range. Time anchors refer to a recording, not merely a book title; changed recordings can invalidate anchors. Item, series, collection and global views should aggregate authorized references rather than duplicate notes. No notebook storage, query engine, anchor resolution or cross-module access enforcement is implemented in Alpha 5.

## Provisional: actions and jobs

Future contributed actions need namespaced IDs, a contract version, input/output validation, a target resource type, dependency requirements and declared effects (read, write, external command). The host should own scheduling, cancellation, concurrency locks and progress. Long tasks must expose queued/running/completed/failed/cancelled state and whether cancellation is still safe. Retrying a write needs an idempotency/recovery rule; it must not silently repeat destructive work.

Current audiobook APIs and runtime gates remain the working implementation. There is no general action dispatcher yet. Future command-line widgets must use validated executable/argument bindings and explicit capability checks; workspace files must not become shell scripts.

## Provisional: permissions and installation

Future manifests should declare capabilities, while the host/server authorizes every action and resource read. Hiding a button is not authorization. Example capability families are resource read/write, workspace edit, runtime install, external process execution and remote access. Untrusted plugins will need an isolation model before execution support is added.

Runtime tools are centrally owned. Modules request compatible capabilities rather than installing private duplicates. Version conflicts, license/distribution rules and per-user secrets need explicit handling; API keys must not be included in downloaded workspaces. No enterprise roles, remote authentication, third-party module installer or plugin dependency solver is promised by these provisional descriptions.
