# Batch 5: source processing, transcription and reruns

Implemented October 28–29, 2026 on `codex/audiobook-batch1`. This completes the processing slice in stage 3 of the [Audiobook separation plan](AUDIOBOOK-SEPARATION-PLAN.md). Changes remain uncommitted with the preceding batches and Preferences work.

## What moved

The Audiobook package now coordinates source inspection/preparation, review previews and waveforms, transcription, spoken and experimental chapter detection, direct chapter extraction, and independent stage reruns. It owns stage definitions, progress, cancellation and processing logs.

| Component | Responsibility |
| --- | --- |
| `packages/audiobooks/src/processing-backend.ts` | Start/rerun commands, source preparation and direct chapter workflows, progress/cancellation and stage completion/failure. |
| `processing-speech.ts` | Transcription plan, runtime/model selection, prepared-source checks, normalized transcript replacement and temporary-result cleanup. |
| `processing-detection.ts` | Word-anchored candidates, detector cache key, orchestration of structural/acoustic suggestions and bounded heading rechecks. |
| `processing-state.ts` | Shared running flag, abort controller, current project, progress state and existing progress/model contracts. |
| `processing-ports.ts` | Named interfaces to existing source, store, runtime, media, acoustic-analysis and logging services. |

The package also owns the existing transcription policy, normalized engine contracts, cache-key/reuse rules, spoken-heading parser, word-alignment utilities, initial candidate-to-chapter policy and pipeline eligibility. Existing file paths re-export those implementations. The legacy transcription-cache adapter retains its default fingerprint function; package callers supply their existing source fingerprint explicitly. Stored key formats and detector versions are unchanged.

Five existing HTTP registrations delegate through the plain-input/status-reply route adapter: Step 1 progress/cancel, both start aliases, and independent reruns. Their original registration positions, feature requirements and global runtime/library guards remain. Start commands still acknowledge background work, with progress available at the existing URL.

## Behavior retained

- One processing state is shared by the module coordinator and the host's import, discovery, metadata, cleanup, runtime and export guards. Cancellation requests abort the current controller; the running lock stays held until background work settles, so another run cannot race a stopping engine.
- Unchanged source, preparation and transcription keys reuse the existing master, preview and transcript where eligible. Current detection keys can retain reviewed chapters. Source/settings changes still cause the established invalidation behavior; this batch does not force reruns merely because code moved.
- Independent transcription computes replacement output before publishing it. Failed/cancelled engine work retains previous successful transcript/chapter output. Transcription requested alongside direct file chapters does not automatically redetect or replace those chapters.
- Rerunning chapter detection/extraction still requires confirmation when it would replace manual chapter work. Word-click and candidate timestamps use the same saved timeline, including legacy segments without word timestamps.
- Improved Chapter Detection remains experimental and off by default. Uncertain acoustic/structural results remain suggestions requiring acceptance and normal saving. Heading rechecks reuse local models and do not download missing ones.
- Existing source paths, part/project/chapter IDs, saved metadata, ratings, transcripts, SQLite storage and API responses remain compatible. No new store, migration, dependency installation or third-party bundle is introduced.

## Boundary limits

These are trusted, in-process built-in services. The host still supplies the existing audio preparation/preview engines, transcription execution/fallback, acoustic analysis, runtime discovery and model/dependency management. Some decoder replies retain their legacy permissive types. The explicit engine ports are provisional integration contracts, not a finalized writable extension SDK or process sandbox.

The installed Batch 1 artifact stays read-only. The full audiobook client/backend is not yet an independently installable package; no separate repository or Core-only independence is claimed. Export/validation/finalization, archive/cleanup/recovery, remaining route adapters, settings/dependencies and generic Core assumptions still need the planned extraction.

## Validation

| Check | Result |
| --- | --- |
| TypeScript check and final production build | Passed; existing large-browser-chunk warning remains |
| Focused coordinator, backend boundary, alignment, eligibility and transcription-policy checks | 69 passed, no failures or skips |
| Relocated cache/heading/transcription-engine policy checks | 76 passed, 1 optional inference skip |
| Client, project API, Book Files and module-host compatibility group | 38 passed; assembled-install fixture timed out in the concurrent validation run |
| Assembled module installation, isolated rerun on final build | 1 passed in approximately 25 seconds, no failures or skips |
| Final full serial audio/regression suite | 402 passed, 3 optional skips, no failures |
| Whitespace and compatibility-facade checks | Passed |

The focused tests directly exercise the module coordinator with controlled engines: early rejection, manual-chapter confirmation, cancellation while an engine is still settling, failed and successful transcription replacement, independent chapter preservation, and full-run reuse of saved transcript/master/preview/reviewed chapters. The import-boundary test builds the backend and checks runtime and type dependencies against package-local code, the public SDK and Node built-ins.

The existing word-alignment regression now calls the exported module candidate builder directly instead of extracting a function from `server.ts`. Cache-version and initial chapter-finalization tests exercise the relocated module implementation while retaining controlled preview metadata/detector versions. Compiled-server regression fixtures exercise full processing and reruns through the original HTTP routes, alongside existing project/import/storage/module checks. Fixture transcription demonstrates coordination and compatibility; it does not establish real-model accuracy, hardware support or large-library performance. No real library was modified and no browser/UI validation was performed for this backend slice.

The first broad run exposed eight tests that still searched for relocated code in `server.ts`. They were updated to exercise the module implementation; the final broad run passed all of them. The initial assembled-install timeout was rerun independently and passed; the initial timeout is retained in the compatibility log rather than counted as a pass.

Run `npm.cmd run test:audiobook-processing` for focused processing and API regressions (its pretest builds the application). Final broad evidence is retained in `.cache/batch5-audio-final.log`. Additional evidence is in `.cache/batch5-focused.log`, `.cache/batch5-moved-policy.log`, `.cache/batch5-compatibility.log`, `.cache/batch5-module-install.log` and `.cache/batch5-build.log`.

## Next batch

Batch 6 has since extracted export, validation, finalization and archive/cleanup/recovery. Its [checkpoint](BATCH6-COMPLETION.md) records compatibility, lock corrections, validation and the remaining Core-independence work. The next planning step is the shared information contract review before broader Core independence and settings/dependency ownership work.
