# Book Files

Current implementation guide for Alpha 6 development, carrying forward the released Alpha 5 foundation. Verification sections record their original scope; extension points below are proposals, not completed Alpha 6 features.

Book Files is the canonical import and file-review workspace. Library Manager's
Open action lands here. The project overview's Book Files button opens the same
component. Other project navigation retains its existing behavior.

## Layout and reuse

- `BookFiles` owns page navigation, Project Overview, and the readiness gate.
- `AddFiles` owns the initial collapse state, source tabs, and local selection.
  Existing YouTube and LibriVox components and local-source inspection are reused.
  Selecting a tab does not clear a manifest. Adding local files to a populated
  project preserves its previous members, manual metadata, chapters, and order.
- `WorkspacePanel` and `WorkspaceSplit` provide reusable presentation boundaries.
  The desktop split defaults to 70/30 and stacks below 1000 CSS pixels. The split
  is currently fixed; no layout persistence or workspace editor is introduced.
- `SourceFileBrowser` coordinates directory history, stable path selection,
  filtering, commands, dialogs, and the current project's manifest.
- `FileBrowser` renders the four file views and the inline cell editor. File
  kinds, selection rules, and view definitions live in `utils/bookFiles.ts`.
- `ProcessingOrder` renders the same persisted `job.parts`, with handle-only
  dragging, precise Up/Down controls, and membership-only removal.
- Toolbar, keyboard, and context-menu commands use one command definition and
  dispatcher. The existing Lucide set supplies icons. These are consistent
  placeholders where matching handmade action assets are not yet available.
- File previews extend the existing `QuickPlaybackController` and header player.
  The browser does not create another audio element. Repeated preview requests
  for the currently playing file retain playback. Preview position never becomes
  a book listening checkpoint. Audio uses the existing HTTP Range stream.

The existing Metadata editor is retained below the workspace. Its Finish,
source metadata writing, and organization actions retain their original roles.
Both processing entry actions revalidate the queue before leaving Book Files.

## Named chapter groups

In Processing Order, select two or more consecutive files, enter a chapter name,
and choose **Group selected**. Shift-click selects a range. Group names appear
above each assigned filename. Select any member and choose **Ungroup selected**
to dissolve its whole group. To rename a group, select all of its files and group
them again with the new name. Reordering must keep each group's files together.

Groups persist on `AudioPart.chapterGroup` as an ID and title. Grouping changes
only the manifest; it never moves, renames, or edits the original audio. Refresh,
settings saves, and processing retain group assignments and manual file order.

Audio Processing offers **Use grouped files as chapters** (`grouped_files`).
Each named group creates one chapter; each ungrouped file creates its own chapter,
even inside a numbered folder. Markers use cumulative inspected audio durations
in Processing Order. This workflow requires audio tools but no transcription
model. Chapter extraction reruns reuse the same groups and prepared audio.
Changing groups marks existing grouped chapter results and exports stale while
preserving chapter edits for review before rerunning.

## Filesystem and persistence boundaries

`tools/book-files-routes.ts` connects the UI to application services. Physical
operations and reference remapping live in `book-file-operations.ts`. Existing
membership/reorder endpoints, the shared media cache, metadata writer, project
store, folder opener, and verified project-transfer service remain in use.

Disk observations, browser selection, and project membership remain separate.
Navigation never attaches files. Filtering preserves selections by absolute path,
but commands act only on selected entries still visible under the current filter.
Removing a queue entry never deletes a disk file. Refresh checks assigned files
and their cached measurements; it does not rebuild membership or recursively
analyze every file in the browse directory.

Physical mutations are limited to the current project's source root. Navigation
outside that root is allowed; explicit attachment can broaden a same-drive source
root through the existing rebasing helper. Other projects' ownership is checked
before mutations. Linked paths and SwissMouse working directories are rejected.

Copy/paste and folder renames use exclusive destinations and verified content
copies. Cuts commit destination references before recycling originals. A failed
cleanup leaves verified destination references and preserves remaining originals,
with a visible warning and a recovery journal. Unknown or externally modified
recovery files are retained. Startup recovery never retries source deletion.

Delete from Disk requires a reviewed, stamp-bound plan. Windows uses
`IFileOperation` with recycling and early-failure flags and supports local fixed
drives. Linux uses `gio trash`. There is no permanent-delete fallback. Shell
paths are passed as environment data rather than interpolated into executable
PowerShell. Native behavior follows Microsoft's [operation flag definitions](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperation-setoperationflags).

Create New Book from Selected requests title, author, Inbox/Library, and an editable
destination. The Settings template generates the default path. Confirmation binds
source stamps, settings, and affected project references. The existing verified
transfer service copies and validates the files, atomically saves the new project
and affected memberships, and only then removes verified originals. It preserves
embedded file metadata and updates associated output references when applicable.

Filename edits update real disk names and source/companion references. Supported
text fields use the existing format-neutral FFmpeg writer and read-back checks.
Writable Details fields are Title, Author, Narrator, and Year for MP3, M4A, M4B,
FLAC, OGG, and Opus. Other formats remain readable and their filename can still be
edited; unsupported metadata cells are read-only. Empty values are not fabricated.
Failed writes restore the original bytes where safe; concurrent external changes
retain the current file and a recovery copy for review. Manual book metadata and
chapter objects are not rewritten by a file-cell edit.

Undo covers the most recent successful file rename or metadata cell edit in the
current session, provided the file has not subsequently changed. It does not undo
folder renames, copies, moves, new-book transfers, or disk deletion. Restore
recycled items through the operating system.

## Performance

Directory reads are asynchronous and shallow, with bounded stat batches. All four
views reuse the Library Manager's row windowing hook. Selection is independent of
mounted rows. Metadata loads in small visible-row batches through the shared cache.
Small/Large Thumbnails request lazy, cached images capped at 160 pixels; image
files and embedded audio artwork are supported. Missing art falls back to a type
icon. Changing a view or filter does not rescan audio.

An isolated local fixture containing 10,004 entries returned directory responses
in 448, 422, and 404 ms. List view mounted 32 rows while Ctrl+A selected all 10,004
entries. These measurements are local observations, not network-drive guarantees.
Physical operation requests are bounded to 10,000 selected items per request.

## Verification

- `npm run lint` (repository TypeScript check): passed.
- `npm run build`: passed. Vite still reports a main bundle over its 500 kB warning
  threshold; no new dependencies were added.
- Full tool regression suite: 443 tests, 440 passed, 3 optional skips, 0 failures.
  The skips cover the unavailable external Audiobookshelf parser fixture and two
  real Whisper/Faster Whisper inference fixtures.
- `npm run test:book-files`: builds and runs the focused source-browser,
  selection/windowing, filesystem/recovery, metadata-write, and player tests:
  25 passed, no failures or skips.
- Physical metadata tests cover MP3, M4A, M4B, FLAC, OGG, and Opus; they compare
  encoded packet hashes, read back edited/cleared tags, exercise undo, and inject
  persistence failures to verify byte-for-byte restoration.
- A disposable Windows fixture was recycled and its bytes read from the actual
  Recycle Bin. Native errors and cleanup failures are also covered with injection.
- Isolated browser checks exercised Library Open, the collapsed existing-project
  Add Files panel, cell editing with Enter/Tab/Shift+Tab/Escape, context preview in
  the header player, queue removal/re-adding and duration changes, directory
  navigation, multi-selection, Ctrl+A, and the reviewed new-book move dialog.
- `git diff --check`: passed for tracked changes.

## Limits and remaining manual checks

- Existing projects add local audio in place. Remote downloads continue through
  Import Book; appending remote downloads into an already populated queue is not
  implemented. This keeps the existing download handlers from replacing that
  project's source, chapters, or exports.
- A resizable divider, persistent layouts, a standalone File Manager, plugins,
  customizable metadata schemas, and other media viewers are outside this change.
- Only supported audio files have Open/Preview behavior in the browser. Other
  file types expose filesystem commands, path copying, thumbnails where supported,
  and Properties.
- Metadata search covers filenames and metadata already indexed or loaded; it
  deliberately does not probe an entire directory to satisfy a search.
- Cross-drive verified transfers use the established fallback, but this machine's
  physical cross-drive behavior was not exercised. In-place attachment across
  drives remains restricted by the existing source-root model.
- Linux Trash, network/removable-drive behavior, live remote downloads, visual
  checks across Dark/Parchment and narrow windows, and pointer-driven queue dragging
  should receive platform/manual release QA. Automatic tests cover reorder logic;
  the processing pipeline and real speech models were not run in the UI fixture.
- Disposable recycle-test items remain recoverable in Windows Recycle Bin.
  Test content is synthetic and separate from the user's library.

## Alpha 6 extension points

Keep panel placement/configuration outside file services. Promote the command
definitions into an application registry only when another real screen needs
them. Preserve format capability interfaces and add new readers/writers behind
them rather than exposing ID3-specific assumptions. Add durable operation history
and a recovery UI before extending undo to moves or deletion. A future multi-root
source manifest would remove the current same-drive attachment restriction.
