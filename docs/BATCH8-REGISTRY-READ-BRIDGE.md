# Approved shared-contract recommendations: registry and read bridge

Implemented October 29, 2026 on `codex/audiobook-batch1`, following approval of the Batch 7 recommendations. The [Batch 7 proposal](SHARED-RESOURCE-CONTRACTS.md) calls this first executable slice **Batch 8**. It does not implement every later row of that plan.

## What works now

- A framework-independent registry accepts declarative resource types, fields, relationships, taxonomies, suggestion providers and view definitions as one atomic owner contribution.
- Definitions require stable owner-qualified IDs, versions and explicit visibility. Registration rejects collisions, dangling/private/wrong-kind references, incompatible field operators, inapplicable fields/relationships, invalid taxonomy depth and unbounded provider settings. It also rejects executable functions, accessors, cycles and exotic objects. This validates trusted declarations; it is not a plugin sandbox.
- Registration keeps immutable copies. Deactivation removes active contributions but retains inert definition labels in memory. Reusing a stale cleanup handle cannot remove a later activation. Definition-kind changes and downgrades are rejected; changing a declaration requires a new definition version. These checks do not implement persistent schema migrations or general compatibility negotiation.
- An Audiobook contribution describes the current legacy work/recording facets, metadata fields, flat genre vocabulary, text-suggestion provider declarations and list/grid/shelf view descriptors. Genres are still text observations in the read adapter, not newly minted canonical term IDs. No real term tree, picker engine or new browser UI is introduced.
- The read adapter projects existing bounded catalog summaries. It uses existing work/recording IDs and membership IDs, retains raw contributor text/arrays, sequence strings, zero/fractional ratings, false values and explicit empty arrays. It creates no person/series identities from names and does not load project payloads or probe media for each displayed row.
- Core presentation consumes already-projected inert data. It can show a generic read-only descriptor with no actions when its owner/type is inactive. This demonstrates session-level fallback, not a durable module-absent rebuild.

## Code ownership

| File | Role |
| --- | --- |
| `packages/sdk/information.ts` | Isolated experimental declaration/read types. Not re-exported from the installed contract-1 SDK. |
| `src/core/information-registry.ts` | Validation, immutable activation/deactivation and inert presentation. No React, database or filesystem dependencies. |
| `src/core/information-builtins.ts` | Generic prototype work/recording/file/item declarations and edition relationship. |
| `src/core/information-preview.ts` | Bounded presentation of pre-projected data, without module callbacks. |
| `packages/audiobooks/src/information.ts` | Audiobook definitions and read-only catalog-summary adapter. |
| `tools/information-preview-routes.ts` | Opt-in host composition and preview endpoints over the existing catalog query. |

## Inspecting the prototype

It is **off by default**. To inspect it in a development process, set `SWISSMOUSE_INFORMATION_PREVIEW=1` before starting that process. In PowerShell, for example:

```powershell
$env:SWISSMOUSE_INFORMATION_PREVIEW = '1'
npm.cmd run dev
```

This does not enable it in an already-running server. Remove the environment variable or set it to `0` for subsequent processes to disable it.

| Read endpoint | Response |
| --- | --- |
| `GET /api/information-preview/definitions` | Prototype version, read-only/session-only status and active declarations. |
| `GET /api/information-preview/library?limit=50` | Existing catalog order/count/cursor/revision with generic descriptors, whitelisted metadata fields and existing recording links. |

The library preview accepts only `limit`, `query`, `cursor`, `sort` and `root`. Default page size is 50, maximum 500; query text is limited to 256 characters, cursor text to 8,192 characters, and serialized responses to 2 MiB. It uses the existing catalog's supported sorts and roots and passes through its stale-cursor conflict. It does not execute the proposed generic field/taxonomy query language. The response explicitly reports taxonomy queries, autocomplete queries and writes as unsupported.

Each item's contributor lists are bounded to 128 values and memberships to 100 per provider; existing recording links are bounded to 100. Oversized/incompatible projections are identified in `omitted`, without changing saved data. A page too large to serialize within the preview limit returns 413 and asks for a smaller page. This is a bounded inspection surface, not a performance guarantee for every legacy payload.

The item revision is labelled `revisionScope: 'catalog-snapshot'`. A library summary does not supply its authoritative per-resource edit revision, so the adapter does not invent one from metadata timestamps or project IDs. The preview supplies no write/concurrency token. Existing resource contract 1 and its `version` field remain unchanged.

These are local Admin/development reads under the current application's access model. They are not public Server publication APIs or new installed extension permissions. Turning the flag off leaves the preview routes unregistered; normal SPA fallback behavior may still serve HTML for an unknown GET URL.

## Compatibility and validation

| Check | Result |
| --- | --- |
| TypeScript check and production build | Passed; existing large-browser-chunk warning remains |
| Final registry, adapter, compiled-server preview, catalog, durable store, identity and module-host group | 52 passed, no failures or skips |
| Default-off and enabled preview, schema/legacy-data comparison | Passed in isolated compiled-server fixture |
| Framework/host dependency boundary, tracked/new-file whitespace and checkpoint links | Passed |

The compiled-server fixture starts with the preview disabled, then restarts with it enabled. It compares legacy query IDs/order/cursors to preview output, finds a late-alphabet record, rejects invalid/unbounded queries and confirms there is no POST write route. It verifies contributor punctuation, existing membership IDs, zero/false values and that drafts/transcripts/source-path fields are absent from the preview. The original legacy JSON bytes, database table definitions/user versions and existing resource contract version remain intact.

Registry tests cover all declaration families, invalid activation rollback, public/private references, data-only registration, immutability, term-provider targets, version/cleanup handling and inactive-owner presentation. A browser-platform bundle check proves the registry does not pull in React, Node filesystem code or private module implementation. Existing catalog, durable store, identity and module-registry regressions exercise compatibility.

Run `npm.cmd run test:information` (its pretest builds the app). The final validation group additionally included `tools/module-host.test.tsx`. Logs are kept at `.cache/batch8-unit.log`, `.cache/batch8-regression.log` and `.cache/batch8-build.log`; the combined regression log is the final result. These fixtures do not establish generalized taxonomy/autocomplete performance, actual extra file-type support or full Core independence. No real library or media files were modified. No visible UI changed or browser rendering was tested. The earlier Batch 6 audio suite is historical evidence, not a fresh full audio run for this read-only slice.

## What comes next

**Subsequent checkpoint:** [Batch 9](BATCH9-DURABLE-FOUNDATIONS.md) now implements opt-in durable publications and generic index replay. The following describes what remained at the end of Batch 8; see the [migration review](INFORMATION-DURABILITY-MIGRATION.md) before enabling the newer storage path.

The registry and retained labels are currently **session-only**. Generic resource publications, field values, aliases, taxonomy assignments and selection history do not gain new durable storage in this batch. Existing catalogs remain the source of the preview, and the full Audiobook application is still compiled in. Installed SDK 1 remains read-only.

The next slice is **Batch 9: reviewed durable foundations**—user-database version guards and recovery snapshots, durable generic descriptors/publications, and replay/checkpoint handling, including source epochs and tombstones. Review that migration before applying it to authoritative data. Indexed autocomplete/history, generic browsing and remaining Core/settings/dependency extraction follow their own gates. They are not completed by registering their definitions here.
