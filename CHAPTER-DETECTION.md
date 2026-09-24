# Chapter title cleanup and musical transitions

## Clean Chapter Titles

In Step 2, **Clean Chapter Titles** sits beside the chapter number controls. It
trims/collapses whitespace, removes spaces before closing punctuation and after
opening brackets, and applies English MLA-style title capitalization. Articles,
coordinating conjunctions, and prepositions stay lowercase internally; first,
last, and subtitle-opening words are capitalized. Verbs, pronouns, and
subordinating conjunctions are not on the lowercase list. This follows the
[MLA's title capitalization principles](https://style.mla.org/capitalization-of-titles/).

Numbers, uppercase Roman numerals, apostrophes, hyphens, known acronyms,
uppercase acronym-like words in mixed-case titles, and distinctive existing
mixed case are preserved. This is an editable English heuristic, not a grammar
model: ambiguous prepositions/verb particles, unknown acronyms in all-uppercase
titles, unusual proper names, and non-English titles may need adjustment.

Only changed titles and their manual-edit flags change. Ordering, start/end
timestamps, missing placeholders, and word associations remain intact. Cleanup
does not call the save API. **Undo title cleanup** restores the most recent
cleanup's titles by chapter ID without reverting later timestamp/reorder/add/
delete changes or overwriting titles subsequently edited by hand. Use the normal
**Save chapter list** action to persist either cleanup or undo.

## Existing detection architecture

Both Faster Whisper and OpenAI Whisper produce a persisted word timeline.
`tools/chapter-detection.ts` recognizes spoken headings across segment boundaries,
rejects inline references, suppresses exact duplicates, and conservatively recovers
specific missing numbered headings. `buildChapterCandidates` in `server.ts` uses
the same persisted word starts as interactive transcript navigation. The old
lead-in setting does not move word-anchored starts.

There are **no separate Fast, Hybrid, and Accurate chapter-detection modes** in
this checkout. The legacy `accurate` configuration is a transcription profile;
`hybrid` selects system versus managed runtime dependencies. Neither is an
acoustic chapter detector. Existing spoken confidence is an average word
confidence used for review, not a global ranking/acceptance threshold. Spoken
headings are not subject to a global minimum chapter spacing rule.

## Acoustic evidence for chapters

**Detect Musical Chapter Transitions — Experimental** is on by default in
Step 1's collapsed **Transcription & model settings**. Explicitly saved opt-outs
are respected. The option supplements spoken-heading detection with the two
paths below, using either transcription engine. File/folder-derived chapters
are unchanged. To update an existing transcript, rerun **Detect chapter
candidates**; it does not repeat transcription, merging, or model inference.
The existing manual-edit confirmation still applies.

### Recurring musical cues

`tools/music-transitions.ts` shortlists 1.5–45 second gaps between credible,
ordered transcript words. Explicit non-speech labels such as `[Music]`, split
`[instrumental music]`, and musical-note symbols do not conceal a gap. Ordinary
spoken uses of the word music remain speech. It requires three credible words
within six seconds on each side and excludes the first/last 60 seconds.

Only those PCM windows receive spectral analysis: a 1,024-sample Hann-window FFT
every 100 ms, with 24 normalized bands across eight time bins. Activity uses a
gain-relative RMS threshold with a PCM quantization floor, so quiet copies are
not rejected simply because their volume is below a fixed threshold. Active
cues must span 1.5–18 seconds, have at least 65% tonal frames (flatness <0.18),
and mean spectral variation >=0.008. Wider raw gaps allow surrounding silence;
they do not permit arbitrarily long music-only passages.

Fingerprints must agree at least 0.94 by cosine similarity, with durations
within 15% or 0.6 seconds. Require three mutually matching, independently spaced
occurrences, or two with at least 0.2 seconds of silence on both sides of each.
Nearby snippets, intro/outro cues, and transitive similarity chains do not count
as recurrence. Stronger candidates win spacing conflicts deterministically.
Spoken headings take priority within 120 seconds, and music boundaries stay
at least 120 seconds apart. These are supplemental-candidate safeguards, not
restrictions on explicit spoken headings.

Accepted cue starts use the first resumed word's saved timestamp, retaining
music in the preceding chapter. Untitled cues use normal `Chapter N` placeholders.
Confidence is an evidence score, not a calibrated music probability.

### Spoken titles without chapter numbers

`tools/title-boundaries.ts` recognizes a second pattern: tonal transition,
short isolated spoken title, another pause, then narration. This covers named
stories where the musical passages differ, so exact jingle recurrence is absent.

Candidates need an 8–60 second preceding gap, a 2–14 word phrase lasting at most
eight seconds, a 2.5–30 second following pause, and credible narration on both
sides. Conservative English phrase rules exclude dialogue, common narrative
clauses, credits, and end announcements. The preceding PCM window must contain
5–60 seconds of changing tonal audio with at least 80% tonal frames. At least
two different, independently spaced internal titles must pass these gates.
Only then can a similarly structured opening title also be accepted. Outro
regions, isolated titles, silence alone, steady hum, and broadband noise do not
establish this pattern.

The proposed name is the actual spoken phrase, formatted with the existing title
cleanup utility. It is not inferred from the story. Starts and transcript links
use the first title word's saved timestamp. Results are review candidates with
notes explaining their evidence. All normal editor, chapter-end, and export
behavior applies, and the Opening entry preserves the audio before the first
spoken title.

### Spoken-heading safeguards

Explicit heading detection supports digit ordinals (`21st`), `Chapter the First`,
Roman numerals, written numbers, structural headings, and front/back matter.
A real word-timed pause can establish a heading boundary even when punctuation
is missing. An arbitrary ASR segment boundary cannot turn a continued narrative
reference into a heading. Number parsing respects punctuation and pauses, so
`Chapter Twenty. Three people...` remains chapter 20. Widely separated marker
and number words are not joined. Missing-number recovery requires a completely
observed, unambiguous sequence of supported misspellings; it never fabricates
unspoken chapters.

The exact first matched word anchors explicit headings. The legacy lead-in
setting cannot move them into preceding narration. Wordless legacy headings
keep their real segment timestamp rather than snapping to an unrelated later
word.

### Caching, performance, and diagnostics

No new dependency, model, GPU, source re-encoding, or transcription is needed.
Both acoustic paths share bounded PCM feature extraction and the existing
preview analysis generation directory. Feature caches include the detector
version, preview size/mtime/ctime signature, and gap descriptors. Invalid or
incomplete feature records are rebuilt. Cancellation is checked between windows
and only complete results are published. No new full-source hash is added.

The detection-result cache includes all detector versions, actual transcript
segments/words, acoustic setting, and preview signature. Updates to parsing or
the saved timeline invalidate decisions while retaining the transcription cache.
Unchanged runs reuse reviewed chapters. Logs report accepted/rejected counts,
evidence, timestamps, and rejection reasons with bounded per-candidate detail.
Zero results explicitly report whether acoustic analysis was disabled.

### Limits and verification

This remains heuristic detection. Repeated dramatic effects can resemble musical
separators. Transcript omissions, hallucinations, or inaccurate word timing can
hide real boundaries or suggest false ones. The title phrase rules are English
and deliberately conservative: single-word titles, sentence-like titles, short
chapters, and cues under continuous narration may be missed. Music alone that
is neither recurring nor paired with a corroborated title structure is not
sufficient. Detection is not exhaustive; listen to proposed starts and review
transcribed names.

Synthetic tests exercise PCM extraction, gain changes, annotations, recurrence,
spacing, long padding, intro/outro, background narration, silence/noise/hum,
isolated titled sections, ordinary speech rejection, cache corruption and
invalidation, cancellation, exact word anchors, and existing chapter editor/end
rules. HTTP tests verify full processing and detection-only reruns reuse speech
results. Title-cleanup tests verify whitespace/capitalization, Roman numerals,
numbers, unchanged timestamps/order, and undo behavior. No copyrighted audio is
included as a test fixture.

Run `npm run lint`, `npm run build`, and `npm run test:audio`. On Windows, set
`TEST_FFMPEG` and `TEST_FFPROBE` to the bundled executables if absent from PATH.
