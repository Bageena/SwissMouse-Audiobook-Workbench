# Batch 9: durable shared information foundations

Implemented October 29, 2026 on `codex/audiobook-batch1`. This follows the approved [shared-information plan](SHARED-RESOURCE-CONTRACTS.md). The [migration and recovery review](INFORMATION-DURABILITY-MIGRATION.md) describes the exact storage change and activation requirements.

## What works now

- Authoritative user-database version checks run before catalog writes. Opt-in migration preserves legacy identities and collections, creates verified WAL-aware recovery snapshots and a manifest, and rolls back failed DDL.
- Core retains data-only definitions and generic resource descriptions, fields, relationships, existing memberships, aliases and explicit retirement markers. Existing resource IDs are reused; names do not become invented person or series identities.
- The legacy adapter captures complete metadata into a persistent catalog outbox. Source epochs, contiguous versions and hashed receipts support restart/replay without duplicate edits or old-history resurrection.
- A generic index replays the exact retained historical payloads. It commits its rows and checkpoint/hash together, refuses mismatched restored histories and rebuilds without loading audiobook adapters or project payloads.
- Pending delivery is visible in catalog status and retried with backoff. A fresh catalog history retains unobserved older records as stale instead of inferring deletions.
- A separately enabled, read-only development endpoint inspects the retained projection. No visible UI or installed SDK capability changed.

## Implementation boundaries

| Code | Responsibility |
| --- | --- |
| `tools/information-schema.ts` | Read-only guards, recovery snapshots/manifest, transactional user schema migration. |
| `tools/information-store.ts` | Generic authoritative definitions/publications, aliases, revisions, receipts and historical change feed. |
| `tools/information-projection.ts` | Rebuildable generic rows, keyset paging and checked replay checkpoint. |
| `tools/information-capture.ts` | Explicit legacy Audiobook adapter boundary, dirty queue, complete capture, outbox and acknowledgement. |
| `tools/catalog-service.ts`, `tools/catalog-worker.ts` | Bounded worker delivery, background retries and status. |
| `packages/sdk/information-publication.ts` | Internal experimental publication shape; not exported by installed SDK 1. |

The generic Store/Projection dependency graph has no Audiobook implementation imports. The **full host still includes Audiobooks**, so this engine-level proof does not establish a module-absent application or separate-repository delivery.

## Verification

The fixture tests cover restart, exact/conflicting replay, gaps, alias conflicts, retirement, old epochs, failed publication/acknowledgement/index commits, bounded historical replay, divergent checkpoints, WAL-aware snapshots, failed migration rollback and future/foreign schema refusal. They retain contributor text, large tag/membership lists, existing IDs and file order. A compiled-server fixture checks default-off behavior, opt-in migration, restart, private draft/transcript exclusion and preservation of saved project data.

Run `npm.cmd run test:information-durable` for the focused group; its pretest builds the app. Check TypeScript with `npm.cmd run lint`.

| Final check | Result |
| --- | --- |
| TypeScript and production build | Passed; existing browser chunk-size warning remains. |
| Focused durability/registry/API/catalog/project-schema/identity/module-host/fixture/import group | **79 passed**, no failures or skips. Includes automatic retry without another edit, divergent acknowledgements and partially missing projection refusal. |
| Broader existing audio group (fixture tests run separately) | 397 passed, 3 skipped, 1 import restart timeout. That import test passed in the final focused rerun; the initial timeout was not reproduced or attributed to a confirmed cause. |
| Tracked diff whitespace, new-file whitespace and checkpoint document links | Passed. |

Logs are `.cache/batch9-lint.log`, `.cache/batch9-build.log`, `.cache/batch9-regression.log` and `.cache/batch9-audio.log`. The Windows restricted-filesystem run also blocked a fixture-directory rename; its unrestricted rerun passed all four fixture tests. These host constraints are separate from the app's recovery assertions. No real-model accuracy validation was performed.

No real library or media was migrated. No browser rendering or large-library performance claim is made. This remains experimental and opt-in; review the migration before using it on authoritative data.

## Next steps

**Subsequent checkpoint:** [Batch 10](BATCH10-DIRECTORY-AND-PICKER.md) now implements the opt-in indexed directory/history and Series picker pilot. Its schema-2 upgrades are documented separately; the following records the sequence at the end of Batch 9.

Batch 10 adds the indexed directory and a metadata-picker pilot, with real selection history and representative performance checks. Canonical taxonomy terms/assignments, broader browsing and the remaining Core/settings/dependency extraction retain their own gates. Batch 11's complete enabled/absent/reinstalled host acceptance and repository delivery remain outstanding; split that work further after its inventory.
