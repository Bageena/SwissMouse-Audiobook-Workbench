# Alpha 5 foundation verification

Windows verification on 2026-10-21. Linux testing and support are deferred until Beta. This records the current acceptance evidence; it is not a promise of full Alpha 4 migration or a general plugin platform.

| Foundation | Implemented and checked | Remaining limits |
| --- | --- | --- |
| Stable resources | IDs retained through renaming, supported moves, same-recording relinks, packaged code replacement, catalog rebuild and stopped-folder restore. Actual C:-to-D: transfer checked. | Physical USB unplug/drive-letter changes and NAS outages unverified. |
| Persistence | Separate schema marker, refusal of future versions, WAL-aware migration snapshot, transactional initialization, changed-record writes and restore of drafts/large assets. Manual recovery instructions shipped. | Full Alpha 4 workbench compatibility is not required. Fresh installation recommended. Snapshot is not a whole-library backup. |
| Containers | Shared controls, grid conversion, magnets, saved layout/reset and registration tests. Packaged browser checked grid/canvas selection, reload persistence and reset. | Browser-local layouts remain separate from data backups. No portable workspace editor/profile format. |
| Interface | Shared loading/error component, startup retry, improved empty-view guidance, inline settings save errors, unsaved-settings confirmation and shared modal keyboard focus handling. | No claim of an exhaustive accessibility audit across every legacy dialog. |
| Module boundary | Typed built-in registry, namespaced manifest and Audiobooks screen registration consumed by App and workflow navigation. | Audiobook orchestration/backend routes remain in the host; no arbitrary module loading. |
| Dependencies | Packaged missing-tool gates, private-versus-system ownership, simulated repair checks and real Windows FFmpeg/yt-dlp download, cancellation and retry checks. | Python bootstrap, GPU/Whisper installations, offline installers and every hardware combination remain unverified. |
| Contracts | Implemented module/resource/container boundaries distinguished from provisional workspace, notebook, action/job and permission rules. | Future features are descriptions only. |

## Commands and results

`npm.cmd run lint` and `npm.cmd run build` passed. Build retains the existing large-bundle warning. The package builder completed with the new guides and source files included.

After building and assembling the release:

```powershell
$env:TEST_PACKAGE_ROOT = (Resolve-Path release/SwissMouse-0.1.0-alpha.5).Path
$env:TEST_CROSS_VOLUME = '1'
npm.cmd run test:foundations
Remove-Item Env:TEST_CROSS_VOLUME
Remove-Item Env:TEST_PACKAGE_ROOT
```

All **42 tests passed**. Cross-volume mode requires the checkout and system temporary folder to be on different filesystem devices; omit that environment variable for a same-volume run. API tests use the actual assembled server with isolated data. Installed checkout Node dependencies satisfy package imports, so this does not substitute for a clean-machine installation check.

Browser checks used an isolated copy of packaged assets, generated audio and a local proxy that failed the initial settings request once. Confirmed the error and Try again recovery, Library/Inbox, Book Files, all five registered audiobook screens, container grid/canvas modes, mode persistence after reload, reset to original layout, Settings initial focus, reverse-Tab wrap, Escape close/return focus and the System Setup dialog. No production library was modified. These checks exercise navigation and controls, not a full-length audiobook transcription/export run.

## Release guidance

The requested foundation work is in place for the current audiobook scope. Fresh-package and real download verification below supplements the simulated checks. A pristine Windows VM without prerequisites, physical removable-media failures and NAS outages remain unverified. No release was published by these checks.

## Fresh-package and real installer checks — 2026-10-22

A fresh package was copied to a Windows temporary folder outside the repository, with spaces in its path. `npm ci --omit=dev --no-audit --no-fund` installed 91 production packages. Every declared runtime dependency resolved inside that package's own `node_modules`; none came from the checkout. The production smoke check passed for the jobs API, catalog worker/query, webpage and shipped notices. This uses the host's Node v24.21.0, not a freshly installed Node runtime or pristine VM.

A private Python 3.11 virtual environment was created inside that disposable installation using the existing host Python. With managed runtime mode enabled, FFmpeg, FFprobe and yt-dlp initially reported missing. The actual application installer downloaded the tools and verified their checksums. Cancellation during the active installation retained the runtime lock until the current step finished; retry completed. A sentinel under `inputs` remained unchanged.

Verified tools: FFmpeg and FFprobe `9.0.2-essentials_build-www.gyan.dev`, yt-dlp `2026.10.21`. The installed FFmpeg generated a one-second WAV, FFprobe reported its audio stream and duration, and FFmpeg decoded it successfully. FFmpeg companion distribution files were retained under `runtime/licenses/ffmpeg`. System tools and the real library were not changed. Tool versions are observations from this run, not newly pinned requirements.

The opt-in `scripts/verify-release-runtime.mjs` can repeat these real downloads against a **disposable** package. Install that package's production Node dependencies first, create its private `runtime/venv` using a supported Python, and create `.swissmouse-release-validation` containing exactly `disposable`. Then run:

```powershell
node scripts/verify-release-runtime.mjs 'C:\path\to\disposable-package' --download-tools
```

Do not mark a real installation as disposable. The check requires an empty project store and missing media tools, starts its own server on a temporary port, installs only into the marked copy, checks cancellation/retry and generates test audio. It writes `verification-runtime.json` inside that copy and stops its server. It does not download Whisper models or test Python bootstrap, GPU runtime setup, third-party media downloads, physical drive removal or a full audiobook transcription/export workflow.

See [installation and recovery](ALPHA5-INSTALL-AND-RECOVERY.md), [extension contracts](EXTENSION-CONTRACTS.md), [interface conventions](INTERFACE-STANDARDS.md), and [identity verification](IDENTITY-VERIFICATION.md).
