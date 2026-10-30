# SwissMouse 0.1.0-alpha.5

Released. Alpha 6 is now in development; these notes describe Alpha 5.

Alpha 5 expands the audiobook workbench with an Inbox and Library, a shared
resource catalog, Book Files, listening progress, and a movable workspace.

- Browse books in Cover, List, and Edit views, with catalog search, filtering,
  collections, saved searches, and bounded paging.
- Reference local audio without copying it; review files, organize books, and
  use supported copy, move, and relink actions while retaining book identities.
- Resume listening with the shared player and saved progress.
- Arrange panels per page, use grid or canvas layouts, and reset page layouts.
- Use extended metadata, draft cover generation, bulk chapter editing, and
  reviewed chapter suggestions in the existing processing workflow.
- Choose the new Cheese · Paper & Ink appearance or the updated Forest theme.
- Keep durable project state in SQLite, with schema checks and documented
  manual backup and recovery.

## Installation

Windows is the verification target for this alpha. Install a supported Node.js
LTS version satisfying `^22.13.0 || >=23.4.0`, extract the ZIP into a **new folder**,
and run `Start Audiobook Workbench.bat`. Keep Alpha 4 and its data intact.
See [installation and recovery](../ALPHA5-INSTALL-AND-RECOVERY.md).

First launch downloads locked JavaScript dependencies. Processing tools and
models are installed separately through System Requirements; they are excluded
from the ZIP. Use copies of audio for testing and verify exported results.

## Known limits

This is prerelease software. Linux support/testing is deferred until Beta.
Full Alpha 4 project migration, a third-party plugin runtime, notebooks, sync,
and general multi-media modules are outside this release. Physical USB/NAS
failure recovery, pristine-machine installation, every GPU configuration, and
full-length audiobook workflows still require testing. The verification guides
record narrower checks and their limitations.
