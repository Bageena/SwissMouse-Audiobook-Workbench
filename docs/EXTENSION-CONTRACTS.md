# Alpha 5 extension boundaries

Alpha 5 remains an audiobook application. These boundaries let future modules reuse shared services without implementing notebooks, a workflow editor, a plugin store, a server or a permission system now.

## Implemented: built-in modules, contract 1

`src/core/modules.ts` provides a trusted in-process registry. A manifest declares a stable lowercase ID, friendly name, contract version, resource kinds used and namespaced workspace descriptions. Registration rejects duplicate module IDs, unsupported contract versions and invalid workspace ownership. The returned contribution object retains its component types.

`src/modules/audiobooks/manifest.ts` owns the audiobook workflow descriptions; `src/modules/builtins.ts` registers its screens. App composition obtains those screens from the registration and navigation uses the same workflow definitions. Existing layout storage keys remain unchanged. These are compiled-in contributions, not a manifest-driven executable loader. Registration does not grant security privileges or make arbitrary third-party code safe.

| Shared foundation | Audiobook responsibility |
| --- | --- |
| Resource IDs, catalog query/relations, durable aliases | Book identification, recording membership and audiobook metadata |
| Container shell, layout primitives, theme tokens and common feedback | Book Files, chapter review, processing, export and validation screens |
| Runtime discovery, installation ownership and dependency gates | Declaring which media tools an audiobook operation needs |
| Persistence mechanics and safe migration infrastructure | Current project payload and its interpretation |

The React host still coordinates audiobook state and existing backend routes still implement audiobook operations. This small composition boundary is not a completed extraction of the module into a standalone package. Move ownership behind services incrementally when a second real consumer needs it; do not duplicate storage or runtimes in each module.

## Implemented: resources and containers

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
