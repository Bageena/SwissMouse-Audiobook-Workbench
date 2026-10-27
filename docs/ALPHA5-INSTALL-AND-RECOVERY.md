# Alpha 5 installation, backup and recovery

Alpha 5 is verified on Windows. Linux remains a future compatibility goal; support and release testing are deferred until Beta.

## Recommended: a fresh installation

Alpha 4 stored workbench projects; Alpha 5 introduces Inbox/Library scanning and durable catalog identities. Start Alpha 5 in a new folder rather than extracting it over the old installation. Keep Alpha 4 and its data intact. Full Alpha 4 project compatibility is not required for this release.

1. Stop the old SwissMouse and make a backup as described below.
2. Extract Alpha 5 into a separate folder. Install its dependencies through the normal setup instructions.
3. Choose separate, non-overlapping Inbox and Library folders. They may be on different drives. For a first evaluation, use a small copy of representative media rather than reorganizing your only copies.
4. Review discovered books and file membership, then test import, playback and export before using the full library.
5. Keep the old installation until any unfinished work has been recovered or intentionally left behind. Do not run both installations against the same writable media at once.

A fresh installation creates new catalog records. It does **not** preserve IDs from another installation. To preserve an existing Alpha 5 library, retain or restore its complete application data instead. Changing media locations should use supported moves or relinking, not deleting and rediscovering projects.

## Manual backup

Stop SwissMouse completely and wait for its server process to exit. Copy the entire application data folder to a separate location. The launcher normally uses its own folder as `APP_ROOT`; a customized launch may set a different data folder. Avoid backups into a subfolder that the library scanner will treat as new media.

At minimum retain:

- `jobs.json.sqlite` and any `-wal`, `-shm` or journal companions: current projects, drafts, membership and processing state.
- `jobs.json.assets/`: referenced transcript and cover payloads.
- `catalog.sqlite.user.sqlite` and its journal companions: durable identity aliases and collections.
- `listening/`, configuration, profiles and custom themes present in the installation.
- Legacy `jobs.json`, `jobs.json.bak` and schema recovery snapshots, when present.
- Media, sidecars and outputs stored outside the application folder; record their Inbox/Library paths separately.

`catalog.sqlite` and `directories.sqlite` are rebuildable indexes, but copying the complete stopped folder is simpler. Do not copy just the main database while the server is running, mix files from different backups, or treat the legacy JSON as current after migration. Browser-local layouts and browser preferences are separate: retain the browser profile if you need them. Portable workspace profile export is not implemented.

## Manual restore and check

1. Stop SwissMouse. Preserve the current installation under a different name; do not overwrite the only recovery copy.
2. Restore the complete backup into a separate folder. Use the same SwissMouse version that made it, or a compatible newer version. Install dependencies as needed without replacing the saved data.
3. Keep external media at its original paths where possible. Configure changed roots and explicitly relink missing sources when required; do not remove missing records to force rediscovery.
4. Open representative books. Check drafts, ratings, processing order, transcript access, collections and playback. Where cross-module references matter, compare resource IDs via the catalog APIs before and after recovery.
5. Keep the backup until these checks pass. A successfully copied folder alone does not prove every external media file was backed up.

## Schema protection

The project database uses SQLite `PRAGMA user_version` as its schema version (currently 1). The existing `project_meta.version` remains the change-feed revision; it is not a format version.

Opening an existing unversioned Alpha 5 database validates its layout and integrity, writes a standalone `jobs.json.sqlite.schema-0-<id>.bak` snapshot, then changes the schema marker and indexes in one transaction. The snapshot includes committed WAL contents. If the snapshot cannot be written, migration stops. The original legacy JSON is retained by the separate JSON migration.

Schema snapshots cover the project database only. Keep its asset folder and the other durable files with it; they are not a substitute for the full manual backup. No per-start or per-save full backup is added.

A newer unsupported project schema is refused before database writes. Do not remove the database or change its version marker to bypass that refusal. Use a compatible version or restore a complete older backup into a separate installation. Older SwissMouse builds that predate this guard may not enforce it: never test a downgrade against your only library.

These protections cover the durable project schema. Future changes to other authoritative stores also need explicit version checks and migrations; the project schema number is not a global format version.
