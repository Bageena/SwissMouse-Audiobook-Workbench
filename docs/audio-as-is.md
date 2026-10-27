# Use audio as is

Every Audio Preparation card offers an optional **Generate waveform** checkbox, off by default. The choices are **Prepare for accuracy**, **Join without converting**, then **Skip**. Their badges show AI usage and expected speed; waveform analysis itself uses no AI. The checkbox is enabled on the selected preparation card.

Review/transcription PCM and waveform data are independent. With waveforms off, transcription and combined-file playback can still create the preview they need, but no waveform peak levels are built or requested by the editor. Music/chapter detection may retain acoustic features without waveform levels. Cached waveforms are retained when disabled. The independent **Generate waveform (optional)** stage can create or rebuild a waveform later without replacing chapters or rerunning transcription.

Audio Preparation includes **Skip — use audio as is**. A single recording is reviewed directly, without normalization, joining, or generating PCM unless transcription or waveform creation is requested. Multiple recordings remain separate source files; a 16 kHz mono review preview provides the combined editor timeline. A full-quality master is created only when an export needs the sources joined. Compatible streams are copied; incompatible formats still require conversion at export. Originals remain unchanged.

Chapter Creation is independent of preparation:

- **Find spoken chapters** generates a transcript and chapter suggestions.
- **Use files & folders** and **Use chapter groups** retain their existing structural chapter workflows.
- **Use existing chapters** reads embedded markers in supported audio formats or one confidently associated chapter/playlist file. Embedded markers take precedence unless a file was explicitly imported. Multipart embedded markers are offset in Processing Order.
- **Skip automatic creation — edit manually** preserves the current chapter list without generating markers. Users can build the list in Chapter Review.

Every route opens the same editor, including adding, removing, renaming, and adjusting timestamps. At least one complete chapter entry is required for export. Existing chapters are detected before processing and counted beside the option; the source files are checked again when the workflow runs.

Optional **Generate transcript** creates searchable, aligned text without generating chapter markers when a non-AI chapter source is selected. **Generate transcript only** can also run later as an independent stage; it does not replace chapters or invalidate their review/export/validation. Finding chapters from the transcript remains an explicit workflow choice with the existing replacement confirmation.

Automatic sidecar matching requires either an exact audio basename (including `book.mp3.cue`) or exclusive ownership of audio files in the folder. Every CUE FILE reference must match a selected input, cover all selected inputs, and have valid, increasing INDEX 01 timestamps within the corresponding recording. Ambiguous, malformed, conflicting, or unrelated sidecars are ignored. Generic TXT, XML and VTT files additionally need a chapter filename or an exact audio basename.

The small import button at the bottom of **Use existing chapters** opens a chapter/playlist file picker. Supported formats:

| Formats | Imported chapters |
| --- | --- |
| CUE | INDEX 01 timestamps and track titles, offset across selected audio files |
| M3U / M3U8, PLS, XSPF, WPL, ASX | One chapter per referenced audio file; measured audio durations determine boundaries |
| FFmetadata (`.ffmeta`, `.ffmetadata`, or recognized `.txt`) | CHAPTER blocks with TIMEBASE, START, and title |
| Chapter TXT | OGM `CHAPTER01` / `CHAPTER01NAME`, or `HH:MM:SS.mmm Title` lines |
| Matroska chapter XML | One edition; nested chapters are flattened to leaf chapters |
| WebVTT | Cue start timestamps and cue text |

Files are limited to 1 MiB. Local playlists must include every selected input exactly once and match Processing Order; imports never attach audio, reorder it silently, or fetch remote URLs. HLS streams are not supported. XML parsing does not load external DTDs and rejects internal entity definitions. UTF-8, BOM-marked UTF-16, and legacy Windows text are decoded by the file picker.

An explicit import is stored with the project, bound to its source audio signature, and takes precedence over embedded chapters. Importing selects the chapter source without replacing current chapter edits; running the workflow applies it. Clear the imported source to return to automatic detection. If the audio changes, reimport or clear the selected file. Imported chapter starts must increase and fit the measured recording duration.

Format references: [XSPF specification](https://www.xspf.org/spec), [VLC M3U reader](https://github.com/videolan/vlc/blob/master/modules/demux/playlist/m3u.c), [FFmpeg metadata format](https://github.com/FFmpeg/FFmpeg/blob/master/doc/metadata.texi), and [Xiph chapter fields](https://wiki.xiph.org/Chapter_Extension).

The normal export and final-check path completes these books. Choosing the original output format and keeping compatible audio preserves encoded audio while applying reviewed metadata and chapter changes. Changing formats or excluding audio ranges may require conversion, as shown by Export.
