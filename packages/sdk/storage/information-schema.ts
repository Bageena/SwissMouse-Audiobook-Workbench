import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
export const INFORMATION_USER_SCHEMA = 1;
export const INFORMATION_MAX_SCHEMA = 2;
const legacy = { aliases: ['namespace', 'source_key', 'resource_id'], file_identity: ['path_key', 'resource_id'], collections: ['id', 'name'], collection_members: ['collection_id', 'project_id'], migration: ['done'] };
function version(db: DatabaseSync) { return Number(db.prepare('PRAGMA user_version').get()!.user_version); }
function check(db: DatabaseSync) {
    const current = version(db);
    if (current < 0 || current > INFORMATION_MAX_SCHEMA)
        throw new Error(`Unsupported user database schema ${current}. Keep the database and restore a compatible complete backup; do not delete it.`);
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => String(row.name));
    if (names.length) {
        for (const [name, columns] of Object.entries(legacy)) {
            const found = db.prepare(`PRAGMA table_info(${name})`).all().map(row => String(row.name));
            if (columns.some(column => !found.includes(column)))
                throw new Error('Unrecognized user database layout. Migration was not applied.');
        }
        if (current === 0 && names.some(name => !Object.hasOwn(legacy, name)))
            throw new Error('Unrecognized unversioned user database.');
    }
    else if (current !== 0)
        throw new Error('User schema marker has no corresponding tables.');
    if (current >= 1) {
        const required = { information_sources: ['id', 'owner', 'epoch', 'checkpoint'], information_epochs: ['source_id', 'epoch'], information_definitions: ['id', 'owner', 'version', 'payload'], information_resources: ['id', 'source_id', 'epoch', 'source_version', 'revision', 'retired', 'hash', 'payload'], information_receipts: ['source_id', 'epoch', 'version', 'hash'], information_changes: ['seq', 'resource_id', 'chain', 'payload'] };
        for (const [table, columns] of Object.entries(required)) {
            const found = db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
            if (columns.some(column => !found.includes(column)))
                throw new Error(`Damaged authoritative information table: ${table}`);
        }
    }
    if (current === 2) for (const [table, columns] of Object.entries({information_history:['profile','provider','field','key','label','value','kind','used_at','uses','contexts'], information_history_receipts:['receipt','hash'], information_terms:['id','taxonomy','owner','label','parent','revision','retired'], information_term_changes:['seq','payload','chain']})) {
        const found = db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
        if (columns.some(column => !found.includes(column))) throw new Error(`Damaged authoritative directory table: ${table}`);
    }
    return current;
}
/** Must run before opening/mutating the catalog: its attached user DB is authoritative. */
export function inspectInformationUserFile(file: string) {
    if (file === ':memory:' || !fs.existsSync(file))
        return 0;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
        return check(db);
    }
    finally {
        db.close();
    }
}
/** No automatic restore. Retain verified pre-migration snapshots and a manifest for review. */
export function openInformationUserDatabase(file: string, warning: (message: string) => void = () => { }, companions: readonly string[] = []) {
    const target = process.env.SWISSMOUSE_INFORMATION_DIRECTORY === '1' ? 2 : INFORMATION_USER_SCHEMA;
    inspectInformationUserFile(file);
    for (const other of companions.filter(other => fs.existsSync(other))) {
        const probe = new DatabaseSync(other, { readOnly: true });
        try {
            if (version(probe) > 2)
                throw new Error(`Unsupported companion schema: ${other}`);
        }
        finally {
            probe.close();
        }
    }
    if (file !== ':memory:')
        fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    try {
        db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
        const current = check(db);
        let snapshotVersion: unknown;
        if (current < target) {
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
            if (tables.length && file !== ':memory:') {
                if (db.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok')
                    throw new Error('User database integrity check failed.');
                const counts = Object.fromEntries(Object.keys(legacy).map(name => [name, Number(db.prepare(`SELECT count(*) n FROM ${name}`).get()!.n)]));
                const backup = `${file}.schema-${current}-${randomUUID()}.bak`;
                const liveVersion = db.prepare('PRAGMA data_version').get()!.data_version;
                const companionDbs = companions.filter(other => fs.existsSync(other)).map(other => ({ file: other, db: new DatabaseSync(other, { readOnly: true }) }));
                const versions = companionDbs.map(other => other.db.prepare('PRAGMA data_version').get()!.data_version);
                const sha256 = (target: string) => {
                    const digest = createHash('sha256'), fd = fs.openSync(target, 'r'), buffer = Buffer.alloc(1024 * 1024);
                    try {
                        let size: number;
                        while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)))
                            digest.update(buffer.subarray(0, size));
                    }
                    finally {
                        fs.closeSync(fd);
                    }
                    return digest.digest('hex');
                };
                const companionSnapshots: {
                    source: string;
                    backup: string;
                    schema: number;
                    sha256: string;
                    watermarks: Record<string, number>;
                }[] = [];
                try {
                    for (const other of companionDbs) {
                        const target = `${other.file}.information-${randomUUID()}.bak`;
                        other.db.prepare('VACUUM INTO ?').run(target);
                        const handle = fs.openSync(target, 'r+');
                        try {
                            fs.fsyncSync(handle);
                        }
                        finally {
                            fs.closeSync(handle);
                        }
                        const copied = new DatabaseSync(target, { readOnly: true });
                        try {
                            if (copied.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok' || version(copied) !== version(other.db))
                                throw new Error(`Companion snapshot verification failed: ${target}`);
                        }
                        finally {
                            copied.close();
                        }
                        const watermarks: Record<string, number> = {};
                        if (other.db.prepare("SELECT 1 FROM sqlite_master WHERE name='project_meta' AND type='table'").get())
                            watermarks.projectVersion = Number(other.db.prepare("SELECT value FROM project_meta WHERE key='version'").get()?.value || 0);
                        if (other.db.prepare("SELECT 1 FROM sqlite_master WHERE name='state' AND type='table'").get())
                            for (const key of ['revision', 'project_checkpoint'])
                                watermarks[key] = Number(other.db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value || 0);
                        companionSnapshots.push({ source: other.file, backup: target, schema: version(other.db), sha256: sha256(target), watermarks });
                    }
                    db.prepare('VACUUM INTO ?').run(backup);
                    const fd = fs.openSync(backup, 'r+');
                    try {
                        fs.fsyncSync(fd);
                    }
                    finally {
                        fs.closeSync(fd);
                    }
                    const probe = new DatabaseSync(backup, { readOnly: true });
                    try {
                        if (check(probe) !== current || probe.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok')
                            throw new Error(`Recovery snapshot verification failed: ${backup}`);
                        for (const [name, count] of Object.entries(counts))
                            if (Number(probe.prepare(`SELECT count(*) n FROM ${name}`).get()!.n) !== count)
                                throw new Error(`Recovery snapshot count mismatch: ${backup}`);
                    }
                    finally {
                        probe.close();
                    }
                    if (db.prepare('PRAGMA data_version').get()!.data_version !== liveVersion || companionDbs.some((other, i) => other.db.prepare('PRAGMA data_version').get()!.data_version !== versions[i]))
                        throw new Error('Stores changed while creating recovery snapshots. Stop other writers and retry; no user migration was applied.');
                    const manifest = { format: 'swissmouse.information-recovery', source: file, backup, sha256: sha256(backup), companions: companionSnapshots, sourceSchema: current, targetSchema: target, createdAt: new Date().toISOString(), counts, note: 'Quiesce the application and restore a compatible complete store set, including assets. These coordinated database snapshots are not an automatic downgrade.' };
                    const manifestFile = backup + '.json';
                    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
                    const manifestFd = fs.openSync(manifestFile, 'r+');
                    try {
                        fs.fsyncSync(manifestFd);
                    }
                    finally {
                        fs.closeSync(manifestFd);
                    }
                    warning(`Verified user database recovery snapshot: ${backup}`);
                    snapshotVersion = liveVersion;
                }
                finally {
                    for (const other of companionDbs)
                        other.db.close();
                }
            }
            db.exec('BEGIN IMMEDIATE');
            try {
                if (check(db) !== current)
                    throw new Error('User schema changed during migration.');
                if (snapshotVersion !== undefined && db.prepare('PRAGMA data_version').get()!.data_version !== snapshotVersion)
                    throw new Error('User data changed after its recovery snapshot. Stop other writers and retry.');
                db.exec(`CREATE TABLE IF NOT EXISTS aliases(namespace TEXT,source_key TEXT,resource_id TEXT,PRIMARY KEY(namespace,source_key));
          CREATE TABLE IF NOT EXISTS file_identity(path_key TEXT PRIMARY KEY,resource_id TEXT);
          CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,name TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS collection_members(collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,project_id TEXT,PRIMARY KEY(collection_id,project_id));
          CREATE TABLE IF NOT EXISTS migration(done INTEGER PRIMARY KEY);
          CREATE INDEX IF NOT EXISTS information_alias_resource ON aliases(resource_id);
          CREATE TABLE IF NOT EXISTS information_sources(id TEXT PRIMARY KEY,owner TEXT NOT NULL,epoch TEXT NOT NULL,checkpoint INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS information_epochs(source_id TEXT NOT NULL,epoch TEXT NOT NULL,PRIMARY KEY(source_id,epoch));
          CREATE TABLE IF NOT EXISTS information_definitions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS information_resources(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,epoch TEXT NOT NULL,source_version INTEGER NOT NULL,revision INTEGER NOT NULL,retired INTEGER NOT NULL,hash TEXT NOT NULL,payload TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS information_resource_source ON information_resources(source_id,id);
          CREATE TABLE IF NOT EXISTS information_receipts(source_id TEXT NOT NULL,epoch TEXT NOT NULL,version INTEGER NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(source_id,epoch,version));
          CREATE TABLE IF NOT EXISTS information_changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,resource_id TEXT NOT NULL,chain TEXT NOT NULL,payload TEXT NOT NULL);
          ${target === 2 ? `
          CREATE TABLE information_history(profile TEXT,provider TEXT,field TEXT,key TEXT,label TEXT NOT NULL,value TEXT NOT NULL,kind TEXT NOT NULL,used_at INTEGER NOT NULL,uses INTEGER NOT NULL,contexts TEXT NOT NULL,PRIMARY KEY(profile,provider,field,key));
          CREATE INDEX information_history_recent ON information_history(profile,provider,field,used_at DESC,key);
          CREATE INDEX information_history_profile ON information_history(profile,used_at DESC,key);
          CREATE TABLE information_history_receipts(receipt TEXT PRIMARY KEY,hash TEXT NOT NULL);
          CREATE TABLE information_terms(id TEXT PRIMARY KEY,taxonomy TEXT NOT NULL,owner TEXT NOT NULL,label TEXT NOT NULL,parent TEXT,revision INTEGER NOT NULL,retired INTEGER NOT NULL);
          CREATE INDEX information_term_parent ON information_terms(parent,id);
          CREATE TABLE information_term_changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL,chain TEXT NOT NULL);
          ` : ''}
          PRAGMA user_version=${target};`);
                db.exec('COMMIT');
            }
            catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        }
        // Refuse damaged current schemas; do not recreate missing authoritative tables.
        for (const table of ['information_sources', 'information_epochs', 'information_definitions', 'information_resources', 'information_receipts', 'information_changes']) {
            if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
                throw new Error(`Missing authoritative information table: ${table}`);
        }
        db.exec('PRAGMA journal_mode=WAL;');
        return db;
    }
    catch (error) {
        db.close();
        throw error;
    }
}
