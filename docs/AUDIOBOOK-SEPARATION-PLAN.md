# Separating SwissMouse core from Audiobooks

Status: design plan updated after maintainer discussion, October 28, 2026. This document records the intended architecture and recommended delivery approach; it does not establish implementation or verification status. Updating this plan does not itself start the code extraction.

Implementation update: [Batch 1's read-only package proof](BATCH1-MODULE-PROOF.md) now implements the minimal SDK/loading slice. The broader extraction stages and Core-only acceptance below remain outstanding.

Batch 2 now moves client coordination and rendering out of App, adds module-owned edit/session and HTTP services, and activates audiobook panel/workspace contributions explicitly. See the [implementation checkpoint](BATCH2-CHECKPOINT.md) for validation, the temporary built-in adapter, and the remaining backend/package extraction.

[Batch 3](BATCH3-BACKEND-COMMANDS.md) implements the first backend slice: project access, metadata/draft saves, and chapter review commands. The existing routes delegate to module-owned commands through explicit storage, catalog, sidecar and guard services.

[Batch 4](BATCH4-FILE-COORDINATION.md) moves import/source membership and ordering, book discovery, transfers and their startup recovery into the package. Existing request guards, verified file engines, durable storage and legacy API paths remain in use.

[Batch 5](BATCH5-PROCESSING.md) moves processing orchestration, transcription, chapter detection/extraction and reruns, including their progress, cancellation and cache policies. The server supplies existing execution engines and runtime discovery.

[Batch 6](BATCH6-COMPLETION.md) moves export, embedded metadata writing, Final Check, finishing, cleanup and archive recovery into module-owned services. This implements the fourth planned backend slice. It does not establish a domain-neutral Core: legacy browse/playback/Book Files/provider adapters, shared-service assumptions, settings/dependencies and independent client/backend packaging still need review and extraction. Review the shared information contracts before widening the schema or public installation boundary.

[Batch 7](BATCH7-SHARED-CONTRACTS.md) now supplies that source review and the [proposed shared information contracts](SHARED-RESOURCE-CONTRACTS.md). It is a documentation/design checkpoint, with migration/performance gates and an incremental registry/read-bridge slice proposed next. No generic taxonomy schema or new writable installed SDK was implemented by this review.

Following approval of those recommendations, [Batch 8](BATCH8-REGISTRY-READ-BRIDGE.md) implements the declaration registry and an opt-in read bridge over existing audiobook catalog summaries. Definitions and retained labels are session-only; generic durable publications and a Core-only rebuild remain outstanding. The normal APIs, user-data schemas and installed SDK stay unchanged. Durable foundations require the next reviewed migration slice.

[Batch 9](BATCH9-DURABLE-FOUNDATIONS.md) adds those durable foundations as a separate opt-in path: guarded user-schema migration and verified recovery snapshots, complete retained publications, source epochs/outbox replay and a generic index engine that rebuilds without the audiobook adapter. Review the [migration and recovery procedure](INFORMATION-DURABILITY-MIGRATION.md) before enabling it on real data. Full Core-only application acceptance, indexed autocomplete/history, collection ownership changes and separate-repository delivery remain outstanding.

[Batch 10](BATCH10-DIRECTORY-AND-PICKER.md) adds opt-in shared text/term suggestion indexes, actual local selection history and a Series metadata-picker pilot. Source save receipts and Core history replay are tested across failure/restart; [synthetic performance evidence](BATCH10-PERFORMANCE.md) is scoped to the picker engine. Remaining autocomplete callers, complete taxonomy browsing and the Batch 11 Core/settings/dependency/package inventory still need their own acceptance work. No real library was migrated.

[Batch 11](BATCH11-SEPARATE-APPLICATION.md) now implements separate Core/full-module candidates, neutral SDK preference/requirement storage, protocol 2 process loading and source staging for `Bageena/SwissMouse` and the existing `Bageena/SwissMouse-Audiobook-Workbench`. The checkpoint records validation and outstanding delivery gates; the original acceptance criteria below still apply.

## Outcome

SwissMouse should provide a useful environment without any Audiobook module code installed. Its standard tools and shared services must operate independently: physical file management, resource browsing, Preferences, basic playback, and the desktop/tool launcher as that surface is delivered. Installing Audiobooks adds its screens, project behavior, processing operations, and configuration through public interfaces, without rebuilding Core.

Users keep their existing books, source files, project IDs, chapters, transcripts, ratings, listening positions, and layouts. This is an ownership change, not a reason to reimport a library or rerun transcription.

The initial extraction stays in this repository while we establish separate packages and test their boundaries. Prove a small installable slice early, then move the complete Audiobook module to its own repository and deliver installation within SwissMouse. No language or UI-framework rewrite is proposed.

## Core as a small application environment

The maintainer's "mini OS" description is the product model: SwissMouse supplies the common environment in which applications work. It remains an application running on the user's operating system. Keep three architectural layers distinct even when the first two ship together as Core:

| Layer | Responsibility |
| --- | --- |
| Core platform | Resource identities, storage, safe file operations, background jobs, playback infrastructure, settings, module loading, and shared UI components. |
| Standard SwissMouse tools | Desktop/tool launcher, physical File Manager, shared resource browser, Preferences, and basic player. These use the public services and UI interfaces also available to modules. |
| Optional modules | Audiobooks and future specialized applications: domain-specific editors, workflows, processing rules, metadata interpretation, panels, and default workspaces. |

Standard tools can be included in the normal SwissMouse distribution without making their screen implementations part of every platform service. They do not each need an independent repository or installer in this extraction.

Keep the three user experiences explicit:

- **Physical File Browser / File Manager:** directories, files, and deliberate filesystem operations. Browsing a folder must not require an audiobook project or add its files to one.
- **Shared resource browser:** managed information presented as shelves, covers, thumbnails, and lists, with Steam Big Picture or Netflix as experience references. Modules supply resource descriptions, filters, previews, and actions; they should not each recreate the browser and catalog.
- **Desktop/tool launcher:** opens tools and module workspaces. Existing movable panels are a foundation, not proof that the complete launcher exists.

The full desktop remains separately tracked future work unless added explicitly to the release scope. Core-only acceptance covers the standard tools delivered in the release and records deferred surfaces; it must not claim an unfinished desktop is complete. See [Alpha 6 scope](ALPHA6.md) and [shared resource core direction](SHARED-RESOURCE-CORE.md).

SwissMouse should provide reusable panels, toolbars, tables, dialogs, form controls, theme tokens, and workspace mechanics. Modules contribute default panels and workspaces built from those components, plus their specialized contents and behavior. A chapter editor still needs audiobook-specific code; its window controls, common interactions, and styling come from SwissMouse. Shared UI reduces repeated frontend work without requiring every specialized editor to be generated from configuration.

## What the audit found before extraction

- `src/App.tsx` coordinates audiobook startup, active projects, draft saves, navigation, processing, reruns, metadata, export, validation, transfers, deletion, and playback. It also owns application appearance and common dialogs.
- `server.ts` mixes startup, shared configuration, logs, dependencies, recovery, and HTTP setup with audiobook import, discovery, metadata, processing, export, and validation.
- The existing manifest and registry expose audiobook screens, but `src/modules/builtins.ts` imports those screens directly. This is compiled-in composition, not independent installation.
- `src/core/catalog.ts` imports `LibraryBook` and audiobook-oriented filters/sorts. `tools/catalog-service.ts` consumes `AudiobookJob` and defaults to the audiobook projection. A file being under `core` does not currently mean it is domain-independent.
- Playback and Book Files routes already receive service objects, which is useful. Those objects still expose audiobook projects and rules, so they are starting boundaries rather than final core contracts.
- `WorkbenchConfig`, Requirements, the header, and Preferences contain audiobook-specific assumptions. They also need explicit owners.
- `src/workspace/panels.ts` registers audiobook panels when the shared catalog is imported, and `src/preferences/registry.ts` registers audiobook settings unconditionally. Registration ownership needs extraction as well as imports and business logic.

Batch 2 changes the first and last findings: App now composes the Audiobook client entry, while the module's controller/view own audiobook behavior; audiobook panel definitions register through activation. Preferences ownership, backend extraction, and complete removal of private host dependencies are still outstanding.

## Ownership we should establish

| SwissMouse core | Audiobook module |
| --- | --- |
| Application startup, generic navigation and module mounting | Book Files, audiobook navigation, five-step workflow |
| Workspace/panel mechanics, themes, Preferences shell | Audiobook panel contributions and default layouts |
| Resource identities, shared query contracts, taxonomy/relationship infrastructure | Book/recording interpretation and catalog projection |
| General filesystem and verified-transfer primitives | Book membership, source order, companion-file ownership and organization rules |
| Shared streaming/playback session infrastructure | Book timeline, chapter navigation and recording-specific resume mapping |
| Dependency discovery/installation ownership and operation coordination | Declarations of which tools and models an audiobook feature requires |
| Configuration/storage facilities and migration mechanics | Audiobook defaults, project schema and project migrations |
| Generic progress/logging and failure handling | Transcription, chapter detection/review, metadata writing, conversion and Final Check |

Some pieces must be split internally. For example, verified byte copying is general; deciding which sidecars belong to a book is audiobook behavior. The host should not receive an `AudiobookJob` merely to transfer bytes.

Removing Audiobooks entirely from Core means removing its domain rules, required types, executable code, and active contributions. Reusable file, playback, storage, and UI infrastructure stays shared even if Audiobooks was its first consumer. Preserved user data and generic descriptions of an unavailable module are not a dependency on that module's executable code.

## Public SDK, package identity, and source ownership

Define a small public SDK (developer kit) during the first stage, with API documentation, reusable UI components, and a working module example. The intended SDK surface should cover the following areas as extraction progresses; this is not a requirement to generalize every service before proving the first installable slice:

- Panel definitions, instances, default workspace contributions, navigation, and resource/action bindings.
- Shared components, theme tokens, and the supported React/UI integration contract.
- Preferences contributions, validation, defaults, and access to the existing settings store.
- Bounded resource queries, file-operation services, playback sessions, and storage facilities.
- Validated commands and background jobs with progress, cancellation, dependency checks, and recovery responsibilities.
- Activation/deactivation, contribution cleanup, compatible versions, and missing-module behavior.

Implement only the contracts required by the first read-only panel and backend operation initially. Extend the SDK through subsequent working slices; do not freeze a broad public contract solely from anticipated future needs.

Modules import public SDK/UI entry points instead of reaching into Core implementation files. Core platform packages must not import Audiobook implementations or types. Standard tools use those same public contracts. Automated dependency checks enforce these rules; directory names or repository boundaries alone do not.

Use separate package identities and explicit owners to identify code. Illustrative developer package names are `@swissmouse/sdk` and `@swissmouse/ui`; final published names remain to be chosen. Keep the existing stable module ID `audiobooks`, with namespaced contributions such as `audiobooks.chapters`. New contribution IDs should identify their owner. Preserve legacy panel IDs, layout keys, and resource IDs through explicit compatibility mappings where necessary rather than renaming saved state merely to fit a naming convention.

Distinguish the module's release version from the SDK/API contract version and its stored-data schema versions. The installation manifest needs the stable module/publisher identity, release version, compatible host/API versions, browser and backend entry points, contributed features, runtime dependencies, and declared access/effects. A repository rename must not change the identity of an installed module or its saved work.

Default workspaces are starting arrangements. Module updates must preserve user-customized layouts, panel instances, and bindings. Shared views refer to the same resource IDs and data rather than creating module-local copies of the library.

## Repositories and distribution

A repository organizes source development and history. A package is a versioned unit that can be built and distributed. The loader and public API make that package work inside SwissMouse. Separate GitHub repositories are optional for modules in general; they do not by themselves create runtime independence.

Recommended sequence for SwissMouse:

1. Establish separate Core, SDK/UI, and Audiobook packages inside this repository. npm workspaces can manage local package dependencies during the extraction.
2. Build and test Audiobooks against the public packages, with no imports of host implementation files. Keep SDK/UI source alongside Core initially and make versioned developer packages available to module repositories.
3. Once the boundaries work, move the complete Audiobook frontend/backend package to its own repository for independent development and releases, as required by the Alpha 6 goal. A separate repository for every shared component is unnecessary.
4. Distribute prebuilt module packages that users install through SwissMouse. Users should not need to clone a source repository, configure a development environment, or rebuild Core to add or update a module.

GitHub Releases is the recommended initial host for downloadable module artifacts. A small official module catalog should describe available versions, compatible host/API versions, publisher/source, artifact locations, and verification metadata. The catalog is a discovery mechanism; the installer must still validate each selected package. The built module artifact is distinct from GitHub's automatic source archive. Keep source and notice availability aligned with the existing release policy.

Reference patterns: [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/) supports multiple local packages, [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) distributes versioned artifacts, and [VS Code's extension manifest](https://code.visualstudio.com/api/references/extension-manifest) illustrates explicit identity, compatibility, entry points, and contributions. These inform the design; adopting another application's package format is not required.

## Initial execution and installation model

For Alpha 6, start with trusted official modules. Allow a SwissMouse restart for activation, updates, and removal; seamless hot replacement is not an acceptance requirement. Choose and document the browser/backend loading mechanism during the first stage. Trusted backend modules may initially run in process, but the public service boundary should remain explicit.

Define how prebuilt module UI uses the host's supported React runtime and shared components, how backend entry points and workers resolve their packaged dependencies, and how contributions are registered and removed. Installing a module must not require recompiling the host or changing its source imports.

For UI mounted in the host's React tree, the loading contract must resolve the module and host renderer to the same supported React runtime and the intended shared UI/context instances. Do not accidentally bundle a competing runtime or duplicate context-owning infrastructure. Verify styles, theme tokens, images, and worker assets from the installed package, including module-owned styles not present when Core was compiled. Test both initial load and an updated package without development-server paths or a Core rebuild. Declare supported React/UI versions and reject incompatible combinations before mounting.

A manifest's requested access describes intent; it does not constrain arbitrary code running with the host's privileges. Verify package integrity and the chosen trusted publisher/source before execution. The precise authenticity mechanism must be specified before the installer ships; a matching hash alone does not prove publisher identity. A public marketplace and enforced isolation for arbitrary third-party code remain separate future work.

Define failure recovery separately from process isolation. For a reported/rejected activation error that leaves the host process running, remove partial registrations, release acquired resources, and show useful diagnostics so Core remains usable. In-process execution cannot guarantee survival of a module that blocks the event loop, terminates the process, or causes a fatal native crash; a timeout alone cannot enforce that boundary. Such failures may require restarting Core without the failing module. Specify a recovery/disable path before normal activation, and document stronger containment through separate processes as future work rather than an existing guarantee. Restart-based recovery must not automatically repeat an interrupted destructive operation.

The minimum lifecycle is inspect, check compatibility, stage and verify, prepare dependencies and any data migration, activate, update/repair, disable, and uninstall. Preserve the previous usable code and appropriate data recovery material until a replacement is validated. Reverting code alone is insufficient after an incompatible data migration.

Disabling or removing a module must stop new work and settle or safely cancel active jobs before unloading its code. Preserve projects, media, settings, notes/references, and saved layouts by default. Show generic resource descriptions and recoverable layout placeholders while the module is absent. Removing user data is a separate explicit action. Shared runtimes remain available to other consumers, and system-owned tools must not be removed.

## Proposed implementation sequence

Each stage should be independently reviewable and keep the app usable. Service contracts must describe responsibilities, not expose a bag of all globals from `server.ts`.

### 1. Define the public SDK and prove a small installable boundary

Define and document the minimum host SDK/UI and module contribution interfaces needed for one existing read-only audiobook panel and one read-only backend operation. Include the necessary stable IDs, package/contract compatibility, panel registration, loading, and lifecycle behavior. Mark the remaining SDK surface as planned until subsequent slices exercise it. Do not introduce another resource type for this example.

Define the minimum generic resource summary/query interface needed by Audiobooks without implementing every future resource type. Keep module-specific fields and filter definitions explicitly typed and owned by the module. Coordinate this with the shared-resource design before changing the durable database format.

Add dependency/import checks so core services cannot import audiobook implementations or types and modules cannot import private host internals. During incremental extraction, keep any temporary compiled-in Audiobook registration in an explicit composition adapter, with removal required before Core-only acceptance. The final host discovers installed contributions through the loader. Audit active registrations as well as imports.

Define the initial package manifest, UI/runtime sharing, browser/backend loading, and trusted-source verification contracts now. Alongside the first client/backend slice, prove a prebuilt contribution can be installed, activated after a restart if needed, and removed in a disposable assembled host without rebuilding Core. This early proof validates the packaging boundary; it is not the complete Audiobook extraction or the finished installer.

Done when: a small documented SDK and example exercise the real loading path, ownership and compatibility rules are enforced where practical, and the remaining extraction has a demonstrated package boundary to target.

The first proof must pass explicit UI packaging checks: shared React and UI contexts, working module styles/assets, correct rendering under supported themes, and successful loading/updating from an isolated assembled installation without rebuilding Core.

### 2. Give the Audiobook client ownership of its workspace

Move audiobook session coordination out of App into a module-owned controller/workspace. It owns active project state, remembered steps, unsaved chapter/metadata drafts, navigation guards, ratings, workflow actions, and cancellation of obsolete requests.

Put audiobook HTTP operations behind a client service. Keep React state transitions and user confirmations in the controller/UI; keep request/response handling in the service. A service should not need to import App or operate its dialogs directly.

App becomes the shell/composition point for appearance, common navigation, Preferences, logs, and mounted module content. The module contributes book identity/header content and contextual actions rather than making the shell require a current book. Keep existing DOM IDs, panel IDs, layout keys, API routes, and behavior during this stage.

Move audiobook panel and default-workspace registration behind the module's activation entry point. Preserve user arrangements and legacy IDs. Deactivation must remove active contributions while retaining saved instance configuration for recoverable placeholders.

Done when: the working audiobook experience runs through its module entry point, while App no longer implements audiobook business operations.

### 3. Extract backend operations in complete slices

Introduce an audiobook backend entry point and an explicitly constructed service context. Extract route families together with their supporting state, validation, progress, and recovery behavior. Reuse existing services rather than copy them.

Suggested slices:

1. Project access, metadata/draft saves, and chapter review commands.
2. Import, source membership/order, library discovery, and book-specific transfers.
3. Preparation, transcription, chapter detection/extraction, and reruns.
4. Export, validation, finalization, archive/cleanup, and recovery.

Keep shared busy/mutation protections active around old and extracted routes. Preserve the existing narrow read-only catalog allowances. Register recovery handlers explicitly and run required recovery before admitting conflicting work.

Retain old API paths as compatibility adapters where needed. Do not route an operation through both implementations, create duplicate polling loops, or add a second project store. Move one slice, switch its caller, and remove the old ownership after verification.

Done when: server.ts constructs shared services and mounts the module, without containing audiobook processing or project business rules.

### 4. Remove remaining domain assumptions from shared services

Replace audiobook-shaped catalog entry points with generic contracts and an Audiobook adapter. Separate generic resource browsing from the existing audiobook LibraryManager view. Modules supply fields, filters, columns, artwork, previews, and actions; physical File Browser operations retain their own explicit scope.

Separate playback transport/session state from book timeline and bookmark interpretation. Expose generic operations/log events without asking core code to append errors to an audiobook project directly.

Keep shared taxonomy and autocomplete services domain-neutral. Their full schema/performance implementation is related work described in SHARED-RESOURCE-CORE.md; extracting Audiobooks must not silently commit us to an unreviewed universal schema.

Done when: core contracts do not require `AudiobookJob`, `LibraryBook`, or mandatory book-specific fields. No additional-file-type implementation/testing is included at this stage, per the maintainer's direction.

### 5. Separate settings, dependencies, and data ownership

Core owns Preferences and runtime management. Audiobooks registers its settings and feature requirements. Python, speech engines, and FFmpeg must not be required merely to start a host with Audiobooks disabled. Existing features still enforce their own actual requirements.

Move unconditional audiobook Preferences and dependency registrations into the module. Generic sections such as storage and Requirements must derive feature-specific entries from registered consumers rather than assume transcription or book processing exists. Retaining disabled-module configuration must not register its executable settings panels or prompt for its tools.

Preserve saved configuration values through an adapter before considering a new configuration layout. Do not reset project overrides or make Quick Settings maintain a second copy of values.

Keep existing durable stores and identity mappings intact during behavior-preserving extraction. Any subsequent data movement needs a separate reviewed migration: version guards, recovery material, transactional changes where applicable, and explicit downgrade/recovery behavior. The module owns its data interpretation; core provides storage facilities rather than assuming every record is a book.

Done when: settings and dependencies have clear owners and disabled/uninstalled code does not delete user data. Existing external-tool acquisition and third-party packaging policy remain in force.

### 6. Prove complete Core independence

Verify both a normal Audiobook-enabled installation and an assembled Core installation with no Audiobook client/backend code present. A hidden navigation button or a runtime flag after unconditional imports is not sufficient evidence. Build Core without the Audiobook package available and check imports and packaged outputs for lingering dependencies.

Exercise the standard tools delivered in the release without a current book or an Audiobook service: physical file browsing/management, the shared resource browser, Preferences, basic playback, and the desktop/launcher to its explicitly delivered scope. Use bounded existing/synthetic fixtures without expanding the deferred additional-file-type implementation/testing scope. Record any deferred desktop surface separately.

Assert that absent Audiobooks contributes no active panels, actions, routes, Preferences sections, processing defaults, or dependency prompts. Generic file or playback capabilities may still declare their own genuine requirements. Core should continue to work when the optional module is absent, incompatible, or reports a recoverable activation error, with useful diagnostic status. Fatal or blocking in-process failures follow the restart/disable recovery limits defined above.

An absent module leaves its saved records, layouts, and registrations recoverable through generic descriptors/placeholders. The host must not reinterpret preserved audiobook state as unknown disposable cache or automatically rewrite it. Its removed operations must be unavailable with clear errors.

Run this validation against preserved existing-format audiobook data as well as an empty installation. Core must open its own stores and browse retained generic resource descriptions without constructing an AudiobookJob or loading audiobook project interpretation code. Rebuilding catalog/search indexes while Audiobooks is absent must preserve authoritative records, identities, term assignments, relationships, and enough durable generic descriptors to recover their basic presentation. Do not make the only retained resource description depend on a disposable module-specific index. Module-specific interpretation, editing, or derived fields may remain unavailable until reinstallation; distinguish that from loss of user data. Verify the full module interpretation returns after reinstallation without reimporting or retranscribing.

Update the SDK/API documentation and module example to match the extracted implementation. Inventory remaining imports and remove temporary composition adapters; resolve all imports of host implementation internals before moving code to another repository. Keep required legacy API adapters with the module so compatibility does not leave audiobook business behavior inside Core. Review packaging inputs, notices, source inclusion, worker paths, and tests for the split.

Done when: Core builds and its delivered tools work without Audiobook code, the complete module uses only public host contracts, and removing it leaves recoverable data and layouts with no active audiobook contributions.

### 7. Deliver the separate repository and installation lifecycle

Move the complete Audiobook package to its own repository and build it against released compatible SDK/UI packages. Publish a prebuilt module artifact with its manifest, browser/backend code, required assets/workers, and applicable source/notices. Verify it from an isolated assembled installation without development-checkout paths or a host rebuild.

Deliver module management within SwissMouse using the initial trusted official catalog and artifact source. Implement and verify:

1. Inspect publisher/source, version, features, compatibility, requirements, and download/storage needs before installation.
2. Reject incompatible host/API versions and malformed manifests before execution. Stage downloads, verify integrity and the selected authenticity mechanism, and reject unsafe archive paths.
3. Resolve feature dependencies through the host, reusing compatible installations and honoring existing ownership/acquisition policy. Prepare recoverable data migrations where needed.
4. Activate browser/backend contributions after checks succeed. Make any restart requirement explicit. Recoverable activation errors must undo partial contributions and leave Core usable, with the previous working module recoverable where compatible with retained data. Exercise the documented restart/disable path for fatal or blocking in-process failures; do not claim process isolation.
5. Support update and repair, including interrupted downloads, failed activation, and migration refusal. Recovery must account for both code and data versions; do not promise unsupported downgrades.
6. Support disable and uninstall with active-work handling, removal of executable contributions, preservation of user data, and retention of shared dependencies needed elsewhere.
7. Reinstall the module and restore existing projects and saved layouts through their stable IDs, without reimporting media or rerunning transcription.

Done when: users can install, update, disable, remove, and reinstall the independently released Audiobook module through SwissMouse, Core remains useful across those supported lifecycle transitions and any required restarts, and the end-to-end acceptance scenario below passes. Document in-process failure limits and verify recovery rather than promise uninterrupted operation through every module failure. A public third-party marketplace, seamless hot replacement, and a general plugin sandbox are not required to complete this first official-module delivery.

## Validation and acceptance

Run the relevant existing suites for each slice, plus TypeScript checking, production build, and whitespace/import-boundary checks. Extend tests where behavior crosses a new service boundary; avoid tests that merely assert files moved.

Required regression scenarios:

- Startup/reopen and migration refusal retain project/resource identities.
- Navigation preserves unsaved work, ordered saves, cancellation, and same-book playback state.
- Failed metadata saves, processing reruns, and exports retain recoverable prior work; stale results remain correctly marked.
- Imports, relinks, transfers, and file mutation retain ownership checks, collision protections, and recovery behavior.
- Runtime installation/removal respects app/system ownership and active-work locks.
- Core-only builds and packaged installations contain no Audiobook executable dependency; delivered standard tools work without an active book or module service.
- Core-only startup with preserved existing-format data opens host stores and displays generic retained resources without loading audiobook project types or interpretation code.
- A catalog/index rebuild with Audiobooks absent preserves durable records, identities, taxonomy assignments, relationships, and recoverable generic descriptions; reinstallation restores full module interpretation.
- Active audiobook panels, actions, routes, Preferences sections, and dependency prompts are absent when the module is absent; saved resources and layouts remain recoverable.
- Missing modules, unknown/mismatched contracts, and recoverable activation errors leave Core usable with clear diagnostics and no leaked partial contributions. Fatal/blocking in-process failures have a tested restart/disable recovery path without blindly replaying destructive work.
- Packaging resolves browser/backend entry points, shared UI runtime, workers, assets, and dependencies in an isolated assembled installation without rebuilding Core.
- Installed module panels share the supported React runtime and intended UI contexts, load their own required styles/assets, and render correctly under supported themes. Verify a package update without a development server or Core rebuild.
- Installation rejects malformed, incompatible, unsafe, or unverifiable packages before execution.
- Interrupted installation/update, migration refusal, disable/uninstall during active work, and code/data recovery preserve prior usable work.
- Reinstallation restores existing project/resource identities, settings, and customized layouts without reimporting or retranscribing.

Use disposable fixtures and synthetic records for mutation/installer checks. Real-model accuracy, real-device failures, and performance remain separately evidenced tests; a successful refactor test suite does not establish them.

Capture before/after startup, catalog/page latency, memory, and playback responsiveness under existing audiobook workloads. Avoid adding full-library hydration, serialized whole-store writes, or extra media probing while introducing generic interfaces.

The final end-to-end acceptance scenario is:

> Install SwissMouse without any Audiobook code. Use its delivered standard tools. Install Audiobooks through the app without rebuilding Core. Open existing audiobook projects with saved chapters, transcripts, ratings, listening positions, and layouts intact. Remove the module and continue using SwissMouse. Reinstall it and recover those projects and layouts without reimporting media or rerunning transcription.

Run this scenario on a disposable copy of existing-format data and media fixtures. Record the Core, SDK/API, module, and data-schema versions tested, along with any explicitly deferred standard-tool surface.

## Recommended first implementation batch

The first implementation batch should deliver only the minimum SDK and loading path needed for one existing read-only audiobook panel and one read-only backend operation, such as displaying saved book information. Package that slice and demonstrate installation, activation after restart if needed, display, removal, and reinstallation in a disposable assembled host without rebuilding Core. Include the UI runtime, theme, style, and asset checks above. Keep the package in this repository while the contracts settle. This tests a real end-to-end boundary without requiring another module, the entire SDK, or a complete marketplace.

After reviewing that proof, add editing and saved-state behavior through the project/metadata/chapter command slice, then expand the client controller and long-running processing services. Preserved-data Core-only startup and rebuild checks remain required acceptance gates for the full extraction; they do not require completing a universal storage migration in the first read-only proof.

Use the resulting review and compatibility evidence to refine the contracts before expanding through the remaining slices. Complete Core-only validation, the separate Audiobook repository, and the installation lifecycle before calling the Alpha 6 extraction goal finished. Keep [extension contracts](EXTENSION-CONTRACTS.md) and the [architecture guide](../ARCHITECTURE.md) aligned as the design becomes implemented behavior.

This plan deliberately does not assign time estimates before the first slice exposes the remaining coupling. The overall Alpha 6 goal remains a completely detached, independently installable Audiobook module.
