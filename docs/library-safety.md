# Library and project state

`jobs.json` is the durable project record: IDs, source membership, associated
files, saved metadata, unfinished metadata drafts, chapter edits, and export
references. `ProjectStore` replaces it atomically and retains the previous
successful save as `jobs.json.bak`. A damaged store is preserved before backup
recovery; if neither copy is valid, startup stops instead of creating an empty
library.

Large covers, text, and transcripts are stored losslessly as immutable JSON
payloads in `jobs.json.assets/`. The manifest references them by SHA-256; loading
checks their hashes. Existing inline stores migrate on their next save. Back up
`jobs.json`, `jobs.json.bak`, and the entire `jobs.json.assets/` directory together.
Payloads used by older backups are retained, not automatically garbage-collected.
This avoids rewriting every cover and transcript on each draft or progress save.

Filesystem observations are separate. Refresh reconciles available files and
caches inspection by file identity, size, and timestamps. Missing records remain
recoverable. Manual metadata overrides, including empty values and removed
covers, survive discarded scan state. Metadata revisions reject saves from an
outdated editor.

Scans prefer an associated folder cover, then read embedded attached artwork
from the same first/last audio files sampled for metadata. They read only tags
and stream headers, extract a single image without changing the audio, and cache
observations by file identity and timestamps. Existing scan records receive a
one-time cover check after upgrading; subsequent unchanged scans reuse their
saved covers. Manual cover choices and explicit removals take precedence.

Refresh can reconnect a missing recorded export that moved within its own book
folder (for example, from `Finalized/` into the book folder). It requires one
unclaimed candidate with the recorded file identity (or filename for older
records) and byte size, then verifies duration,
codec, chapter count, and unchanged file stamps. It updates export references
without replacing the original source list, drafts, or chapter edits. Ambiguous
or mismatched files stay unassigned. Recovered exports need a new final check.

## File ownership and transfers

`projectFiles` resolves existing source parts, associated sidecars, and recorded
outputs into one file list. The containing folder does not establish ownership.
Transfers use that list, verified copies, a recovery journal, and a durable
project update before source cleanup. Only verified, unshared originals are
removed; folder cleanup uses empty-directory removal and stops at configured
roots. Destination collisions and unrelated files are retained.

For unshared files moving on the same volume, transfers first create a hard link
in the private staging directory. They hash the content and verify file identity,
size, and timestamps before committing. Cleanup verifies the destination still
references the same file before removing the original name. Copy & Keep, shared
files, cross-volume moves, and volumes without hard-link support use independent
verified copies. Both paths use the same recovery journal and collision checks.

Interrupted transfers preserve originals. Recovery relocates only unchanged
destination files whose recorded identities and hashes establish ownership;
legacy journals without that evidence require manual review. An interrupted
cleanup restores a quarantined original when its original name is available.
Recovery never resumes source deletion automatically.

The selected metadata and cover are written at the destination. Differing
original sidecars are retained under `Original sidecars`. Shared or ambiguous
folder metadata is not overwritten. The transfer preview identifies associated
files, files staying in place, and destination conflicts; the actual operation
checks these conditions again.

Finished audio, its cover, metadata, CUE and `Originals.zip` are placed directly
in the book folder, without a `Finalized` subfolder. An original audio filename
that collides with a finished file is preserved under `Original audio`.
The final screen enables Move to Library after a successful current final check.
Library Manager also permits an unchecked transfer, with a notice; transferring
does not mark an unchecked book complete. The shared dialog defaults to
Move & Clean Up and also offers Copy & Keep.

## Optional original audio archive

The conversion checkbox starts unchecked. When selected, all requested exports
must succeed before creating `Originals.zip` next to the finished audio. ZIP
creation and read-back stream files with bounded memory. One complete validation
pass checks entry names, count, lengths, CRC and SHA-256 against the originals.
Only project audio members are archived; unrelated files are not included.
An existing ZIP or shared original prevents cleanup.

Original names are temporarily quarantined with a durable recovery journal.
Validation or project-save failures restore them. Original audio is deleted only
after the ZIP passes and its project association is saved. Startup restores any
remaining quarantined files after an interruption and never resumes deletion.
Archive errors are shown on the conversion screen; successful audiobook exports
remain available. Archived source membership and drafts stay in the project.
Refresh, final checks and transfers recognize the verified archive instead of
treating intentionally removed originals as missing. Restore audio from the ZIP
before processing the original source again.

## Metadata boundaries

The shared metadata editor powers Import, Review Files, and Metadata. Saved
project metadata and `metadataDraft` are distinct. Embedded audio tags are an
explicit write action. Saving book details updates eligible adjacent
`metadata.json` files without rewriting audio; Sidecar tools can rebuild a
sidecar removed or changed by another application.

The Audiobookshelf sidecar is an interchange projection, not a project backup.
It contains the fields mapped by `audiobookshelfMetadata`, including contributor
arrays, genres, tags, publication details, content flags, and export chapters.
SwissMouse-specific state, drafts, cover design, file ownership, and fields
outside that mapping remain in the project store. Contributor arrays preserve
commas within names; legacy text edits continue to work.

Final Check reads every recorded output format, including detecting missing or
outdated outputs. A successful last export cannot hide an invalid alternative.
The imported status means an import was finished; verified completion is a
separate state.
