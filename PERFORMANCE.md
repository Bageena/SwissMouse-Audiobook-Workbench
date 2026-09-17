# Requirements and model-management regression

## Findings

The application serves React through an Express process; the affected communication is asynchronous HTTP, not synchronous Electron IPC. The blocking work was on the server event loop.

- The header requested `/api/requirements/status` every 10 seconds. Every request synchronously launched Python for package imports, FFmpeg/FFprobe version checks, and NVIDIA/CUDA probes. Each request also scanned model directories for both engines.
- A legacy `runtime/venv/Lib/site-packages/sitecustomize.py` imports PyTorch at Python startup. Even a plain Python version/metadata query incurred that initialization. The new metadata probe uses `-S` and explicit package metadata paths, bypassing startup hooks without changing the user's runtime files.
- Model progress requests ran every 500 ms and repeated hardware detection plus disk scans. Their React effect also restarted after every model-array update.
- Opening Requirements repeated the entire scan. The installer repeated it between package installations. YouTube tool status separately invoked synchronous binary checks.
- Jobs are loaded from disk once at startup; Requirements does not repeatedly parse large job or log files. No network access is needed for the revised status endpoints. Model/runtime initialization remains in transcription or deliberate install verification.

## Changes

Requirements manages runtime packages and binaries only. Its readiness calculation no longer depends on model weights. The existing shared Step 1 model controls were already backend-aware in the working tree; they were retained and clarified with explicit backend labels and a Failed status. Switching engines hides stale cards and shows that engine's Installed/Install/Uninstall/Reinstall/download state.

Hardware and dependency probes now run asynchronously and share in-flight requests. Hardware snapshots expire after 10 minutes and package/binary snapshots after 5 minutes, on demand. **Check again** refreshes system status; successful installations invalidate the affected dependency snapshots. Ordinary Python discovery reads distribution metadata without importing Whisper, CTranslate2, or PyTorch. Deliberate installation verification still tests native imports, records compatibility failures, and loads no speech model. Transcription retains GPU testing and CPU fallback.

Model discovery uses asynchronous filesystem operations. Opening the model area or explicitly refreshing it requests discovery; ordinary model reads share a one-minute snapshot. Download polling reads application state only. A successful Faster Whisper download publishes the completed installation state before clearing its downloading flag, so the UI cannot stop polling before the installed status arrives.

The header's periodic environment scan was removed. Requirements polls installer progress only while an install is active. Model polling no longer restarts on every state update or overlaps requests. YouTube binary discovery also uses asynchronous cached checks.

## Measured results

Local Windows runtime, RTX 3080, current app models. An isolated server used the existing runtime for read-only requests; no package installation or transcription was triggered by profiling.

| Request | Before | After |
| --- | ---: | ---: |
| Initial Requirements status | 13,700 ms | 406 ms |
| Configuration request issued during that check | 13,560 ms | 17 ms |
| Cached Requirements status | — | 1 ms |
| Model list | — | 14 ms |
| Cached hardware | — | 2 ms |

These are individual traces, not statistical benchmarks or a guarantee about every workload. Reproduce the current trace with `node tools/profile-status.mjs`. The profile builds a temporary server and makes read-only requests; it never installs models, starts transcription, or changes configuration.

## Verification

- TypeScript checking and production build pass.
- Full regression suite: 20 passed, one optional spoken-audio recognition test skipped because `TEST_WHISPER_AUDIO` was not supplied. Coverage includes actual offline Faster Whisper CPU inference on silence, both engine adapters, timeline validation, chapter handling, metadata, range preview, and audio exports.
- Backend integration tracing: 48 warm status requests cause **zero additional subprocess launches or model directory scans**. Explicit refresh performs discovery again.
- Backend API tests verify separate engine inventories, partial snapshots, independent cancellation/removal, and simulated model-download success/failure/cancellation. Completion must publish Installed before polling stops. No network downloads are required for these tests.
- Cache tests cover concurrent reads, expiration, explicit refresh, failed probes, and invalidation while an older request is still pending.
- The focused seven-test suite passes, including a Python fixture that would execute a legacy startup hook or fail if PyTorch were imported; metadata discovery bypasses both while still finding the package version.
- Browser verification in an isolated test project: Faster ON shows Tiny installed and Base uninstalled; Faster OFF shows Base installed and Tiny uninstalled. Both use the same Install/Reinstall/Uninstall controls. Requirements lists runtime components without individual model controls. Model files for this UI check were sparse test fixtures, not usable transcription weights.

Full-book speech recognition and actual network downloads were not repeated. The measured server stall is resolved; the UI interaction checks supplement those timings but are not a renderer frame-rate benchmark.
