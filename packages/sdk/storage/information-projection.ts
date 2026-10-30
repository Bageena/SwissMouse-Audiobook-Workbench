import type { DatabaseSync } from 'node:sqlite';
import type { InformationReadItem } from '../information';
import type { InformationStore } from './information-store';
/** Rebuildable generic index. Uses only durable Core publications, never a module adapter. */
export class InformationProjection {
    constructor(readonly db: DatabaseSync, readonly source: InformationStore) {
        const tables = ['information_index', 'information_index_state'];
        const present = tables.filter(name => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
        if (present.length && (present.length !== tables.length || !db.prepare('SELECT 1 FROM information_index_state WHERE id=1').get()))
            throw new Error('Incomplete information projection. Review and reset both derived projection tables together; retain the authoritative store.');
        db.exec(`CREATE TABLE IF NOT EXISTS information_index(id TEXT PRIMARY KEY,title TEXT NOT NULL,owner TEXT NOT NULL,kind TEXT NOT NULL,retired INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS information_index_title ON information_index(retired,title,id);
      CREATE TABLE IF NOT EXISTS information_index_state(id INTEGER PRIMARY KEY,checkpoint INTEGER NOT NULL,chain TEXT NOT NULL);
      INSERT OR IGNORE INTO information_index_state VALUES(1,0,'');`);
    }
    checkpoint() { return Number(this.db.prepare('SELECT checkpoint FROM information_index_state WHERE id=1').get()!.checkpoint); }
    assertSource() { if (this.source.changeHash(this.checkpoint()) !== this.db.prepare('SELECT chain FROM information_index_state WHERE id=1').get()!.chain)
        throw new Error('Information projection checkpoint does not match the durable store. Reset this derived projection after reviewing the restore.'); }
    reset() { this.db.exec('BEGIN IMMEDIATE'); try {
        this.db.exec("DELETE FROM information_index; UPDATE information_index_state SET checkpoint=0,chain=''; COMMIT;");
    }
    catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
    } }
    advance(limit = 100) {
        this.assertSource();
        const rows = this.source.changes(this.checkpoint(), limit);
        this.db.exec('BEGIN IMMEDIATE');
        try {
            for (const row of rows) {
                const d = row.item.descriptor;
                this.db.prepare('INSERT INTO information_index VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,owner=excluded.owner,kind=excluded.kind,retired=excluded.retired,payload=excluded.payload')
                    .run(d.id, d.title, d.owner, d.kind, Number(d.archived), JSON.stringify(row.item));
            }
            if (rows.length)
                this.db.prepare('UPDATE information_index_state SET checkpoint=?,chain=? WHERE id=1').run(rows.at(-1)!.seq, rows.at(-1)!.chain);
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        return { applied: rows.length, checkpoint: this.checkpoint(), pending: this.source.changes(this.checkpoint(), 1).length > 0 };
    }
    page(input: {
        limit?: number;
        cursor?: string;
        includeRetired?: boolean;
    } = {}) {
        this.assertSource();
        const limit = input.limit ?? 50, checkpoint = this.checkpoint();
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
            throw new Error('Invalid information page bound.');
        let cursor: {
            checkpoint: number;
            retired: boolean;
            title: string;
            id: string;
        } | undefined;
        if (input.cursor) {
            if (input.cursor.length > 20000)
                throw new Error('Invalid information cursor.');
            cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
            if (cursor.checkpoint !== checkpoint || cursor.retired !== !!input.includeRetired)
                throw new Error('Information index changed; restart this query.');
            if (typeof cursor.title !== 'string' || typeof cursor.id !== 'string')
                throw new Error('Invalid information cursor.');
        }
        const where = input.includeRetired ? '1' : 'retired=0';
        const rows = this.db.prepare(`SELECT * FROM information_index WHERE ${where}${cursor ? ' AND (title,id)>(?,?)' : ''} ORDER BY title,id LIMIT ?`).all(...(cursor ? [cursor.title, cursor.id] : []), limit + 1);
        const more = rows.length > limit;
        if (more)
            rows.pop();
        const last = rows.at(-1);
        return { items: rows.map(row => JSON.parse(String(row.payload)) as InformationReadItem), checkpoint,
            nextCursor: more && last ? Buffer.from(JSON.stringify({ checkpoint, retired: !!input.includeRetired, title: last.title, id: last.id })).toString('base64url') : undefined };
    }
}
