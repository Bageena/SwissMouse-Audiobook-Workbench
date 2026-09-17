# Audio support and chapter repair

Verified on Windows with FFmpeg/FFprobe `2026-08-17-git-426841da9d` (Gyan full build). Support requires working FFmpeg decoders/encoders; files that cannot be probed or decoded are failures, never estimated successes. Extensions identify candidates; stream/container inspection determines actual media handling.

| Input / codec fixture | Import + duration | PCM analysis + seek | Export / chapter representation |
|---|---|---|---|
| M4B, M4A / AAC-LC and ALAC | Verified | Verified | MP4 chapter tracks; compatible AAC/ALAC stream copy |
| MP3 | Verified | Verified | ID3 CHAP; stream copy |
| FLAC | Verified | Verified | CHAPTERnnn/CHAPTERnnnNAME comments; stream copy |
| Ogg (`.ogg`, `.oga`) / Vorbis | Verified | Verified | Ogg Vorbis chapter comments; stream copy |
| Opus | Verified | Verified | Ogg Opus chapter comments; stream copy |
| WebM / Opus (YouTube audio) | Verified through live YouTube import | Verified | Native source retained; AAC conversion for M4B |
| WAV / PCM | Verified | Verified | RIFF cue points + labels; compatible PCM stream copy |
| Raw AAC / ADTS | Verified, decoded frame count | Verified | Input only; choose one of the seven outputs |
| AIFF (`.aiff`, `.aif`) / PCM | Verified | Verified | Input only |
| WMA / WMAv2 | Verified | Verified | Input only |
| `.alac` containing MP4/ALAC | Verified as MP4 | Verified | Defaults to M4A; no separate raw-ALAC output |

“PCM analysis + seek” verifies decoding into the same 16 kHz mono PCM path used by WhisperX and review playback. **Actual WhisperX inference and alignment were intentionally skipped during the pipeline regression:** no Whisper models were installed or downloaded. The user had separately confirmed the Whisper integration and subsequently reported successfully processing a full audiobook. The model, source format, duration and chapter-detection settings for that full run were not recorded here. Codec variants beyond the listed fixtures, encrypted books, and malformed files are not certified.

## Repair workflow

1. Import the book. Step 1 inspects container, audio codec, duration, chapters, metadata and attached artwork. A single source file is the export master; it is not merged or re-encoded.
2. Use WhisperX detection for new candidates. A separate full-length PCM file is used for both analysis and browser review. It does not replace the export master. No silence/transcript trimming or timestamp offset is applied.
3. Compare original chapters with the editable chapter list. Save the reviewed list; only that list is exported. Include an opening marker at `00:00:00.000`, since MP4 chapter tracks require a marker at zero. A chapter before the first spoken heading does not remove any opening material. The last chapter extends through the recording end.
4. Edit metadata/artwork, then select any combination of M4B, M4A, MP3, FLAC, Ogg Vorbis, Opus and WAV. The source format is selected by default when offered; other inputs default to M4B. The interface states copy or conversion per output. Re-encoding requires the explicit conversion option or incompatible codec/quality.
5. Each output gets progress, success/failure, read-back metadata and compatibility warnings. Names include a run identifier; existing files are never overwritten. One failure does not stop later selected formats. Validation rereads the latest successful file.

Metadata and artwork survive ordinary MP4 repairs, including iTunes/freeform metadata that FFmpeg would otherwise discard. Cover edits support uploaded PNG/JPEG or removal. WAV/Ogg/Opus artwork embedding is currently unsupported and reported per output; original artwork remains in the project. Other containers may not represent every source tag; mismatches are reported from actual read-back. Advanced metadata types, unusual MP4 atom layouts and very large RF64 playback are not exhaustively tested.

Companion CUE files are optional, with 1/75-second precision. FLAC/Ogg/Opus chapter tags and MP3 CHAP support vary by player. WAV RIFF cue markers are **not universally equivalent to M4B audiobook navigation**. Non-WAV CUE consumers may require player-specific support for the referenced audio format. No external player's embedded chapter navigation was tested.

Completed aligned transcripts are reused when source-content hashes and transcription/processing settings match. Chapter edits, metadata edits and further exports do not run WhisperX. Changed source files or relevant settings invalidate the cache. Words without genuine alignment timestamps are not assigned fabricated word times. Source changes are checked again before export.

## Bitrates, source structure and direct stitching

- Final export offers 32, 64, 96, 128, 192, 256 and 320 kbps for lossy encoders. The default is the highest listed rate at or below the highest measured input audio bitrate, with a 32 kbps minimum and 96 kbps fallback when unknown. Higher settings do not restore source quality. Lossless outputs do not have a lossy bitrate control.
- Prefer stream copy/remux is the default. Compatible outputs retain their encoded audio; bitrate settings apply only when converting. Selecting re-encode explicitly enables bitrate changes for otherwise compatible outputs.
- Skip PCM requires verified matching container/codec/profile, sample format/rate, channel layout, time base and codec configuration. It retains the clean-audio warning and performs a full decode integrity check before direct stitching. Invalid or incompatible streams fail with an explanation; they do not silently bypass processing. Analysis/preview and the selected chapter-detection stage still run.
- Direct stitching retains encoded padding between files. Chapter boundaries use actual packet spans, preventing overlapping MP3 timestamps; they may differ slightly from gapless decoded durations. PCM normalization instead uses decoded file durations.
- Skip Whisper derives one chapter per naturally sorted loose file, or one chapter per numbered sequential folder (including all naturally sorted files within it). Numbered folders take precedence; unrelated folder names fall back to individual files. All sources are merged into one master. Uploads preserve relative folder structure and keep duplicate basenames distinct. A single book retains its embedded chapters for review.

Metadata fields use per-container representations: Narrator maps to composer/TCOM; title also sets album, and series uses separate series/series-part tags. MP4 uses standard atoms and iTunes freeform tags, MP3 uses ID3, FLAC/Ogg/Opus use Vorbis comments, and WAV uses RIFF INFO plus an ID3 chunk. WAV rich metadata requires a reader supporting that chunk. Mapping is checked against the [Audiobookshelf tag parser](https://github.com/advplyr/audiobookshelf/blob/master/server/utils/prober.js) and its [metadata conventions](https://www.audiobookshelf.org/docs/documentation/libraries/book-library/directory-structure/); a live Audiobookshelf library scan was not tested.

## Verification

### Current status (updated September 16, 2026)

- Latest completed pipeline regression: **7 passed, 0 failed, 1 skipped**. The skipped test was actual WhisperX recognition/alignment.
- The updated YouTube API was tested with a short public clip: best available WebM/Opus download → processing without a PCM repair master → chapter editing → metadata → M4B export → validation. The source file remained unchanged. A separate analysis WAV was generated for review; Opus was encoded to AAC for the final M4B.
- The user reports that YouTube downloading worked and that a full audiobook was successfully processed. This supplements the automated short-fixture tests; it does not establish coverage of every model, format or player.
- Automated metadata export/read-back tests passed, including the Audiobookshelf parser checks. **Manual metadata and cover-art verification in the user's audiobook player remains pending.** A live Audiobookshelf library scan and external-player chapter navigation have not been documented as verified.
- TypeScript validation passed again during the latest status check. The production build and whitespace checks passed during the pipeline work.

Run on Windows:

```text
npm install
npm run lint
npm run build
# Download the official parser reference before the metadata test (PowerShell):
New-Item -ItemType Directory -Force audio-test-reference
Invoke-WebRequest https://raw.githubusercontent.com/advplyr/audiobookshelf/master/server/utils/prober.js -OutFile audio-test-reference/prober.cjs
npm run test:audio
```

The tests use FFmpeg/FFprobe on PATH, or `TEST_FFMPEG` / `TEST_FFPROBE` executable paths. They create isolated `audio-test-*` fixture folders and preserve them for inspection. The HTTP test uses the built server and copies the test binaries into its private runtime. No production jobs are used.

The metadata test executes the actual reference parser against tags read from exported fixtures, rather than reproducing its logic. Set `TEST_ABS_PROBER` to use an existing checkout's `server/utils/prober.js`. The reference tested on September 15, 2026 has SHA-256 `91ce699b6d7927491e508c6d0dd30f25f7179506ef58503a1d25c653fde1a3fa`; upstream changes may change expectations.

The automated tests cover:

- All 13 advertised input extensions, accurate duration, corrupt-file rejection, full PCM decoding and seeks into opening/middle/trailing audio of nine-second fixtures.
- Seven output formats with title/timestamp read-back, CUE output, source-duration coverage and identical encoded packet SHA-256 sequences on compatible same-format repairs.
- AAC/ALAC M4B/M4A repair, artwork retention/removal, title/narrator/series edits, simultaneous output selections, HTTP byte ranges, validation and independent export failures.
- Source/settings fingerprint invalidation and refusal to overwrite an input.
- MP3 PCM normalization and encoded direct stitching, incompatible stream rejection with working PCM fallback, source bitrate defaults/manual overrides, numbered folders containing multiple files, naturally sorted loose files, duplicate-name uploads, and saved project structure.
- All friendly metadata fields in all seven containers read through Audiobookshelf's parser, including title/album, authors, narrator, subtitle, series/sequence, description, genres, publication year, publisher, language and identifiers; release date and explicit/abridged flags are also read directly from files.
- YouTube wrapper best-audio selection, exact Unicode/special-character output paths, unrelated partial-file avoidance, invalid inputs and download errors. HTTP coverage includes native WebM/Opus processing, reviewed chapters, metadata, M4B export/validation and clearing stale output after a failed rebuild.

An optional test runs actual Large-v3 Turbo recognition and word alignment when the private WhisperX runtime exists and `TEST_WHISPER_AUDIO` points to a spoken fixture of at most 60 seconds containing a chapter heading. Set `TEST_WHISPER_DEVICE=cuda` to use CUDA; otherwise it uses CPU/int8. This test was intentionally left disabled for the pipeline review to avoid model downloads. The isolated HTTP test also verifies that a missing Whisper runtime produces an error without fabricating a transcript; that fixture's missing runtime does not describe the user's working installation. Per-model recognition quality and aligned-transcript cache reuse still need dedicated verification.

The live YouTube API check is opt-in: set `TEST_YOUTUBE_URL` to a short video URL before running `npm run test:audio`. It requires the app-managed `runtime/bin/yt-dlp.exe` and network access. The latest live check used `https://www.youtube.com/watch?v=jNQXAC9IVRw` (approximately 19 seconds). Ordinary runs use a local WebM fixture and do not download a YouTube video. Leave `TEST_WHISPER_AUDIO` unset to keep recognition testing disabled.

The in-app Chromium browser was also checked: chapter audition sought to 4.5 seconds, the preview reported a 9-second duration, and seeking to 8.5 seconds returned `currentTime=8.5`. Multiple format checkboxes and copy/conversion labels were verified in the UI. This is **preview seeking**, not a test of exported chapter navigation in Apple Books, VLC or another player.

The updated browser controls were checked against saved fixture projects: a 128 kbps MP3 defaults to 128, its bitrate is disabled for copy and enabled for re-encoding, a manual 64 kbps choice is retained, and multiple outputs can be selected. Skip PCM remains available with Skip Whisper for compatible files and is disabled with an explanation for mismatched streams. Automated coverage uses short fixtures, including the approximately 19-second live YouTube clip; the successful full audiobook run is user-reported.

`npm run lint` includes server-side TypeScript. `npm run build` and `git diff --check` also pass.
