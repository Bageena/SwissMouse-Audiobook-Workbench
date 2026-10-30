import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { InformationProvider, InformationReadItem } from '../information';
import type { Suggestion, SuggestionRequest } from '../suggestions';
import { InformationHistory, equalityKey, searchKey, valueKey, prefixEnd } from './information-history';
import type { InformationStore } from './information-store';
import type { RetainedTerm } from './information-terms';
export interface DirectoryRule {
    providerId: string;
    contextFieldIds?: readonly string[];
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = (text: string) => '"' + text.replaceAll('"', '""') + '"';
/** Generic derived directory. No module payload reads, file probes or SQL supplied by extensions. */
export class InformationDirectory {
    readonly history: InformationHistory;
    private providers: InformationProvider[];
    constructor(readonly db: DatabaseSync, readonly store: InformationStore, readonly rules: readonly DirectoryRule[] = []) {
        this.history = new InformationHistory(store);
        this.providers = store.definitions().filter((d): d is InformationProvider => d.definition === 'provider');
        const tables = ['directory_entries', 'directory_observations', 'directory_resource_context', 'directory_links', 'directory_associations', 'directory_state', 'directory_search'];
        const existing = tables.filter(table => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
        if (existing.length && (existing.length !== tables.length || !db.prepare('SELECT 1 FROM directory_state WHERE id=1').get()))
            throw new Error('Incomplete suggestion index; review and rebuild all derived directory tables.');
        db.exec(`CREATE TABLE IF NOT EXISTS directory_entries(id INTEGER PRIMARY KEY AUTOINCREMENT,key TEXT UNIQUE NOT NULL,provider TEXT NOT NULL,field TEXT NOT NULL,scope TEXT NOT NULL,value TEXT NOT NULL,label TEXT NOT NULL,kind TEXT NOT NULL,search TEXT NOT NULL,observations INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS directory_prefix ON directory_entries(provider,field,search,key);
      CREATE TABLE IF NOT EXISTS directory_observations(resource_id TEXT,key TEXT,PRIMARY KEY(resource_id,key));
      CREATE TABLE IF NOT EXISTS directory_resource_context(resource_id TEXT,context TEXT,PRIMARY KEY(resource_id,context));
      CREATE TABLE IF NOT EXISTS directory_links(resource_id TEXT,context TEXT,key TEXT,PRIMARY KEY(resource_id,context,key));
      CREATE TABLE IF NOT EXISTS directory_associations(context TEXT,key TEXT,uses INTEGER NOT NULL,PRIMARY KEY(context,key));
      CREATE TABLE IF NOT EXISTS directory_state(id INTEGER PRIMARY KEY,checkpoint INTEGER NOT NULL,chain TEXT NOT NULL,terms INTEGER NOT NULL,configuration TEXT NOT NULL,term_chain TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS directory_search USING fts5(scope,search,content='directory_entries',content_rowid='id',tokenize='trigram case_sensitive 1');
      CREATE TRIGGER IF NOT EXISTS directory_insert AFTER INSERT ON directory_entries BEGIN INSERT INTO directory_search(rowid,scope,search) VALUES(new.id,new.scope,new.search); END;
      CREATE TRIGGER IF NOT EXISTS directory_delete AFTER DELETE ON directory_entries BEGIN INSERT INTO directory_search(directory_search,rowid,scope,search) VALUES('delete',old.id,old.scope,old.search); END;
      CREATE TRIGGER IF NOT EXISTS directory_update AFTER UPDATE ON directory_entries BEGIN INSERT INTO directory_search(directory_search,rowid,scope,search) VALUES('delete',old.id,old.scope,old.search); INSERT INTO directory_search(rowid,scope,search) VALUES(new.id,new.scope,new.search); END;`);
        const configuration = digest([1, this.providers, rules]);
        db.prepare('INSERT OR IGNORE INTO directory_state VALUES(1,0,\'\',0,?,\'\')').run(configuration);
        if (db.prepare('SELECT configuration FROM directory_state WHERE id=1').get()?.configuration !== configuration)
            throw new Error('Suggestion definitions or normalization changed; review and rebuild the directory.');
    }
    private scope(p: InformationProvider) { return digest([p.id, p.fieldId]); }
    private put(p: InformationProvider, value: string, label: string, kind: Suggestion['valueKind']) {
        const key = valueKey(p.id, p.fieldId, value, kind);
        this.db.prepare(`INSERT INTO directory_entries(key,provider,field,scope,value,label,kind,search,observations) VALUES(?,?,?,?,?,?,?,?,0) ON CONFLICT(key) DO UPDATE SET value=excluded.value,label=excluded.label,search=excluded.search`).run(key, p.id, p.fieldId, this.scope(p), value, label, kind, searchKey(label));
        return key;
    }
    private project(item: InformationReadItem) {
        const id = item.descriptor.id;
        for (const row of this.db.prepare('SELECT context,key FROM directory_links WHERE resource_id=?').all(id)) {
            this.db.prepare('UPDATE directory_associations SET uses=uses-1 WHERE context=? AND key=?').run(row.context, row.key);
            this.db.prepare('DELETE FROM directory_associations WHERE context=? AND key=? AND uses<=0').run(row.context, row.key);
        }
        const oldKeys = this.db.prepare('SELECT key FROM directory_observations WHERE resource_id=?').all(id);
        for (const row of oldKeys)
            this.db.prepare('UPDATE directory_entries SET observations=observations-1 WHERE key=?').run(row.key);
        for (const table of ['directory_observations', 'directory_resource_context', 'directory_links'])
            this.db.prepare(`DELETE FROM ${table} WHERE resource_id=?`).run(id);
        if (!item.descriptor.archived)
            for (const p of this.providers.filter(p => p.valueKind === 'text')) {
                const raw = item.fields[p.fieldId], values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
                const contextFields = this.rules.find(rule => rule.providerId === p.id)?.contextFieldIds || [];
                const contexts = new Set<string>();
                for (const field of contextFields) {
                    const rawContext = item.fields[field];
                    for (const value of Array.isArray(rawContext) ? rawContext : typeof rawContext === 'string' ? [rawContext] : [])
                        if (value.trim())
                            contexts.add(field + ':' + equalityKey(value));
                }
                if (contexts.size > 32)
                    throw new Error('Too many suggestion contexts on one resource.');
                for (const context of contexts)
                    this.db.prepare('INSERT OR IGNORE INTO directory_resource_context VALUES(?,?)').run(id, context);
                for (const value of new Map(values.filter(v => v.trim()).map(v => [equalityKey(v), v])).values()) {
                    const key = this.put(p, value, value, 'text');
                    if (this.db.prepare('INSERT OR IGNORE INTO directory_observations VALUES(?,?)').run(id, key).changes)
                        this.db.prepare('UPDATE directory_entries SET observations=observations+1 WHERE key=?').run(key);
                    for (const context of contexts) {
                        this.db.prepare('INSERT INTO directory_links VALUES(?,?,?)').run(id, context, key);
                        this.db.prepare('INSERT INTO directory_associations VALUES(?,?,1) ON CONFLICT(context,key) DO UPDATE SET uses=uses+1').run(context, key);
                    }
                }
            }
        for (const row of oldKeys)
            this.db.prepare('DELETE FROM directory_entries WHERE key=? AND observations<=0').run(row.key);
    }
    private term(term: RetainedTerm) {
        for (const p of this.providers.filter(p => p.valueKind === 'term' && p.taxonomyId === term.taxonomy)) {
            const key = valueKey(p.id, p.fieldId, term.id, 'term');
            if (term.retired)
                this.db.prepare('DELETE FROM directory_entries WHERE key=?').run(key);
            else {
                this.put(p, term.id, term.label, 'term');
                this.db.prepare('UPDATE directory_entries SET observations=1 WHERE key=?').run(key);
            }
        }
    }
    advance(limit = 100) {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw new Error('Invalid directory replay bound.');
        const state = this.db.prepare('SELECT * FROM directory_state WHERE id=1').get()!;
        if (Number(state.terms) && this.store.db.prepare('SELECT chain FROM information_term_changes WHERE seq=?').get(state.terms)?.chain !== state.term_chain)
            throw new Error('Term source history differs; review and rebuild the derived directory.');
        if (this.store.changeHash(Number(state.checkpoint)) !== state.chain)
            throw new Error('Directory source history differs; review and rebuild the derived directory.');
        const changes = this.store.changes(Number(state.checkpoint), limit), terms = this.store.db.prepare('SELECT seq,payload,chain FROM information_term_changes WHERE seq>? ORDER BY seq LIMIT ?').all(state.terms, limit);
        this.db.exec('BEGIN IMMEDIATE');
        try {
            for (const change of changes)
                this.project(change.item);
            for (const row of terms)
                this.term(JSON.parse(String(row.payload)));
            if (changes.length)
                this.db.prepare('UPDATE directory_state SET checkpoint=?,chain=? WHERE id=1').run(changes.at(-1)!.seq, changes.at(-1)!.chain);
            if (terms.length)
                this.db.prepare('UPDATE directory_state SET terms=?,term_chain=? WHERE id=1').run(terms.at(-1)!.seq, terms.at(-1)!.chain);
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        return { pending: !!this.store.changes(Number(this.db.prepare('SELECT checkpoint FROM directory_state WHERE id=1').get()!.checkpoint), 1).length || !!this.store.db.prepare('SELECT 1 FROM information_term_changes WHERE seq>? LIMIT 1').get(this.db.prepare('SELECT terms FROM directory_state WHERE id=1').get()!.terms) };
    }
    query(input: SuggestionRequest) {
        if (!input || Object.keys(input).some(k => !['providerId', 'fieldId', 'query', 'limit', 'cursor', 'contextResourceIds', 'selectedKeys'].includes(k)))
            throw new Error('Unsupported suggestion parameter.');
        const p = this.providers.find(p => p.id === input.providerId && p.fieldId === input.fieldId), limit = input.limit ?? p?.defaultLimit ?? 20;
        if (!p || p.valueKind === 'resource' || typeof input.query !== 'string' || input.query.length > 256 || !Number.isSafeInteger(limit) || limit < 1 || limit > p.maxLimit || (input.contextResourceIds && (!Array.isArray(input.contextResourceIds) || input.contextResourceIds.length > 8 || input.contextResourceIds.some(id => typeof id !== 'string' || id.length > 200))) || (input.selectedKeys && (!Array.isArray(input.selectedKeys) || input.selectedKeys.length > 32 || input.selectedKeys.some(key => typeof key !== 'string' || key.length > 300))))
            throw new Error('Invalid or unsupported suggestion request.');
        const state = this.db.prepare('SELECT * FROM directory_state WHERE id=1').get()!;
        if (Number(state.terms) && this.store.db.prepare('SELECT chain FROM information_term_changes WHERE seq=?').get(state.terms)?.chain !== state.term_chain)
            throw new Error('Term source history differs; review and rebuild the derived directory.');
        if (this.store.changeHash(Number(state.checkpoint)) !== state.chain)
            throw new Error('Directory source history differs; review and rebuild.');
        const recent = this.history.recent(p.id, p.fieldId).flatMap(row => {
            if (row.kind !== 'term')
                return [row];
            const term = this.store.db.prepare('SELECT label FROM information_terms WHERE id=? AND retired=0').get(row.value);
            return term ? [{ ...row, label: term.label }] : [];
        }), revision = digest([state, recent]), signature = digest([input.providerId, input.fieldId, input.query, input.contextResourceIds, input.selectedKeys, limit]);
        let cursor: any = { phase: 0, search: '', key: '', rowid: 0, offset: 0 };
        if (input.cursor) {
            if (typeof input.cursor !== 'string' || input.cursor.length > 5000)
                throw new Error('Invalid suggestion cursor.');
            cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString());
            if (cursor.revision !== revision || cursor.signature !== signature)
                throw new Error('Suggestions changed; restart this query.');
            if (![0, 1, 2].includes(cursor.phase) || typeof cursor.search !== 'string' || typeof cursor.key !== 'string' || !Number.isSafeInteger(cursor.rowid) || cursor.rowid < 0 || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0)
                throw new Error('Invalid suggestion cursor.');
        }
        const query = searchKey(input.query), items: Suggestion[] = [];
        const from = (row: any, reason: Suggestion['reason']): Suggestion => ({ key: String(row.key), label: String(row.label), value: String(row.value), valueKind: (row.kind || row.valueKind) as Suggestion['valueKind'], reason, ...(reason === 'related' ? { detail: 'Observed with matching context metadata; not a confirmed entity identity.' } : {}) });
        if (!query) {
            const candidates = recent.map(row => from(row, 'recent'));
            const seen = new Set(candidates.map(item => item.key));
            const visitedContexts = new Set<string>();
            contexts: for (const id of input.contextResourceIds || [])
                for (const context of this.db.prepare('SELECT context FROM directory_resource_context WHERE resource_id=? LIMIT 32').all(id)) {
                    if (visitedContexts.has(String(context.context)))
                        continue;
                    if (visitedContexts.size >= 32)
                        break contexts;
                    visitedContexts.add(String(context.context));
                    for (const row of this.db.prepare('SELECT e.* FROM directory_associations a JOIN directory_entries e ON e.key=a.key WHERE a.context=? AND a.key>=? AND a.key<? AND e.provider=? AND e.field=? AND e.observations>0 ORDER BY a.key LIMIT 101').all(context.context, p.id + ':v1:', p.id + ':v1:\uffff', p.id, p.fieldId)) {
                        if (!seen.has(String(row.key))) {
                            seen.add(String(row.key));
                            candidates.push(from(row, 'related'));
                        }
                        if (candidates.length >= 200)
                            break contexts;
                    }
                }
            const order = new Map(recent.map((row, index) => [String(row.key), index]));
            candidates.sort((a, b) => (order.get(a.key) ?? 1000) - (order.get(b.key) ?? 1000) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
            const selected = new Set(input.selectedKeys || []), available = candidates.filter(item => !selected.has(item.key));
            items.push(...available.slice(cursor.offset, cursor.offset + limit));
            cursor.offset += items.length;
            cursor.phase = cursor.offset < available.length ? 0 : 2;
        }
        else {
            const add = (rows: any[], reason: Suggestion['reason']) => { for (const row of rows) {
                if (items.length >= limit)
                    break;
                items.push(from(row, reason));
                cursor.search = String(row.search);
                cursor.key = String(row.key);
                cursor.rowid = Number(row.id);
            } };
            if (cursor.phase === 0) {
                const rows = this.db.prepare('SELECT * FROM directory_entries WHERE provider=? AND field=? AND observations>0 AND search=? AND (search,key)>(?,?) ORDER BY search,key LIMIT ?').all(p.id, p.fieldId, query, cursor.search, cursor.key, limit + 1);
                add(rows, 'exact');
                if (rows.length <= limit) {
                    cursor.phase = 1;
                    cursor.search = query;
                    cursor.key = '';
                }
            }
            if (cursor.phase === 1 && items.length < limit) {
                if (!p.matching.includes('prefix')) {
                    cursor.phase = 2;
                    cursor.rowid = 0;
                }
            }
            if (cursor.phase === 1 && items.length < limit) {
                const remaining = limit - items.length;
                const upper = prefixEnd(query);
                const rows = this.db.prepare(`SELECT * FROM directory_entries WHERE provider=? AND field=? AND observations>0 AND search>? ${upper === undefined ? '' : 'AND search<?'} AND (search,key)>(?,?) ORDER BY search,key LIMIT ?`).all(p.id, p.fieldId, query, ...(upper === undefined ? [] : [upper]), cursor.search, cursor.key, remaining + 1);
                add(rows, 'prefix');
                if (rows.length <= remaining) {
                    cursor.phase = 2;
                    cursor.rowid = 0;
                }
            }
            if (cursor.phase === 2 && items.length < limit && p.matching.includes('contains') && [...query].length >= Math.max(3, p.minimumContainsLength)) {
                const rows = this.db.prepare(`SELECT e.* FROM directory_search s JOIN directory_entries e ON e.id=s.rowid WHERE directory_search MATCH ? AND s.rowid>? ORDER BY s.rowid LIMIT 201`).all(`scope:${quote(this.scope(p))} AND search:${quote(query)}`, cursor.rowid);
                let scanned = 0;
                for (const row of rows) {
                    if (items.length >= limit)
                        break;
                    cursor.rowid = Number(row.id);
                    scanned++;
                    if (!String(row.search).startsWith(query) && Number(row.observations) > 0)
                        items.push(from(row, 'match'));
                }
                if (rows.length < 201 && scanned === rows.length)
                    cursor.phase = 3;
            }
            else if (cursor.phase === 2 && items.length < limit)
                cursor.phase = 3;
        }
        const selected = (input.selectedKeys || []).map(key => this.db.prepare('SELECT * FROM directory_entries WHERE key=? AND provider=? AND field=?').get(key, p.id, p.fieldId) || recent.find(row => row.key === key)).filter(Boolean).map(row => from(row, 'recent'));
        const more = query ? cursor.phase < 3 : cursor.phase < 2;
        return { items, selected, nextCursor: more ? Buffer.from(JSON.stringify({ ...cursor, revision, signature })).toString('base64url') : undefined, checkpoint: Number(state.checkpoint), indexing: !!this.store.db.prepare('SELECT 1 FROM information_changes WHERE seq>? LIMIT 1').get(state.checkpoint) || !!this.store.db.prepare('SELECT 1 FROM information_term_changes WHERE seq>? LIMIT 1').get(state.terms) };
    }
}
