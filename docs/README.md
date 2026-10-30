# SwissMouse documentation

Alpha 5 (`0.1.0-alpha.5`) has launched. **Alpha 6 is the active development cycle.** This status was updated on October 28, 2026, following the maintainer's launch confirmation; that date is not a recorded release timestamp.

Current guides describe the existing implementation and carry forward into Alpha 6 unless they explicitly describe a proposal or limitation. Alpha 5 release notes, installation instructions, and dated verification records retain their original release scope. Launch status does not expand the testing evidence recorded in those documents.

## Current development guides

- [Batch 1 module proof](BATCH1-MODULE-PROOF.md): the implemented read-only package boundary, local trust setup, lifecycle, and limits.
- [Batch 2 client ownership](BATCH2-CHECKPOINT.md): module-owned workspace/controller, save coordination, HTTP services, activation, validation, and remaining extraction.
- [Batch 3 backend commands](BATCH3-BACKEND-COMMANDS.md): project, metadata and chapter commands, compatibility routes, failure/restart checks, and remaining backend slices.
- [Batch 4 file coordination](BATCH4-FILE-COORDINATION.md): imports, source membership, discovery, transfers and startup recovery behind the existing HTTP and file-engine adapters.
- [Batch 5 processing](BATCH5-PROCESSING.md): source preparation, transcription, chapter detection/extraction, reruns, shared progress/cancellation and cache compatibility.
- [Batch 6 completion](BATCH6-COMPLETION.md): export/metadata writing, Final Check, finishing, cleanup and archive recovery with existing engines and compatibility routes.
- [Batch 7 shared contract review](BATCH7-SHARED-CONTRACTS.md): source review, recommended information model, migration gates and proposed next implementation slices (design only).
- [Batch 8 registry and read bridge](BATCH8-REGISTRY-READ-BRIDGE.md): implementation of the approved Batch 7 recommendations' first slice, with opt-in inspection, existing IDs/storage and no new write API.
- [Batch 9 durable foundations](BATCH9-DURABLE-FOUNDATIONS.md): opt-in retained descriptions, recovery snapshots, outbox/replay and a generic index rebuild; [migration review](INFORMATION-DURABILITY-MIGRATION.md) before enabling on real data.
- [Batch 10 directory and picker](BATCH10-DIRECTORY-AND-PICKER.md): shared indexed suggestions, actual saved selection history and the opt-in Series picker; [performance measurements](BATCH10-PERFORMANCE.md).
- [Audiobook separation plan](AUDIOBOOK-SEPARATION-PLAN.md): agreed extraction sequence, ownership, compatibility, and acceptance gates.
- [Shared resource core direction](SHARED-RESOURCE-CORE.md): managed-information browsing, extensible taxonomy, and performance requirements (design, not implemented functionality).
- [Proposed shared information contracts](SHARED-RESOURCE-CONTRACTS.md): resources, fields, memberships, taxonomy, autocomplete/history, view contributions, durable ownership and performance acceptance criteria.
- [Preferences](PREFERENCES.md): current categories, settings contributions, and dependency descriptions/links.
- [How SwissMouse works](../ARCHITECTURE.md): the plain-language architecture guide, including current behavior and proposed Alpha 6 systems.
- [Alpha 6 goals and scope](ALPHA6.md): module extraction, Preferences and Quick Settings, Notes core, and full File Manager and Audio Player screens.
- [Product direction](../ROADMAP.md) and [long-term scope](SWISSMOUSE-VISION.md).
- [Application overview and processing](../README.md#how-it-works), [transcription](../TRANSCRIPTION.md), and [chapter detection](../CHAPTER-DETECTION.md).
- [Shared identities, catalog, API, and storage](RESOURCE-CATALOG.md).
- [Module and extension boundaries](EXTENSION-CONTRACTS.md).
- [Panels](PANELS.md), [parent panels](PARENT-PANELS.md), [child panels](CHILD-PANELS.md), [containers](CONTAINER-SYSTEM.md), and [interface conventions](INTERFACE-STANDARDS.md).
- [Book Files](BOOK-FILES.md), [Inbox and Library](INBOX-LIBRARY.md), and [extended metadata](extended-metadata.md).
- [Release process and Alpha 6 preparation](RELEASING.md).

The architecture guide connects these subsystem documents. Future plans and provisional contracts are not evidence of shipped functionality.

## Released Alpha 5 and historical evidence

- [Alpha 5 release notes](releases/alpha5.md).
- [Alpha 5 installation, backup, and recovery](ALPHA5-INSTALL-AND-RECOVERY.md).
- [Alpha 5 release preparation record](ALPHA5-RELEASE-PREPARATION.md).
- [Alpha 5 foundation verification](ALPHA5-FOUNDATION-VERIFICATION.md) and [identity verification](IDENTITY-VERIFICATION.md).
- [Adaptive workspace implementation record](alpha-5-adaptive-workspace.md).

## Development branches

Use short-lived `codex/` branches for focused changes and merge reviewed, validated changes into `main`. `main` is the integration branch for Alpha 6 development. Preserve published release tags; do not move the Alpha 5 tag to newer work. A permanent Alpha 6 branch is unnecessary unless parallel maintenance of multiple release lines becomes necessary.

The development cycle and package version are separate: package metadata still identifies Alpha 5 until a deliberate version update. Before publishing Alpha 6, align package/lockfile versions, displayed version, workflow, and release notes as described in the release guide.
