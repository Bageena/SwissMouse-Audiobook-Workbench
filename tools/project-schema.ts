import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/** SQLite schema version, independent of the project change-feed revision. */
export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_MAX_SCHEMA = 2;

function version(db: DatabaseSync) { return Number(db.prepare('PRAGMA user_version').get()!.user_version); }
function supported(value: number) {
  if (value < 0 || value > PROJECT_MAX_SCHEMA) throw new Error(
    `This library uses project database schema ${value}; this SwissMouse supports up to ${PROJECT_MAX_SCHEMA}. ` +
    'Open it with the same or a newer compatible SwissMouse version. Keep this installation intact; do not delete its database or replace it with an empty library.');
}

export function openProjectDatabase(file: string, warning: (message: string) => void = () => {}) {
  if (process.env.SWISSMOUSE_INFORMATION_DIRECTORY === '1' && process.env.SWISSMOUSE_INFORMATION_DURABLE !== '1') throw new Error('Shared directory requires durable information.');
  // Refuse future formats before enabling WAL, creating tables or writing anything.
  if (fs.existsSync(file)) {
    const probe = new DatabaseSync(file, { readOnly: true });
    try {
      supported(version(probe));
      if (version(probe) === 2) {
        const columns = probe.prepare('PRAGMA table_info(project_selection_outbox)').all().map(row=>String(row.name));
        if (!columns.includes('receipt') || !columns.includes('payload')) throw new Error('Missing or damaged authoritative selection outbox. Restore a compatible store set.');
      }
    } finally { probe.close(); }
  }
  const db = new DatabaseSync(file);
  try {
    const target = process.env.SWISSMOUSE_INFORMATION_DIRECTORY === '1' ? 2 : PROJECT_SCHEMA_VERSION;
    db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
    const current = version(db); supported(current);
    if (current < target) {
      let snapshotVersion: unknown;
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
        snapshotVersion = db.prepare('PRAGMA data_version').get()!.data_version;
        db.prepare('VACUUM INTO ?').run(recovery);
        const fd = fs.openSync(recovery, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        const copied = new DatabaseSync(recovery,{readOnly:true});
        try { if (version(copied)!==current || copied.prepare('PRAGMA quick_check').get()!.quick_check!=='ok' || copied.prepare('SELECT count(*) n FROM project_state').get()!.n!==db.prepare('SELECT count(*) n FROM project_state').get()!.n) throw new Error('Project recovery snapshot verification failed.'); }
        finally { copied.close(); }
        if (db.prepare('PRAGMA data_version').get()!.data_version!==snapshotVersion) throw new Error('Project data changed while snapshotting; stop other writers and retry.');
        if (target === 2) {
          const hash = createHash('sha256'), buffer=Buffer.alloc(1024*1024), handle=fs.openSync(recovery,'r');
          try {let bytes:number;while((bytes=fs.readSync(handle,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,bytes));}finally{fs.closeSync(handle);}
          const manifest={format:'swissmouse.project-selection-recovery',source:file,backup:recovery,sourceSchema:current,targetSchema:target,sha256:hash.digest('hex'),projectVersion:db.prepare("SELECT value FROM project_meta WHERE key='version'").get()?.value,assets:'Preserve jobs.json.assets and a compatible complete store set separately.'};
          fs.writeFileSync(recovery+'.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
          const mf=fs.openSync(recovery+'.json','r+');try{fs.fsyncSync(mf);}finally{fs.closeSync(mf);}
        }
        warning(`Project schema recovery snapshot saved: ${recovery}. Keep jobs.json.assets with this snapshot.`);
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        supported(version(db));
        if (version(db)!==current || snapshotVersion!==undefined && db.prepare('PRAGMA data_version').get()!.data_version!==snapshotVersion) throw new Error('Project schema/data changed after its snapshot.');
        db.exec(`CREATE TABLE IF NOT EXISTS project_state(id TEXT PRIMARY KEY, payload TEXT NOT NULL, previous TEXT, version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
          CREATE INDEX IF NOT EXISTS project_changes ON project_state(version,id);
          CREATE TABLE IF NOT EXISTS project_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
          INSERT OR IGNORE INTO project_meta VALUES('version',0);
          CREATE INDEX IF NOT EXISTS project_logical_groups ON project_state(deleted,coalesce(json_extract(payload,'$[0].logicalBookId'),id));
          CREATE INDEX IF NOT EXISTS project_output_roots ON project_state(deleted,json_extract(payload,'$[0].outputFolderPath'));
          ${target === 2 ? 'CREATE TABLE project_selection_outbox(receipt TEXT PRIMARY KEY,payload TEXT NOT NULL);' : ''}
          PRAGMA user_version=${target};`);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    if (version(db) === 2 && !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_selection_outbox'").get()) throw new Error('Missing authoritative selection outbox. Restore a compatible store set.');
    db.exec('PRAGMA journal_mode=WAL;');
    return db;
  } catch (error) { db.close(); throw error; }
}
