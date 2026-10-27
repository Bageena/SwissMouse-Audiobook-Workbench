import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/** SQLite schema version, independent of the project change-feed revision. */
export const PROJECT_SCHEMA_VERSION = 1;

function version(db: DatabaseSync) { return Number(db.prepare('PRAGMA user_version').get()!.user_version); }
function supported(value: number) {
  if (value < 0 || value > PROJECT_SCHEMA_VERSION) throw new Error(
    `This library uses project database schema ${value}; this SwissMouse supports up to ${PROJECT_SCHEMA_VERSION}. ` +
    'Open it with the same or a newer compatible SwissMouse version. Keep this installation intact; do not delete its database or replace it with an empty library.');
}

export function openProjectDatabase(file: string, warning: (message: string) => void = () => {}) {
  // Refuse future formats before enabling WAL, creating tables or writing anything.
  if (fs.existsSync(file)) {
    const probe = new DatabaseSync(file, { readOnly: true });
    try { supported(version(probe)); } finally { probe.close(); }
  }
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
    const current = version(db); supported(current);
    if (current < PROJECT_SCHEMA_VERSION) {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.length) {
        // Version zero is the existing Alpha 5 schema. Do not guess at foreign databases.
        for (const [table, required] of [['project_state', ['id', 'payload', 'previous', 'version', 'deleted']], ['project_meta', ['key', 'value']]] as const) {
          const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
          if (required.some(column => !columns.includes(column))) throw new Error('Unrecognized project database layout. Keep the original installation intact and restore a verified backup.');
        }
        if (db.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') throw new Error('Project database integrity check failed. Migration stopped; restore a verified backup.');
        // VACUUM INTO captures committed WAL data in a standalone SQLite snapshot.
        const recovery = `${file}.schema-${current}-${randomUUID()}.bak`;
        db.prepare('VACUUM INTO ?').run(recovery);
        const fd = fs.openSync(recovery, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        warning(`Project schema recovery snapshot saved: ${recovery}. Keep jobs.json.assets with this snapshot.`);
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        supported(version(db));
        db.exec(`CREATE TABLE IF NOT EXISTS project_state(id TEXT PRIMARY KEY, payload TEXT NOT NULL, previous TEXT, version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
          CREATE INDEX IF NOT EXISTS project_changes ON project_state(version,id);
          CREATE TABLE IF NOT EXISTS project_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
          INSERT OR IGNORE INTO project_meta VALUES('version',0);
          CREATE INDEX IF NOT EXISTS project_logical_groups ON project_state(deleted,coalesce(json_extract(payload,'$[0].logicalBookId'),id));
          CREATE INDEX IF NOT EXISTS project_output_roots ON project_state(deleted,json_extract(payload,'$[0].outputFolderPath'));
          PRAGMA user_version=${PROJECT_SCHEMA_VERSION};`);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    db.exec('PRAGMA journal_mode=WAL;');
    return db;
  } catch (error) { db.close(); throw error; }
}
