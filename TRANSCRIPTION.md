# Transcription performance and GPU support

## Safe defaults

Faster Whisper keeps the non-batched path, word timestamps, VAD disabled, and beam size 5. Experimental GPU Batching is Off. Regular OpenAI Whisper retains its original temperature-based decoding defaults; incompatible beam and batching controls are disabled.

Open **Transcription & model settings → Advanced transcription** to choose Auto/CPU processing, batching, and Faster Whisper beam size (integer 1–5). Lower beams generally reduce search work; higher beams do not guarantee better recognition. Choices are saved per project and per backend. Language defaults to English; the project settings API also accepts a backend-supported language code.

## Actual GPU capabilities

- Hardware detection records NVIDIA presence, memory, driver-reported maximum CUDA version, and GPU compute capability where available. Hardware presence is not proof that a backend can use CUDA.
- Regular Whisper checks the installed PyTorch build, bundled CUDA version, and torch.cuda.is_available(). A tiny CUDA operation must initialize and synchronize before GPU processing is offered.
- Faster Whisper independently queries CTranslate2 CUDA device count and supported CPU/CUDA compute types. It does not need CUDA-enabled PyTorch. GPU model allocation is verified during transcription, not by loading a model whenever Requirements opens.
- UI status distinguishes GPU available, GPU detected with CPU-only PyTorch, unavailable acceleration, and explicitly selected CPU. Diagnostics separately report initialization as not tested, verified, or failed.

Capability snapshots are shared for five minutes; transcription refreshes its selected backend before running. Requirements **Check again** and runtime installation invalidate snapshots. Ordinary package discovery remains metadata-only. Checks never download speech models.

## PyTorch builds in Requirements

Choose **Keep existing build**, **Install CPU PyTorch**, or **Install GPU/CUDA PyTorch**, then use the installation button. Replacing any detected existing build requires confirmation. No automatic CPU-to-CUDA conversion occurs.

Automatic GPU installation requires suitable NVIDIA hardware, driver CUDA support, and Windows/Linux x64. The pinned PyTorch 2.8 wheel family is selected by compute capability, not GPU name: cu126 for supported older architectures, cu128 for compute capability 10–12. Unknown/incompatible information disables CUDA with an explanation; CPU remains available. Final verification tests actual CUDA initialization. No system driver is installed.

Requirements shows PyTorch version, CUDA build/runtime, and GPU availability. The PyTorch installer affects regular Whisper only: Faster Whisper uses CTranslate2 and the same downloaded model on CPU and GPU. CUDA libraries for Faster Whisper are a separate optional component. If verification fails, inspect the installation diagnostic log; package replacement is not automatically rolled back.

Driver compatibility detection recognizes both NVIDIA's older `CUDA Version` header and newer `CUDA UMD Version` header. The reported driver compatibility, driver version, and GPU compute capability appear beside the PyTorch selector. If GPU installation is unexpectedly unavailable after updating SwissMouse, restart it and choose **Check again** to refresh cached hardware information. Unknown compatibility remains blocked with an explanation; it is never inferred from the graphics-card name or driver-version number alone.

## Experimental batching

Off uses WhisperModel. Auto or an explicit batch uses BatchedInferencePipeline with word timestamps. **Batch 1 is still experimental and is not equivalent to Off.**

Choices 1, 2, 4, 8, and 16 are filtered against the selected model and advisory free GPU memory. Auto chooses at most 4, reserves 1 GiB headroom, and budgets model memory plus a per-segment allowance. Unknown memory limits choices and Auto to 1. These hardware-agnostic estimates are not allocation guarantees. Unavailable saved values are rejected with an actionable message rather than silently ignored.

Batching uses VAD for long-form segmentation and restores words to original source timestamps. Segmentation, context conditioning, and temperature handling differ from non-batched decoding. Compare chapter headings, spoken numbers, and word timing before adopting it for a book. Batching remains opt-in.

## Fallback and logging

GPU out-of-memory failures reduce batches (e.g. 8 → 4 → 2 → 1), then try CUDA int8_float16 if supported, then supported CPU compute with batching Off. Off remains non-batched during retries. GPU runtime/library failures go directly to CPU; unrelated errors and cancellation do not trigger repeated GPU retries or silent engine changes.

Retries restart transcription from the beginning; there is no partial-transcription checkpoint. Startup logs show engine, model, device, compute, batch, beam, backend capability, cache hit/miss, and fallback. Saved transcript metadata records actual fallback settings.

Every failed inference attempt prints its original backend error/traceback to the server terminal, including errors followed by successful recovery. The progress log retains a concise error with the failed device, compute type, batch and beam. Logs distinguish requested batching (including Auto) from its resolved size, number each attempt, and finish with the successful settings and whether fallback was used. Returned backend settings are checked against the request; mismatches fail rather than being reported as confirmed settings. CPU-only capability checks also log why GPU processing was skipped.

## Source fingerprints and cache

Source files are content-hashed once per processing request. Preparation and transcription keys derive from this hash without rereading the audiobook for each stage.

Preparation depends on source identity and merge method. Transcription depends on prepared audio, engine/runtime versions, model, language, device preference, initial compute/resolved batch, beam, and word-timestamp/decoding policy. A result key records actual fallback settings too. Themes, chapter titles, editor preferences, unrelated profiles, and detection lead-in do not invalidate transcription. Chapter detection can rerun from cached words.

An explicit transcription-only rerun forces new transcription, but a successful result remains reusable by later full processing. Failed same-source reruns preserve the prior successful transcript. File-based chapter processing retains valid transcription for later speech-based detection. Cache hits preserve reviewed chapters unless detection is stale or its settings changed.

Legacy projects without request/result keys incur one safe cache miss during full processing; legacy preparation keys may also require one preparation pass. A transcription-only rerun asks for full processing if prepared input cannot be verified. Old settings are not guessed. The cache retains one current transcript per project, not a history of every model/beam combination.

## Verification and benchmarking

Run npm run lint, npm run build, and npm run test:audio. Tests cover backend independence, simulated CUDA/CPU-only PyTorch, Off/Auto/explicit batches, OOM reduction, unsupported settings, beam propagation, fingerprints, cache invalidation, and successful-rerun cache reuse through the HTTP API. Existing chapter, alignment, synchronization, theme and export regressions remain in the suite.

For isolated visual testing, run node tools/preview-transcription.mjs after building, then open http://127.0.0.1:3109. This simulates CUDA-capable Faster Whisper beside CPU-only PyTorch without modifying production projects or installed packages.

Benchmark representative short and multi-hour books on multiple GPUs and CPU-only systems before changing defaults. Compare Off/Auto and beams 1/3/5 with the same source/model/language; record elapsed time, memory, fallback, chapter/number accuracy and word alignment. A short smoke test is not evidence of long-book accuracy or a guaranteed speedup. Test package replacement, low-memory GPUs, multi-GPU ordering, and non-Windows wheels on those actual environments.

References: [Faster Whisper implementation](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/faster_whisper/transcribe.py), [CTranslate2 compute types](https://opennmt.net/CTranslate2/python/ctranslate2.get_supported_compute_types.html), [official PyTorch wheel options](https://pytorch.org/get-started/previous-versions/).

## Implementation files

- Runtime and cache: server.ts, src/transcription.ts, src/types.ts, tools/transcription-engine.ts, tools/transcription-capabilities.ts, tools/transcription-cache.ts, tools/requirements.ts.
- UI: src/App.tsx, src/components/Step1MergeDetect.tsx, src/components/TranscriptionOptions.tsx, src/components/RequirementsModal.tsx.
- Verification: tools/transcription-engine.test.ts, tools/transcription-performance.test.ts, tools/transcription-api.test.mjs, tools/preview-transcription.mjs.
- Documentation and packaging: README.md, TRANSCRIPTION.md, package.json, scripts/build-release.ts.

Verification on 2026-09-21: TypeScript checking and production build passed. The full regression suite passed 143 tests with 3 optional fixture-dependent skips and no failures. After the final compact-error change, focused transcription/API tests passed 65 tests with 1 optional skip. Browser checks confirmed Off/beam-5 defaults, control updates, per-engine retention, disabled regular-Whisper controls, CPU selection, and Requirements capability/build choices. The computer-use skill was used only for this isolated browser verification.

Installed-runtime probes reported PyTorch 2.8.0+cpu with CUDA unavailable and, independently, Faster Whisper 1.2.1/CTranslate2 4.8.2 with CUDA compute support. No installed packages were changed. Real-model inference, full-book accuracy/speed comparisons, and CUDA PyTorch replacement were not exercised in this validation run.
