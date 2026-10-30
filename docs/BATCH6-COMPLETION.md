# Batch 6: export, Final Check, finishing and cleanup

Implemented October 29, 2026 on `codex/audiobook-batch1`. This implements the fourth planned backend slice in stage 3 of the [Audiobook separation plan](AUDIOBOOK-SEPARATION-PLAN.md). Changes remain uncommitted with the preceding batches and Preferences work.

## What moved

| Component | Responsibility |
| --- | --- |
| `packages/audiobooks/src/completion-backend.ts` | Composes the services; owns Final Check, cancellation, finishing plans/commands and startup archive recovery. |
| `completion-export.ts` | Export planning/encoding coordination, overwrite approval, per-format outcomes, archive orchestration, progress, folder opening and candidate CSV. |
| `completion-metadata.ts` | Explicit embedded metadata writing, sidecar ownership/association and cover-image staging. |
| `completion-cleanup.ts` | Managed-path cleanup, PCM retention, temporary/orphan files, storage totals and explicit purge/reset commands. |
| `completion-ports.ts` | Named engine/store/source interfaces plus shared export, metadata-writer and validation state. |
| `tools/audiobook-completion-route.ts` | Preserves existing HTTP statuses, JSON replies, text errors and CSV download headers. |

Fifteen legacy HTTP registrations now delegate to these commands. Both export aliases call the same module command; `build-audio` no longer searches Express's private route stack. Route positions, feature requirements and global mutation/runtime middleware remain. The server's existing import, processing, file-operation and metadata busy checks all observe the same completion state.

The existing pure audio-format policy and metadata-sidecar serialization/writer moved into the package. Old paths are compatibility exports, not second implementations. The low-level Final Check engine now accepts the two configuration fields it actually uses rather than requiring the complete host configuration type. No configuration values or stored records change as a result.

## Safeguards and recovery

- Source identity checks, chapter validation, source sample-rate ceilings, verified output read-back and last-successful-output behavior remain in use. Overwrites require the same explicit approval of the actual existing paths, and replacement files use the existing staging/backup procedure.
- Export attempts release their live progress lock in `finally`, including preflight/setup/save failures. Existing unfinished queued/running records are marked failed using the same persistence recovery path so users can retry.
- Final Check snapshots input, records progress, checks that input signatures remain current, and holds its shared validation lock until cancelled work settles. Finishing still requires a current successful check and matching destination preview. Transfers use the existing verified engine and recovery evidence.
- Known PCM cleanup protects source/export paths, retains available waveform analysis and keeps transcript, chapter and metadata state. Broader explicit purge/reset actions retain their existing confirmation phrases and documented consequences; they intentionally can remove generated transcripts/working copies.
- Cleanup retains the existing managed-root and nested-Inbox checks. It now also rejects active export preflight, metadata writes, validation and moves, rather than relying only on queued export records and outer HTTP guards. This closes a window before export preflight creates its queued records.
- The initial Final Check signature calculation now sits inside the protected `try/finally`. An inspection/signature failure cannot strand the shared validation flag or run map.
- Interrupted-original-archive recovery runs at the same startup point: after runtime selection and before transfer recovery, discovery and accepting HTTP work. A failed journal is reported and retained for review; other journals still get their recovery attempt. The archive/verified-copy engines themselves are unchanged.

Filesystem changes, sidecars and SQLite remain separate operations with the existing recovery limits. This extraction does not create a cross-filesystem transaction or promise rollback of every file mutation after every possible persistence failure.

## Validation

| Check | Result |
| --- | --- |
| TypeScript check and final production build | Passed; existing large-browser-chunk warning remains |
| Completion failure/cancellation/source-protection and backend boundary checks | 15 passed, no failures or skips |
| Additional relocated-policy/pipeline/backend checks | 19 passed, no failures or skips |
| Compiled-server finalization, cleanup, import, backend-state and project API checks | 7 passed, no failures or skips |
| Client and module loading/installation/removal/reinstall checks | 27 passed, no failures or skips |
| Final full serial audio/regression suite | 402 passed, 3 optional skips, no failures |
| Tracked and new-file whitespace checks | Passed |

The module tests cover busy rejection before cleanup, export preflight locks, nested-Inbox/outside-root protection, protected source/export PCM paths, retained transcript/chapter/rating/waveform identity, initial-signature failure, cancellation while a check settles, stale finish destinations, export-preflight failure, continued archive recovery and CSV escaping/download metadata. The backend graph test covers runtime and type imports against module-local code, the public SDK and Node built-ins.

Compiled-server fixtures exercise actual encoding, verified archives, Final Check/finishing, verified transfers, explicit cleanup, forced export setup/save failures and retry, project persistence/restarts, both export aliases and CSV headers. Sources and saved work use disposable fixtures; no real library is modified. These checks do not establish new model accuracy, hardware support or mixed-library scale. No browser/UI change was made or visually validated.

Run `npm.cmd run test:audiobook-completion` for focused checks (its pretest builds the application). Local evidence is recorded in `.cache/batch6-unit.log`, `.cache/batch6-boundary.log`, `.cache/batch6-api.log`, `.cache/batch6-module-client.log` and `.cache/batch6-build.log`. The final broad suite, including the export alias and CSV HTTP checks, is recorded in `.cache/batch6-audio-final.log`. The optional skips are runtime/model tests; they are not new accuracy or hardware-support evidence.

## What is still unfinished

This does **not** complete standalone Audiobook separation. The package is still a trusted built-in integration using provisional engine ports, with some permissive legacy decoder/payload types. Low-level engines and browse/projection, playback, Book Files and provider adapters still have domain assumptions to review. Generic log/cache cleanup is temporarily routed through the same compatibility service; it is not a declaration that these are permanently Audiobook-owned Core features.

Settings/dependency registration, a domain-neutral Core, independently packaged full client/backend loading, a separate repository and Core-only acceptance remain outstanding. The installed Batch 1 artifact stays read-only; uninstalling it still does not remove the built-in audiobook application. There is no new third-party program/model bundle or automatic dependency installation.

The [Batch 7 review](BATCH7-SHARED-CONTRACTS.md) has since produced the [proposed shared contracts](SHARED-RESOURCE-CONTRACTS.md), including performance/migration requirements. The next proposed implementation is the declaration registry and audiobook read bridge. Then introduce reviewed durable foundations, remove remaining domain assumptions, separate settings/dependencies and prove Core starts and works with the Audiobook code entirely absent before moving the full module into its own repository.
