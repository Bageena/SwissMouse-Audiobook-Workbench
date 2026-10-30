# Batch 1: installable read-only Audiobook slice

Implemented October 28, 2026. This is the first loading/package boundary, not complete Audiobook extraction. The existing built-in workflow remains active and is not replaced by this package.

## What now works

- `packages/sdk` defines prototype API 1: host-provided React, a shared Panel component, declared asset URLs, panel context, a read-record port, and read-only operation contributions.
- `packages/audiobooks` contains the existing BookInformation display, packaged panel activation, and a read-only saved-book summary operation. A temporary facade keeps existing header/book displays using the same source. The package does not import private Core source or bundle React.
- The package builder creates a `.smmodule` ZIP independently of the Core build, with manifest, payload hashes, browser/backend entries, CSS, an SVG asset, preferred source, and the project license.
- Preferences → Modules can install an approved artifact, display status, enable/disable/remove its registration, and open its read-only panel for the currently open resource.
- The host verifies packages and activates their backend when SwissMouse starts. Installation, updates, and module removal require a restart to finish. Pending changes stop new reads/assets for the old state immediately.

The saved-book adapter in `tools/audiobook-module-adapter.ts` is temporary composition code. The module interprets the snapshot; the general loader does not depend on AudiobookJob. A host with no Audiobook code is a later acceptance gate, not a Batch 1 claim.

## Trust and installation limits

This is an administrator-provisioned, local first-party development workflow. It is not a public marketplace or a loader for arbitrary uploads.

`APP_ROOT/module-trust.json` is local administrative trust data. Each approved entry pins package SHA-256, module ID, publisher ID, and version. Matching the hash proves that the selected bytes match a prior local approval; it does not independently authenticate the publisher. Trust comes from the operator obtaining/building and approving that artifact through a trusted channel. No package or downloaded catalog can approve itself. Remote catalog authentication and production publisher signing remain future work.

Unapproved bytes are rejected before decompression. Approved archives undergo path, duplicate, symlink/type, size, file-inventory, checksum, ownership, and API/React compatibility checks. Startup verifies the retained original archive, binds the installed manifest to that approved archive, and checks installed payloads before activation. Backend code and source files are not exposed by the browser asset routes. Mutations check active work and request origin, while normal local administration retains its existing trust boundary.

Packages are staged under `APP_ROOT/.installed-modules/` and committed to immutable hash-addressed directories. The versioned installed registry is replaced atomically after staging. Prior package copies and user data are retained for recovery. Remove module removes its installed registration; recovery package copies are intentionally retained. Automatic storage reclamation, automatic rollback across data migrations, and full module data migrations are not implemented in this read-only batch. Do not delete user project databases as module cleanup.

The local trust file and installed code are excluded from public release inputs. Module artifacts contain first-party module source/code and required notices, not processing runtimes, models, or a private React copy. No dependency installation occurs during this module proof.

## Reproduce in a disposable installation

1. Build Core once with `npm.cmd run build` and prepare an isolated working copy with its normal runtime dependencies. Use copied/synthetic data, not the only copy of a real library.
2. Run `npm.cmd run module:build` from the source checkout. This builds only the module. Output is under `.cache/module-packages/`, including a development `module-catalog.json`.
3. Explicitly provision that generated catalog as `module-trust.json` in the disposable application's root. Do not overwrite a real installation's existing trust data blindly. The builder never provisions trust or installs code automatically.
4. Start that host. Open a saved book, then the header gear → Preferences → Modules. Choose the `.smmodule` file and select Install approved package.
5. Restart the host, reopen the book, and use Open Book information. The module's panel displays saved title/contributors/year through its packaged read operation. Its stylesheet and icon load from versioned installed URLs.
6. Disable/remove, restart, then reinstall the same approved package and restart. Saved work and IDs remain available. To test an update, build a new prototype version with `npm.cmd run module:build -- 0.0.2`, explicitly approve the new catalog entry, and install that artifact. Core is not rebuilt.

The existing audiobook project ID is the read operation's context in this proof. General resource-ID-to-domain resolution is part of later core separation. Only the small saved metadata snapshot is exposed to the example, not transcripts, audio, or mutable project objects.

## Failure recovery

Reported activation errors appear in Modules and do not publish partial operations. Browser load/render errors are contained by the panel boundary; styles and registrations are cleaned up when it closes or loading fails.

Trusted backend code runs in-process. Blocking code or fatal errors can still stop the host. Start with `SWISSMOUSE_MODULE_SAFE_MODE=1` to skip all module execution, disable/remove the failing module in Preferences, then clear that environment override and restart normally. This is a recovery path, not process isolation. No destructive audiobook operation is replayed by this read-only module loader.

Malformed installed registries are preserved and reported, not silently replaced. This prototype has no registry-repair UI; restore a known-good registry or inspect a copy rather than delete user data. Automatic interrupted-staging cleanup is deferred; staging is not considered installed until registry commit.

## Validation and limits

- TypeScript check and production build passed. The existing large-browser-bundle warning remains. The final focused regression run passed all 33 tests, with no failures or skips, covering module loading, assembled-host installation, preferences, header/workflow navigation, shared appearance, and runtime/recovery behavior.
- Module-host tests cover install/restart/read, disable/remove/reinstall, updates, corruption, safe mode, reported activation failures, incompatible/unapproved/tampered packages, unsafe paths, and source/backend asset access restrictions.
- The assembled-host HTTP test copies compiled output and its runtime dependencies into a private fixture, with no source tree. It installs the artifact over HTTP, restarts, reads saved metadata and assets, removes/reinstalls, and checks the compiled Core hash and original legacy input remain unchanged.
- The live synthetic browser preview loaded the packaged panel with its own CSS/SVG through the shared shell. It was exercised across Light, Parchment, Blue, Slate, Forest, Dark, and Cheese; Forest, Dark, and Cheese screenshots were visually inspected.

This does not establish full Core-only independence, complete plugin isolation, real-model behavior, upgrade compatibility for every historical project, or generalized taxonomy performance. No additional resource type or processing engine was implemented for the proof.
