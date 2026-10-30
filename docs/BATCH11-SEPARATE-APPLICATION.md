# Batch 11 — independent Core and full Audiobook application

Alpha 6 development checkpoint, October 29, 2026. This is the final planned **Audiobook separation** batch, not the final Alpha 6 feature batch or a release announcement.

The repository names selected by the project owner are:

- `Bageena/SwissMouse`: the new public Core repository.
- `Bageena/SwissMouse-Audiobook-Workbench`: the existing public repository, becoming the Audiobook module repository. Preserve its history.

## What now exists locally

`core-server.ts` and `src/core-main.tsx` form a separate Core application. Its executable source graph contains no Audiobook package, project types, processing engines or workspace imports. Core can read retained generic resource publications, rebuild its derived index, browse granted workspace files, perform exclusive verified copies, play native browser audio, change shared appearance, display technical logs and manage trusted modules.

The full Audiobook application builds into a `.smmodule` archive independently of Core. This includes its workspace, project editing, existing backend operations, catalog worker, artwork, style sheets, license/notices and preferred source. The smaller API 1 read-only proof remains supported separately.

The application contract is **protocol 2, SDK 0.0.2, React 18**. Core supplies the browser React instance. A trusted module backend runs in a separate Node process using the installation's existing Node runtime and standard JavaScript libraries. Data may live outside the installation. This process boundary contains ordinary backend startup/crash failures; it is not an operating-system sandbox or permission system for untrusted plugins.

Core keeps its own routes. A module declares the compatibility route namespaces it provides. The backend only accepts the host's private per-launch token; it listens on loopback. Startup, active-work refusal, shutdown, and stale runtime status are explicit. Module changes are serialized.

## Settings and requirements ownership

Neutral preference/requirement registries and generic information storage now live in the public SDK source. Audiobook sections, speech/audio requirements and feature-to-tool mappings belong to the module. Deactivation removes those active contributions without deleting saved configuration or user data.

Full application Preferences are embedded inside Core instead of opening a second fullscreen dialog. Unsaved module preferences block module changes; staged book metadata, ratings and chapter edits use the existing leave-book coordination before deactivation. Shared appearance retains the existing `ui-preferences.json` authority.

Packages expose descriptions, official/source links and license information before installation. An administrator-provisioned trust catalog must approve the exact archive digest. Package installation does not silently trust its own publisher or install external programs. Python, FFmpeg, transcription libraries and models remain separate explicit requirements. Normal npm libraries needed to run SwissMouse retain their own licenses and notices.

## Preserving work

Removing the module removes registration/execution, not project data, settings, listening records, browser layouts or retained resource descriptions. Core never interprets opaque Audiobook project stores while the module is absent. Existing unversioned identity data is not automatically migrated by Core. Shared durable publications and the directory remain opt-in; this batch has not migrated the owner's real library.

Install, enable and update activate after restart. Disable/remove drain the running module and refuse active work or unflushed publications/history. Packages are immutable, verified by exact digest, and old code remains available for recovery. Safe mode skips module execution so Core can disable a failed module.

## Commands and delivery checks

- `npm run build:core`: build Core independently.
- `npm run module:build:full`: build the full Audiobook package and development trust catalog.
- `npm run test:separation`: Core-only, contributions, installed full application, and legacy API 1 lifecycle regressions.
- `node --import tsx --test tools/application-runtime.test.ts`: malformed contract, active-work lock, forwarding and failed-start recovery fixtures.
- `node scripts/stage-separated-repositories.mjs`: create fresh source-only candidates and SHA-256 file inventories. It never moves the current checkout or rewrites its remote.
- `node scripts/verify-separated-installation.mjs <Core folder> <module archive>`: use independently built outputs with data outside the installation and reject JavaScript dependencies resolved outside the staged Core dependency tree.

The separate Core candidate has no `packages/audiobooks` directory. The module candidate owns its root `src/` and `tools/` application trees; references into those trees are local module source, not imports into a private Core checkout. Both include the matching public SDK source until a separate SDK distribution process is established.

## Evidence and remaining gates

The initial separation regression run passed 17 tests; the final focused regression run passed **37 tests**. The standalone Core candidate also passed its three protocol tests. Both final source candidates passed independent cached npm installation, lint and build. Source-only inventories and Gitleaks found no secrets or local libraries/program installations in the publication inputs.

The assembled independent-installation acceptance passed with data in the system temporary directory, outside either repository. A runtime resolution guard rejected Node dependencies outside the staged Core dependency tree. Installing the separately built module, editing an existing project, disabling/removing it, physically removing its cached code, rebuilding retained resources and reinstalling preserved the project identity, chapters, transcript, draft and rating. Shared appearance worked with the module absent. The first fixture attempt used an invalid numeric chapter timestamp; it was corrected to the existing timestamp-string format before this passing run.

Browser inspection verified full workspace loading, embedded module preference saving, disabling the module, and removal of its settings/dependency prompts while Core remained available. These are disposable-fixture checks, not evidence of real-model accuracy or large-library performance. The production CJS build reports esbuild's guarded `import.meta` warning in runtime resolution; the CJS branch uses its own filename and the isolated acceptance verified dependency resolution successfully.

Repository/branch delivery remains the final publication step. Local candidate preparation alone is not remote repository delivery. The existing combined development checkout still launches the legacy app by default; the Core repository candidate uses its own normal build/start commands.

Remaining Alpha 6 work includes the broader Preferences/extension contribution experience, Notes, full resource browsing and taxonomy adoption, and richer file/audio tools including bulk actions and EQ. Batch 10's wider mixed-library and concurrent-workload performance acceptance also remains open.
