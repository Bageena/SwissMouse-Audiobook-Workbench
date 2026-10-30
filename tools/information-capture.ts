import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { InformationReadItem } from '../packages/sdk/information';
import type { InformationPublication } from '../packages/sdk/information-publication';
import { coreInformationBundle } from '../src/core/information-builtins';
import { audiobookInformationBundle, audiobookInformationItem } from '../packages/audiobooks/src/information';
import { InformationStore } from './information-store';
import { InformationProjection } from './information-projection';
export function inspectInformationCapture(file: string) {
    if (file === ':memory:' || !fs.existsSync(file))
        return;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
        if (Number(db.prepare('PRAGMA user_version').get()!.user_version) > 1)
            throw new Error('Unsupported catalog schema.');
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='information_origin' AND type='table'").get() && db.prepare('SELECT schema_version FROM information_origin WHERE id=1').get()?.schema_version !== 1)
            throw new Error('Unsupported information capture schema.');
    }
    finally {
        db.close();
    }
}
/** Legacy adapter boundary. Main-DB outbox survives a crash between source commit and user-DB ack. */
export class InformationCapture {
    readonly sourceId = 'audiobooks.catalog';
    readonly epoch: string;
    readonly projection: InformationProjection;
    error?: string;
    constructor(readonly db: DatabaseSync, readonly store: InformationStore) {
        store.registerDefinitions([coreInformationBundle, audiobookInformationBundle]);
        const existed = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='information_origin' AND type='table'").get();
        db.exec('BEGIN IMMEDIATE');
        try {
            db.exec(`CREATE TABLE IF NOT EXISTS information_origin(id INTEGER PRIMARY KEY,epoch TEXT NOT NULL,last_ack INTEGER NOT NULL,schema_version INTEGER NOT NULL,seeded INTEGER NOT NULL,ack_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS information_dirty(resource_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS information_outbox(version INTEGER PRIMARY KEY AUTOINCREMENT,resource_id TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS information_outbox_resource ON information_outbox(resource_id,version);`);
            if (!existed)
                db.prepare("INSERT INTO information_origin VALUES(1,?,0,1,0,'')").run(randomUUID());
            db.exec('COMMIT');
        }
        catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        this.epoch = String(db.prepare('SELECT epoch FROM information_origin WHERE id=1').get()!.epoch);
        const old = store.source(this.sourceId);
        const unused = Number(db.prepare('SELECT last_ack FROM information_origin WHERE id=1').get()!.last_ack) === 0 && !db.prepare('SELECT 1 FROM information_outbox LIMIT 1').get();
        const knownEpoch = store.db.prepare('SELECT 1 FROM information_epochs WHERE source_id=? AND epoch=?').get(this.sourceId, this.epoch);
        if (!existed || (!knownEpoch && unused))
            store.startEpoch(this.sourceId, 'audiobooks', this.epoch, old ? String(old.epoch) : undefined);
        else if (old?.epoch !== this.epoch)
            throw new Error('Information source epoch mismatch; restore a consistent store set or review an explicit index rebuild.');
        const source = store.source(this.sourceId)!;
        const acknowledged = Number(db.prepare('SELECT last_ack FROM information_origin WHERE id=1').get()!.last_ack);
        const last = Number(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='information_outbox'").get()?.seq || 0);
        if (Number(source.checkpoint) < acknowledged || Number(source.checkpoint) > last)
            throw new Error('Information checkpoints disagree; a reviewed epoch reconciliation is required.');
        if (acknowledged && store.db.prepare('SELECT hash FROM information_receipts WHERE source_id=? AND epoch=? AND version=?').get(this.sourceId, this.epoch, acknowledged)?.hash !== db.prepare('SELECT ack_hash FROM information_origin WHERE id=1').get()!.ack_hash)
            throw new Error('Information acknowledgement history disagrees; review the restored store set.');
        for (const [table, columns] of Object.entries({ resources: ['id'], library: ['resource_id'], files: ['resource_id'], relations: ['from_id', 'to_id'] })) {
            for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
                const row = operation === 'DELETE' ? 'OLD' : 'NEW';
                db.exec(`CREATE TRIGGER IF NOT EXISTS information_${table}_${operation} AFTER ${operation} ON ${table} BEGIN ${columns.map(column => `INSERT OR IGNORE INTO information_dirty VALUES(${row}.${column});`).join(' ')} END;`);
            }
        }
        if (!db.prepare('SELECT seeded FROM information_origin WHERE id=1').get()!.seeded) {
            db.exec('BEGIN IMMEDIATE');
            try {
                db.exec('INSERT OR IGNORE INTO information_dirty SELECT id FROM resources; UPDATE information_origin SET seeded=1 WHERE id=1; COMMIT;');
            }
            catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        }
        this.projection = new InformationProjection(db, store);
    }
    private item(resourceId: string): {
        item: InformationReadItem;
        aliases: InformationPublication['aliases'];
    } | undefined {
        const resource = this.db.prepare('SELECT * FROM resources WHERE id=?').get(resourceId);
        if (!resource)
            return;
        const book = this.db.prepare('SELECT payload FROM library WHERE resource_id=?').get(resourceId);
        const pending = this.db.prepare('SELECT payload FROM information_outbox WHERE resource_id=? ORDER BY version DESC LIMIT 1').get(resourceId);
        const previous = pending ? (JSON.parse(String(pending.payload)) as InformationPublication).item : this.store.get(resourceId)?.item;
        const item: InformationReadItem = book ? audiobookInformationItem(JSON.parse(String(book.payload)), 0, { complete: true }) : previous ? JSON.parse(JSON.stringify(previous)) : {
            descriptor: { id: resourceId, kind: resource.kind as any, owner: String(resource.module_id), title: String(resource.title), typeIds: [String(resource.kind), ...(resource.kind === 'core.work' ? ['audiobooks.book'] : resource.kind === 'core.recording' ? ['audiobooks.recording'] : [])], revision: 0, revisionScope: 'catalog-snapshot', archived: !!resource.archived },
            fields: {}, relationships: [], memberships: [], omitted: [],
        };
        item.descriptor = { ...item.descriptor, title: String(resource.title), archived: !!resource.archived };
        item.fields = { ...item.fields, 'core.title': String(resource.title) };
        const file = this.db.prepare('SELECT * FROM files WHERE resource_id=?').get(resourceId);
        if (file)
            item.fields = { ...item.fields, 'core.file-path': String(file.path), ...(file.size_bytes !== null ? { 'core.size-bytes': Number(file.size_bytes) } : {}), ...(file.modified_ms !== null ? { 'core.modified-ms': Number(file.modified_ms) } : {}) };
        const relations = this.db.prepare('SELECT * FROM relations WHERE from_id=? OR to_id=? ORDER BY from_id,to_id,kind LIMIT 10001').all(resourceId, resourceId);
        if (relations.length > 10000)
            throw new Error('Resource relationships exceed publication bound; source data was retained.');
        item.relationships = relations.map(row => ({ fromId: String(row.from_id), toId: String(row.to_id), relationshipId: String(row.kind), ...(row.position !== null ? { position: Number(row.position) } : {}) }));
        const aliases = this.store.db.prepare('SELECT namespace,source_key FROM aliases WHERE resource_id=? ORDER BY namespace,source_key LIMIT 10001').all(resourceId).map(row => ({ namespace: String(row.namespace), key: String(row.source_key) }));
        return { item, aliases };
    }
    advance(limit = 25) {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw new Error('Invalid publication batch bound.');
        try {
            // Capture a coherent snapshot in the source DB; delivery is a separate recoverable transaction.
            this.db.exec('BEGIN IMMEDIATE');
            try {
                for (const row of this.db.prepare('SELECT resource_id FROM information_dirty ORDER BY resource_id LIMIT ?').all(limit)) {
                    const captured = this.item(String(row.resource_id));
                    if (captured) {
                        const version = Number(this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='information_outbox'").get()?.seq || 0) + 1;
                        const event: InformationPublication = { sourceId: this.sourceId, epoch: this.epoch, version, ...captured, retired: captured.item.descriptor.archived };
                        if (Buffer.byteLength(JSON.stringify(event)) > 4 * 1024 * 1024)
                            throw new Error('Complete publication exceeds 4 MiB; source data was retained.');
                        this.db.prepare('INSERT INTO information_outbox(version,resource_id,payload) VALUES(?,?,?)').run(version, captured.item.descriptor.id, JSON.stringify(event));
                    }
                    this.db.prepare('DELETE FROM information_dirty WHERE resource_id=?').run(row.resource_id);
                }
                this.db.exec('COMMIT');
            }
            catch (error) {
                this.db.exec('ROLLBACK');
                throw error;
            }
            // Batch small records into one durable commit, retaining a byte budget for large records.
            const waiting = this.db.prepare('SELECT version,payload FROM information_outbox ORDER BY version LIMIT ?').all(limit);
            while (waiting.length) {
                const batch: typeof waiting = [];
                let bytes = 0;
                while (waiting.length && (!batch.length || bytes + Buffer.byteLength(String(waiting[0].payload)) < 7 * 1024 * 1024)) {
                    const row = waiting.shift()!;
                    bytes += Buffer.byteLength(String(row.payload));
                    batch.push(row);
                }
                this.store.publish(batch.map(row => JSON.parse(String(row.payload))));
                this.db.exec('BEGIN IMMEDIATE');
                try {
                    for (const row of batch)
                        this.db.prepare('DELETE FROM information_outbox WHERE version=?').run(row.version);
                    const last = batch.at(-1)!;
                    const receipt = this.store.db.prepare('SELECT hash FROM information_receipts WHERE source_id=? AND epoch=? AND version=?').get(this.sourceId, this.epoch, last.version)!;
                    this.db.prepare('UPDATE information_origin SET last_ack=?,ack_hash=? WHERE id=1').run(last.version, receipt.hash);
                    this.db.exec('COMMIT');
                }
                catch (error) {
                    this.db.exec('ROLLBACK');
                    throw error;
                }
            }
            this.projection.advance(100);
            this.error = undefined;
        }
        catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        }
        return this.status();
    }
    status() {
        return { enabled: true, epoch: this.epoch, checkpoint: Number(this.store.source(this.sourceId)!.checkpoint), dirty: Number(this.db.prepare('SELECT count(*) n FROM information_dirty').get()!.n), outbox: Number(this.db.prepare('SELECT count(*) n FROM information_outbox').get()!.n),
            projectionCheckpoint: this.projection.checkpoint(), pendingProjection: this.store.changes(this.projection.checkpoint(), 1).length > 0,
            staleRetained: Number(this.store.db.prepare('SELECT count(*) n FROM information_resources WHERE source_id=? AND epoch<>? AND retired=0').get(this.sourceId, this.epoch)!.n), error: this.error };
    }
}
