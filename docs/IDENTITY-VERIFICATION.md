# Alpha 5 identity preservation

Verification performed on Windows, 2026-10-21, using generated audio and isolated data folders. No user media was changed. No notebook implementation is involved.

## Identity rule

Relinking an existing missing source retains its project, work, recording and source-file IDs when book and narrator tags match. Comparisons normalize Unicode, whitespace and case. Multipart audio uses album tags rather than chapter titles and checks every selected member. These comparisons validate a user-selected relink; they do not automatically merge projects or use tags as IDs.

Known book or narrator conflicts reject the relink without changing the project. The UI offers Import Book to create a separate project; the user selects the new recording there. Missing tags require explicit confirmation that both the book and narrator are the same. That confirmation cannot bypass a known conflict. Audio tags are not proof of identical audio content; the existing relink path invalidates derived processing state.

## Verified

- File Manager filename editing and supported source-folder moves retain resource IDs.
- Single-file relink with matching tags retains project, part, work, recording and file IDs. A different narrator is rejected, including when confirmation is supplied; importing that recording separately creates separate recording/file IDs.
- Multipart relink with missing tags leaves the original reference untouched until confirmation, then retains IDs and draft metadata.
- Library move/copy operations retain existing resource identities through restart. Tests cover both transfer API entry points, shared files, collisions and source preservation.
- Actual cross-volume transfer was tested between C: temporary storage and a D: Library, asserting distinct filesystem device IDs. Same-volume transfers also passed.
- Switching from the checkout build to the assembled Alpha 5 package with the same application data root retains IDs and relinked paths. Rebuilding only the disposable catalog index also retains IDs.
- Legacy JSON migration leaves its input byte-for-byte unchanged. This is not a claim of complete published Alpha 4 project compatibility; that is not an Alpha 5 acceptance requirement.
- Deterministic transfer fault tests cover partial copies, disk-full errors, permission failures, changed sources/destinations and interrupted cleanup. These are simulations, not physical unplug tests.

## Reproduce

Build the application and assemble a package first. The package builder replaces its generated `release/SwissMouse-<version>` directory; keep user data out of that build-output directory.

```powershell
npm.cmd run build
node --import tsx scripts/build-release.ts
$env:TEST_PACKAGE_ROOT = (Resolve-Path release/SwissMouse-0.1.0-alpha.5).Path
npm.cmd run test:identity
```

For the physical cross-volume variant, run the checkout on a different volume from the system temporary directory:

```powershell
$env:TEST_CROSS_VOLUME = '1'
npm.cmd run test:identity
Remove-Item Env:TEST_CROSS_VOLUME
Remove-Item Env:TEST_PACKAGE_ROOT
```

Tests create and remove their own fixtures. Set `TEST_FFMPEG` and `TEST_FFPROBE` to installed tools if they are not under `runtime/bin`. The package uses the checkout's installed Node dependencies during these tests; this is not a clean-machine installation test.

## Portable installations and remaining limits

Stop SwissMouse before replacing files or copying its data. Preserve the complete application data folder (`APP_ROOT`), especially `jobs.json.sqlite`, `jobs.json.assets`, `catalog.sqlite.user.sqlite`, any SQLite journal companions, configuration and listening records. See [storage and recovery](RESOURCE-CATALOG.md#storage-and-migration). The launcher normally uses its own folder as `APP_ROOT`; moving program files alone does not move the saved library identities.

Inbox and Library may be separate locations. After a drive letter or media path changes, configure the appropriate roots and explicitly relink missing sources. Automatic remapping of drive letters is not established by these tests. Do not discard missing projects and rediscover them as substitutes for relinking.

Not physically verified: USB removal during writes, a USB drive receiving a new drive letter, SMB/NAS outages, or filesystem behavior on exFAT/FAT32. Native file-picker and confirmation-dialog interaction still needs a manual UI check. The package replacement test is an Alpha 5 deployment rehearsal with the same build, not an upgrade from every historic binary or a claim about future migration compatibility.
