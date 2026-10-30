# Batch 2: Audiobook client ownership

Implemented October 28, 2026 on `codex/audiobook-batch1`. This replaces the earlier paused checkpoint, which had only moved rating and metadata-draft transport. No commit or push has been made.

## What changed

- `src/App.tsx` now composes the Audiobook client entry and supplies common services. Appearance, Preferences, technical logs, shared cleanup and native picker access remain shell responsibilities.
- `src/modules/audiobooks/index.ts` is the temporary built-in client entry. Its workspace hook owns active projects, remembered views/steps, drafts, navigation, ratings, processing/export coordination, imports, library actions and playback selection. Its view composes the existing screens and contributes book header content/contextual actions.
- `packages/audiobooks/src/edit-controller.ts` owns ordered draft/rating writes and navigation preparation without React, dialogs, private host imports or another durable store. It waits for edits typed during slow saves, retains failed drafts, suppresses obsolete rating results, and cancels superseded navigation reads. An older metadata save cannot clear a newer draft.
- `client-service.ts` owns project reads and editing commands. `legacy-workspace-client.ts` adapts the remaining existing audiobook HTTP protocol, including processing, imports, file operations, export, validation and library commands. Confirmations stay in controller/UI code. Server conflicts, explicit approvals, optimistic revisions and catalog headers are preserved. Legacy response shapes remain internal rather than new public SDK contracts.
- `session-view.ts` retains the existing remembered-step rules and storage keys. `workspace-contributions.ts` owns audiobook panel/workspace descriptions; the old manifest path remains a compatibility re-export.
- Startup explicitly activates built-in audiobook contributions. Repeated activations share a registration until the last lease ends. Cleanup removes active panel/workspace descriptions without deleting saved layout state; reactivation restores the same IDs. Standard header/file-browser panels remain in the shared catalog.
- Startup/navigation/playback-selection reads can be cancelled when obsolete. Scan polling does not overlap and stops updating after cleanup; export polling also cleans up on unmount. Backend operations retain their existing execution behavior.

## Boundaries that remain temporary

The workspace hook/view and `src/modules/builtins.ts` are explicitly compiled-in composition adapters. They still import the existing screen implementations, domain types and shared utilities. The independent package's coordination, transport, and contribution files build without those private host dependencies; the entire client does not yet meet that standard.

The independently installed Batch 1 package is still a read-only example. Its disable/remove controls do not disable the built-in audiobook application. Editing currently uses the existing guarded audiobook API routes; no unrestricted write capability was added to `readRecord` or the prototype SDK.

There is no database migration, second project store, second polling implementation, new resource type, separate repository, public publisher-signing scheme or Core-only installation claim in this batch. Audiobook settings/dependency ownership, legacy global processing progress, backend services, full screen packaging and generic missing-module presentation remain later work. Unregistering contribution metadata is not proof that a fully uninstalled Audiobook application can run safely in today's host.

## Validation

- TypeScript checking and production build pass; the existing browser-bundle size warning remains.
- The final focused regression run passed all 57 tests, with no failures or skips. It covers client transport, edit coordination, activation, independent import boundaries, Preferences, headers/navigation, metadata/rating behavior and the assembled module-installation proof.
- Workspace suite: 62 passed.
- Broad audio/regression suite, serial: 402 passed, 3 optional skips, 0 failures. The skips require unavailable real-model/runtime fixtures. An initial parallel run had three failures; the affected tests passed serially, and the complete serial run passed. Two initial failures were fixture startup deadlines.
- Disposable browser preview: metadata draft persisted across screen navigation and reload; explicit save retained stable book/chapter IDs and a 4.5-star personal rating. The final rebuilt client opened a second synthetic book through the Library, saved a separate title, reopened it, then switched back to the first book with its title/rating intact. These are UI/persistence checks, not real-audio/model verification. Verification image: `.cache/batch2-client-preview.png`.
- The existing assembled-host install/restart/disable/remove/reinstall test remains part of focused validation. It checks unchanged compiled Core bytes and preserved saved data.

Useful commands: `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run test:audiobook-client`, `npm.cmd run test:workspace`, and the focused module-installation tests. See the plan's acceptance gates before claiming complete extraction.

## Next implementation batch

The backend project/metadata/chapter command slice is now implemented in [Batch 3](BATCH3-BACKEND-COMMANDS.md). Continue with its checkpoint and the remaining backend slices in `AUDIOBOOK-SEPARATION-PLAN.md`: import/source coordination, processing, then export/finalization. Keep advancing the public package boundary with actual working slices rather than freezing a speculative universal API.

Preserve all existing uncommitted Preferences, Batch 1 and documentation work when resuming. No real library was modified for this validation.
