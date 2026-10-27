import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { catalogSortKey, catalogSorts, normalizeCatalogText, type CatalogQuery, type CatalogPage, type CatalogCollection, type CatalogSelection } from '../src/core/catalog';
import type { ResourceSummary, ResourcePage } from '../src/core/resources';
import type { LibraryBook } from '../src/types';
import type { CatalogProject } from './catalog-projection';
import { observeCatalogProject } from './catalog-availability';
import { findBookMatches, matchCandidateKeys, pairKey } from './library-matches';

export function resourceId(namespace: string, key: string) {
  return `res_${createHash('sha256').update(JSON.stringify([namespace, key])).digest('hex').slice(0, 32)}`;
}
const fileKey = (file: string) => process.platform === 'win32' ? path.resolve(file).replaceAll('\\', '/').toLowerCase() : path.resolve(file);
const boundedInt = (value: unknown, fallback: number, max: number) => value === undefined ? fallback : Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max ? Number(value) : (() => { throw new Error(`Expected an integer between 0 and ${max}.`); })();
const decode = (value: string) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const orderColumns = Object.fromEntries(catalogSorts.map(sort => [sort, `sort_${sort}`]));

/** All heavy work runs in the catalog worker. The database never opens or edits media files. */
export class CatalogStore {
  readonly db: DatabaseSync;
  private statements = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  private counts = new Map<string, number>();
  constructor(readonly file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
    if (version > 1) { this.db.close(); throw new Error('This catalog was created by a newer SwissMouse version.'); }
    if (!version) this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE state(key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT INTO state VALUES('revision',0),('generation',0);
      CREATE TABLE resources(id TEXT PRIMARY KEY, kind TEXT NOT NULL, module_id TEXT NOT NULL, title TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX resources_kind ON resources(kind,archived,title,id);
      CREATE INDEX resources_title ON resources(archived,title,id);
      CREATE TABLE aliases(namespace TEXT NOT NULL, source_key TEXT NOT NULL, resource_id TEXT NOT NULL REFERENCES resources(id), PRIMARY KEY(namespace,source_key));
      CREATE INDEX aliases_resource ON aliases(resource_id);
      CREATE TABLE relations(from_id TEXT NOT NULL REFERENCES resources(id), to_id TEXT NOT NULL REFERENCES resources(id), kind TEXT NOT NULL, position INTEGER, PRIMARY KEY(from_id,to_id,kind));
      CREATE INDEX relations_target ON relations(to_id,kind,from_id);
      CREATE TABLE files(resource_id TEXT PRIMARY KEY REFERENCES resources(id), path TEXT NOT NULL, path_key TEXT NOT NULL, size_bytes INTEGER, modified_ms REAL);
      CREATE INDEX files_path ON files(path_key);
      CREATE TABLE projects(id TEXT PRIMARY KEY, group_id TEXT NOT NULL, hidden INTEGER NOT NULL, signature TEXT NOT NULL, payload TEXT NOT NULL, generation INTEGER NOT NULL);
      CREATE INDEX projects_group ON projects(group_id,hidden,id);
      CREATE TABLE library(id TEXT PRIMARY KEY, group_id TEXT NOT NULL UNIQUE, resource_id TEXT NOT NULL, payload TEXT NOT NULL,
        root_inbox INTEGER NOT NULL, root_library INTEGER NOT NULL, root_workbench INTEGER NOT NULL, missing INTEGER NOT NULL,
        search TEXT NOT NULL, creator TEXT NOT NULL, narrator TEXT NOT NULL, series TEXT NOT NULL, tag TEXT NOT NULL, formats TEXT NOT NULL,
        sort_title TEXT NOT NULL, sort_author TEXT NOT NULL, sort_narrator TEXT NOT NULL, sort_series TEXT NOT NULL, sort_seriesSequence TEXT NOT NULL,
        sort_publishedYear TEXT NOT NULL, sort_createdAt TEXT NOT NULL, sort_metadataUpdatedAt TEXT NOT NULL);
      ${catalogSorts.map(sort => `CREATE INDEX library_${sort} ON library(sort_${sort},sort_title,id);`).join('\n')}
      CREATE INDEX library_root_title ON library(root_library,missing,sort_title,id);
      CREATE INDEX library_inbox_title ON library(root_inbox,missing,sort_title,id);
      CREATE VIRTUAL TABLE library_search USING fts5(search,creator,narrator,series,tag,content='library',content_rowid='rowid',tokenize='trigram');
      CREATE TRIGGER library_insert AFTER INSERT ON library BEGIN
        INSERT INTO library_search(rowid,search,creator,narrator,series,tag) VALUES(new.rowid,new.search,new.creator,new.narrator,new.series,new.tag);
      END;
      CREATE TRIGGER library_delete AFTER DELETE ON library BEGIN
        INSERT INTO library_search(library_search,rowid,search,creator,narrator,series,tag) VALUES('delete',old.rowid,old.search,old.creator,old.narrator,old.series,old.tag);
      END;
      CREATE TABLE collections(id TEXT PRIMARY KEY,name TEXT NOT NULL);
      CREATE TABLE collection_members(collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, project_id TEXT NOT NULL, PRIMARY KEY(collection_id,project_id));
      CREATE TABLE selections(token TEXT PRIMARY KEY, count INTEGER NOT NULL, revision INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE selection_items(token TEXT NOT NULL REFERENCES selections(token) ON DELETE CASCADE, position INTEGER NOT NULL, project_id TEXT NOT NULL, PRIMARY KEY(token,position));
      PRAGMA user_version=1;
      COMMIT;
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS selection_membership ON selection_items(token,project_id)');
    this.db.exec(`${catalogSorts.map(sort => `CREATE INDEX IF NOT EXISTS library_${sort}_desc ON library(sort_${sort} DESC,sort_title,id);`).join('\n')}
      CREATE TABLE IF NOT EXISTS browse_positions(identity TEXT,revision INTEGER,position INTEGER,project_id TEXT,PRIMARY KEY(identity,revision,position));
      CREATE TABLE IF NOT EXISTS browse_queries(identity TEXT,revision INTEGER,created INTEGER,PRIMARY KEY(identity,revision));`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS match_keys(key TEXT,id TEXT,PRIMARY KEY(key,id));
      CREATE INDEX IF NOT EXISTS match_key_owner ON match_keys(id);
      CREATE TABLE IF NOT EXISTS match_queue(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS match_candidates(a TEXT,b TEXT,kind TEXT,payload TEXT,PRIMARY KEY(a,b));
      CREATE INDEX IF NOT EXISTS match_candidate_b ON match_candidates(b);
      CREATE INDEX IF NOT EXISTS match_candidate_kind ON match_candidates(kind,a,b);
      CREATE TABLE IF NOT EXISTS match_decisions(a TEXT,b TEXT,decision TEXT,PRIMARY KEY(a,b));`);
    this.db.prepare('ATTACH DATABASE ? AS durable').run(file === ':memory:' ? ':memory:' : file + '.user.sqlite');
    this.db.exec(`CREATE TABLE IF NOT EXISTS durable.aliases(namespace TEXT,source_key TEXT,resource_id TEXT,PRIMARY KEY(namespace,source_key));
      CREATE TABLE IF NOT EXISTS durable.file_identity(path_key TEXT PRIMARY KEY,resource_id TEXT);
      CREATE TABLE IF NOT EXISTS durable.collections(id TEXT PRIMARY KEY,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS durable.collection_members(collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,project_id TEXT,PRIMARY KEY(collection_id,project_id));
      CREATE TABLE IF NOT EXISTS durable.migration(done INTEGER PRIMARY KEY);`);
    if (!this.db.prepare('SELECT 1 FROM durable.migration').get()) this.transaction(() => {
      this.db.exec(`INSERT OR IGNORE INTO durable.aliases SELECT * FROM main.aliases;
        INSERT OR IGNORE INTO durable.file_identity SELECT path_key,resource_id FROM main.files;
        INSERT OR IGNORE INTO durable.collections SELECT * FROM main.collections;
        INSERT OR IGNORE INTO durable.collection_members SELECT * FROM main.collection_members;
        INSERT INTO durable.migration VALUES(1);`);
    });
  }
  private statement(sql: string) {
    let statement = this.statements.get(sql);
    if (!statement) { statement = this.db.prepare(sql); this.statements.set(sql, statement); }
    return statement;
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  revision(): number { return Number(this.statement("SELECT value FROM state WHERE key='revision'").get()!.value); }
  private changed() { this.statement("UPDATE state SET value=value+1 WHERE key='revision'").run(); }
  close() { this.db.close(); }

  private resource(namespace: string, key: string, kind: string, title: string, date: string): string {
    const existing = this.statement('SELECT resource_id FROM durable.aliases WHERE namespace=? AND source_key=?').get(namespace, key);
    const id = existing ? String(existing.resource_id) : resourceId(namespace, key);
    this.statement(`INSERT INTO resources(id,kind,module_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at,archived=0,version=resources.version+1
      WHERE resources.title<>excluded.title OR resources.archived<>0`).run(id, kind, namespace.split(':')[0], title, date, date);
    this.statement('INSERT OR IGNORE INTO aliases VALUES(?,?,?)').run(namespace, key, id);
    this.statement('INSERT OR IGNORE INTO durable.aliases VALUES(?,?,?)').run(namespace, key, id);
    return id;
  }
  beginSync(): number {
    this.statement("UPDATE state SET value=value+1 WHERE key='generation'").run();
    return Number(this.statement("SELECT value FROM state WHERE key='generation'").get()!.value);
  }
  checkpoint(): number { return Number(this.statement("SELECT value FROM state WHERE key='project_checkpoint'").get()?.value || 0); }
  applyChanges(records: CatalogProject[], removed: string[], checkpoint: number) {
    // Both operations are idempotent. Advance the checkpoint only after every
    // row has committed, so an interrupted batch is safely replayed on restart.
    this.upsertProjects(records, 0);
    this.transaction(() => {
      for (const id of removed) {
        const row = this.statement('SELECT group_id,payload FROM projects WHERE id=?').get(id);
        if (!row || Number(JSON.parse(String(row.payload)).stateVersion || 0)>checkpoint) continue;
        this.statement("UPDATE projects SET hidden=1,payload=json_set(payload,'$.hidden',json('true'),'$.stateVersion',?) WHERE id=?").run(checkpoint,id);
        for (const namespace of ['audiobooks:work','audiobooks:recording']) this.statement('UPDATE resources SET archived=1 WHERE id=?').run(resourceId(namespace,id));
        for (const file of this.statement('SELECT to_id FROM relations WHERE from_id=? AND kind=?').all(resourceId('audiobooks:recording',id),'core.contains')) this.retireUnusedFile(String(file.to_id));
        this.refreshGroup(String(row.group_id)); this.changed();
      }
      this.statement("INSERT INTO state VALUES('project_checkpoint',?) ON CONFLICT(key) DO UPDATE SET value=max(state.value,excluded.value)").run(checkpoint);
    });
    return this.revision();
  }
  upsertProjects(records: CatalogProject[], generation: number, refreshFiles = false): { changed: number } {
    if (!Array.isArray(records) || records.length > 500) throw new Error('Catalog imports must use batches of at most 500 projects.');
    return this.transaction(() => {
      const groups = new Set<string>(); let count = 0;
      for (let record of records) {
        const signature = createHash('sha256').update(JSON.stringify(record)).digest('hex');
        const previous = this.statement('SELECT signature,group_id,hidden,payload FROM projects WHERE id=?').get(record.id);
        if (previous && Number(JSON.parse(String(previous.payload)).stateVersion || 0) > Number(record.stateVersion || 0)) continue;
        if (!refreshFiles && previous?.signature === signature && Number(previous.hidden) === Number(record.hidden)) { this.statement('UPDATE projects SET generation=? WHERE id=?').run(generation, record.id); continue; }
        record = observeCatalogProject(record);
        const payload = JSON.stringify(record);
        if (previous?.signature === signature && previous.payload === payload && Number(previous.hidden) === Number(record.hidden)) { this.statement('UPDATE projects SET generation=? WHERE id=?').run(generation,record.id); continue; }
        if (previous) groups.add(String(previous.group_id));
        groups.add(record.groupId); count++;
        const date = record.book.metadataUpdatedAt || record.book.createdAt || new Date().toISOString();
        const work = this.resource('audiobooks:work', record.id, 'core.work', record.book.metadata.title, date);
        const recording = this.resource('audiobooks:recording', record.id, 'core.recording', record.book.metadata.title, date);
        const oldFiles = this.statement('SELECT to_id FROM relations WHERE from_id=? AND kind=?').all(recording,'core.contains');
        this.statement('DELETE FROM relations WHERE from_id=? AND kind IN (?,?)').run(recording, 'core.edition-of', 'core.contains');
        // Explicit grouping creates links; similar titles never merge identities.
        const groupWork = this.resource('audiobooks:work', record.groupId, 'core.work', record.book.metadata.title, date);
        this.statement('INSERT OR REPLACE INTO relations VALUES(?,?,?,NULL)').run(recording, groupWork, 'core.edition-of');
        this.statement('DELETE FROM relations WHERE from_id=? AND kind=?').run(work, 'core.grouped-with');
        if (work !== groupWork) this.statement('INSERT OR REPLACE INTO relations VALUES(?,?,?,NULL)').run(work, groupWork, 'core.grouped-with');
        for (const file of record.files) {
          const alias = `${record.id}:${file.key}`, canonical = fileKey(file.path);
          const known = this.statement('SELECT resource_id FROM durable.aliases WHERE namespace=? AND source_key=?').get('audiobooks:file', alias)
            || this.statement('SELECT resource_id FROM durable.file_identity WHERE path_key=?').get(canonical);
          let fileId: string;
          if (known) {
            fileId = String(known.resource_id);
            this.statement(`INSERT OR IGNORE INTO resources(id,kind,module_id,title,created_at,updated_at) VALUES(?,'core.file','audiobooks',?,?,?)`).run(fileId,path.basename(file.path),date,date);
            this.statement('INSERT OR IGNORE INTO aliases VALUES(?,?,?)').run('audiobooks:file', alias, fileId);
            this.statement('INSERT OR IGNORE INTO durable.aliases VALUES(?,?,?)').run('audiobooks:file', alias, fileId);
            this.statement('UPDATE resources SET title=?,updated_at=?,archived=0 WHERE id=?').run(path.basename(file.path), date, fileId);
          } else fileId = this.resource('audiobooks:file', alias, 'core.file', path.basename(file.path), date);
          this.statement('INSERT OR REPLACE INTO files VALUES(?,?,?,?,?)').run(fileId, file.path, canonical, file.sizeBytes ?? null, file.modifiedMs ?? null);
          this.statement('INSERT OR REPLACE INTO durable.file_identity VALUES(?,?)').run(canonical,fileId);
          this.statement('INSERT OR REPLACE INTO relations VALUES(?,?,?,?)').run(recording, fileId, 'core.contains', file.position);
        }
        this.statement(`INSERT INTO projects VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id,hidden=excluded.hidden,signature=excluded.signature,payload=excluded.payload,generation=excluded.generation`)
          .run(record.id, record.groupId, Number(record.hidden), signature, payload, generation);
        const memberships = record.book.metadata.collections;
        if (memberships !== undefined) {
          this.statement('DELETE FROM durable.collection_members WHERE project_id=? AND collection_id NOT IN(SELECT value FROM json_each(?))').run(record.id,JSON.stringify(memberships.map(item=>item.id)));
          for (const item of memberships) {
            if (!item.id || !item.name) continue;
            this.statement('INSERT INTO durable.collections VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(item.id,item.name);
            this.statement('INSERT OR IGNORE INTO durable.collection_members VALUES(?,?)').run(item.id,record.id);
          }
        }
        this.statement('UPDATE resources SET archived=? WHERE id IN (?,?)').run(Number(record.hidden), work, recording);
        for (const row of oldFiles) this.retireUnusedFile(String(row.to_id));
        if (record.hidden) for (const row of this.statement('SELECT to_id FROM relations WHERE from_id=? AND kind=?').all(recording,'core.contains')) this.retireUnusedFile(String(row.to_id));
      }
      for (const group of groups) this.refreshGroup(group);
      if (count) this.changed();
      return { changed: count };
    });
  }
  private retireUnusedFile(id: string) {
    this.statement(`UPDATE resources SET archived=1 WHERE id=? AND kind='core.file' AND NOT EXISTS(
      SELECT 1 FROM relations r JOIN resources parent ON parent.id=r.from_id WHERE r.to_id=resources.id AND r.kind='core.contains' AND parent.archived=0)`).run(id);
  }
  endSync(generation: number) {
    return this.transaction(() => {
      const old = this.statement('SELECT id,group_id FROM projects WHERE generation<>? AND hidden=0').all(generation);
      for (const row of old) {
        this.statement('UPDATE projects SET hidden=1 WHERE id=?').run(row.id);
        for (const namespace of ['audiobooks:work', 'audiobooks:recording']) this.statement('UPDATE resources SET archived=1 WHERE id=?').run(resourceId(namespace, String(row.id)));
        for (const file of this.statement('SELECT to_id FROM relations WHERE from_id=? AND kind=?').all(resourceId('audiobooks:recording',String(row.id)),'core.contains')) this.retireUnusedFile(String(file.to_id));
      }
      for (const group of new Set(old.map(row => String(row.group_id)))) this.refreshGroup(group);
      if (old.length) this.changed();
      return { revision: this.revision(), removed: old.length };
    });
  }
  private refreshGroup(group: string) {
    const previousId = this.statement('SELECT id FROM library WHERE group_id=?').get(group)?.id;
    if (previousId) {
      this.statement('DELETE FROM match_keys WHERE id=?').run(previousId);
      this.statement('DELETE FROM match_candidates WHERE a=? OR b=?').run(previousId,previousId);
      this.statement('DELETE FROM match_queue WHERE id=?').run(previousId);
      this.statement('DELETE FROM match_decisions WHERE a=?').run(previousId);
    }
    this.statement('DELETE FROM library WHERE group_id=?').run(group);
    const records = this.statement('SELECT payload FROM projects WHERE group_id=? AND hidden=0 ORDER BY id').all(group).map(row => JSON.parse(String(row.payload)) as CatalogProject);
    if (!records.length) return;
    const primary = records.find(record => record.id === group) || records[0];
    if (primary.match && !primary.book.sourceMissing) {
      for (const key of matchCandidateKeys(primary.match.book)) this.statement('INSERT OR IGNORE INTO match_keys VALUES(?,?)').run(key,primary.id);
      this.statement('INSERT OR IGNORE INTO match_queue VALUES(?)').run(primary.id);
      for (const record of records) for (const [other, decision] of Object.entries(record.match?.decisions || {})) this.statement('INSERT OR REPLACE INTO match_decisions VALUES(?,?,?)').run(primary.id,other,JSON.stringify(decision));
    }
    const book: LibraryBook = { ...primary.book, resourceId: resourceId('audiobooks:work', group), recordingId: resourceId('audiobooks:recording', primary.id),
      rootTypes: [...new Set(records.flatMap(record => record.book.rootTypes || []))], formats: [...new Set(records.flatMap(record => record.book.formats || []))].sort(),
      representations: records.flatMap(record => (record.book.representations || []).map(item => ({ ...item, resourceId: resourceId('audiobooks:recording', record.id) }))) };
    const m = book.metadata;
    this.statement('UPDATE resources SET title=?,archived=0 WHERE id=?').run(m.title,book.resourceId);
    const sequenceMatch = String(m.seriesSequence || '').match(/^\s*(\d+(?:\.\d+)?)/);
    const sequence = sequenceMatch ? Number(sequenceMatch[1]).toFixed(8).padStart(30, '0') : '~';
    const sorts = [catalogSortKey(m.title), catalogSortKey(m.author), catalogSortKey(m.narrator), `${catalogSortKey(m.series)}\u0000${sequence}`, sequence,
      catalogSortKey(m.publishedYear), book.createdAt, book.metadataUpdatedAt || book.createdAt];
    const values: SQLInputValue[] = [book.id, group, book.resourceId, JSON.stringify(book), Number(book.rootTypes.includes('inbox')), Number(book.rootTypes.includes('library')), Number(!book.rootTypes.length), Number(!!book.sourceMissing),
      normalizeCatalogText([book.name,m.title,m.subtitle,m.author,...(m.authors || []),m.narrator,...(m.narrators || []),m.series,m.description,...(m.genres || []),...(m.tags || []),...(book.formats || [])].join(' ')),
      normalizeCatalogText([m.author,...(m.authors || [])].join(' ')), normalizeCatalogText([m.narrator,...(m.narrators || [])].join(' ')), normalizeCatalogText(m.series), normalizeCatalogText([...(m.genres || []),...(m.tags || [])].join(' ')),
      JSON.stringify((book.formats || []).map(format => normalizeCatalogText(format))), ...sorts];
    this.statement(`INSERT INTO library VALUES(${values.map(() => '?').join(',')})`).run(...values);
  }
  private where(query: CatalogQuery) {
    const conditions: string[] = [], args: SQLInputValue[] = [];
    if (query.root) {
      if (!['inbox','library','workbench'].includes(query.root)) throw new Error('Unknown library location.');
      // Collections deliberately span roots, matching the existing UI.
      if (!query.collectionId) conditions.push(`l.root_${query.root}=1`);
    }
    const availability = query.availability || 'all';
    if (!['available','missing','all'].includes(availability)) throw new Error('Unknown availability filter.');
    if (availability !== 'all') { conditions.push('l.missing=?'); args.push(Number(availability === 'missing')); }
    if (query.collectionId) {
      conditions.push('EXISTS(SELECT 1 FROM durable.collection_members cm JOIN projects p ON p.id=cm.project_id WHERE cm.collection_id=? AND p.group_id=l.group_id)'); args.push(query.collectionId);
    }
    const searchConditions: string[] = [], searchArgs: SQLInputValue[] = [];
    for (const [column,value] of [['search',query.query],['creator',query.filters?.creator],['narrator',query.filters?.narrator],['series',query.filters?.series],['tag',query.filters?.tag]]) {
      if (value !== undefined && (typeof value !== 'string' || value.length > 500)) throw new Error('Search terms must be text of at most 500 characters.');
      const term = normalizeCatalogText(value);
      if (term) { searchConditions.push(`${column} LIKE ?`); searchArgs.push(`%${term}%`); }
    }
    if (searchConditions.length) { conditions.push(`l.rowid IN(SELECT rowid FROM library_search WHERE ${searchConditions.join(' AND ')})`); args.push(...searchArgs); }
    if (query.filters?.format) { conditions.push('EXISTS(SELECT 1 FROM json_each(l.formats) WHERE value=?)'); args.push(normalizeCatalogText(query.filters.format)); }
    return { sql: conditions.length ? conditions.join(' AND ') : '1', args };
  }
  private ordering(query: CatalogQuery) {
    const sort = query.sort || 'title';
    if (!catalogSorts.includes(sort)) throw new Error('Unknown catalog sort.');
    const column = orderColumns[sort];
    return { column, order: `l.${column} ${query.descending ? 'DESC' : 'ASC'},l.sort_title ASC,l.id ASC` };
  }
  query(query: CatalogQuery = {}): CatalogPage {
    const limit = Math.max(1,boundedInt(query.limit,50,500)), offset = boundedInt(query.offset,0,10000000);
    const revision = this.revision(), where = this.where(query), ordering = this.ordering(query);
    const identity = createHash('sha256').update(JSON.stringify([where.sql,where.args,ordering.order])).digest('hex');
    const countKey = `${identity}:${revision}`;
    let total = this.counts.get(countKey);
    if (total === undefined) {
      total = Number(this.db.prepare(`SELECT count(*) AS n FROM library l WHERE ${where.sql}`).get(...where.args)!.n);
      this.counts.set(countKey,total); if (this.counts.size > 128) this.counts.delete(this.counts.keys().next().value!);
    }
    let cursor: any;
    if (query.cursor) {
      try { cursor = decode(query.cursor); } catch { throw new Error('Invalid catalog cursor.'); }
      if (cursor.revision !== revision || cursor.identity !== identity) throw new Error('Catalog changed; restart this query.');
      if (![cursor.key,cursor.title,cursor.id].every(value => typeof value === 'string')) throw new Error('Invalid catalog cursor.');
    }
    const columns = `l.payload,l.${ordering.column} AS cursor_key,l.sort_title,l.id`;
    let rows: any[];
    if (cursor && query.descending) {
      // Two independently indexed ranges preserve ascending tie-breakers even
      // when the primary key descends, without an OR that scans the index prefix.
      const same = this.db.prepare(`SELECT ${columns} FROM library l WHERE ${where.sql} AND l.${ordering.column}=? AND (l.sort_title,l.id)>(?,?) ORDER BY l.sort_title,l.id LIMIT ?`)
        .all(...where.args,cursor.key,cursor.title,cursor.id,limit+1);
      rows = same.length > limit ? same : [...same,...this.db.prepare(`SELECT ${columns} FROM library l WHERE ${where.sql} AND l.${ordering.column}<? ORDER BY ${ordering.order} LIMIT ?`).all(...where.args,cursor.key,limit+1-same.length)];
    } else if (cursor) {
      rows = this.db.prepare(`SELECT ${columns} FROM library l WHERE ${where.sql} AND (l.${ordering.column},l.sort_title,l.id)>(?,?,?) ORDER BY ${ordering.order} LIMIT ?`).all(...where.args,cursor.key,cursor.title,cursor.id,limit+1);
    } else if (offset) {
      // Random page jumps build a disk-backed ordered ID list once. Subsequent
      // jumps seek its integer primary key, never discard a deep OFFSET prefix.
      if (!this.statement('SELECT 1 FROM browse_queries WHERE identity=? AND revision=?').get(identity,revision)) {
        this.transaction(() => {
          this.statement('DELETE FROM browse_positions WHERE revision<>? OR identity IN(SELECT identity FROM browse_queries WHERE created<?)').run(revision,Date.now()-1800000);
          this.statement('DELETE FROM browse_queries WHERE revision<>? OR created<?').run(revision,Date.now()-1800000);
          const oldest=this.statement('SELECT identity,revision FROM browse_queries ORDER BY created DESC LIMIT -1 OFFSET 7').all();
          for (const row of oldest) { this.statement('DELETE FROM browse_positions WHERE identity=? AND revision=?').run(row.identity,row.revision); this.statement('DELETE FROM browse_queries WHERE identity=? AND revision=?').run(row.identity,row.revision); }
          this.db.prepare(`INSERT INTO browse_positions SELECT ?,?,row_number() OVER(ORDER BY ${ordering.order})-1,l.id FROM library l WHERE ${where.sql}`).run(identity,revision,...where.args);
          this.statement('INSERT INTO browse_queries VALUES(?,?,?)').run(identity,revision,Date.now());
        });
      }
      rows = this.db.prepare(`SELECT ${columns} FROM browse_positions b JOIN library l ON l.id=b.project_id WHERE b.identity=? AND b.revision=? AND b.position>=? ORDER BY b.position LIMIT ?`).all(identity,revision,offset,limit+1);
    } else rows = this.db.prepare(`SELECT ${columns} FROM library l WHERE ${where.sql} ORDER BY ${ordering.order} LIMIT ?`).all(...where.args,limit+1);
    const more = rows.length > limit; if (more) rows.pop(); const last = rows.at(-1);
    const position = cursor?.offset ?? offset;
    const makeCursor = (row: any, next: number) => encode({ revision,identity,key:row.cursor_key,title:row.sort_title,id:row.id,offset:next });
    const step = Math.max(1,boundedInt(query.windowStep,limit,limit)), anchor = rows[step-1];
    return { items: rows.map(row => JSON.parse(String(row.payload))), total, offset:position, revision,
      nextCursor: more && last ? makeCursor(last,position+rows.length) : undefined,
      windowCursor: more && anchor ? makeCursor(anchor,position+step) : undefined };
  }
  getResource(id: string): (ResourceSummary & { relations: unknown[]; relationPage: {total:number;nextCursor?:string;revision:number}; file?: unknown }) | undefined {
    const row = this.statement('SELECT * FROM resources WHERE id=?').get(id);
    if (!row) return;
    const relations = this.relations({ id,limit:50 });
    return { ...this.resourceSummary(row), relations:relations.items, relationPage:{ total:relations.total,nextCursor:relations.nextCursor,revision:relations.revision },
      file: this.statement('SELECT path,size_bytes AS sizeBytes,modified_ms AS modifiedMs FROM files WHERE resource_id=?').get(id) };
  }
  relations(input: { id: string; limit?: number; cursor?: string }) {
    const limit = Math.max(1,boundedInt(input.limit,50,500)), revision = this.revision();
    const args: SQLInputValue[] = [input.id,input.id]; let cursorSql = '';
    const total = Number(this.statement('SELECT count(*) AS n FROM relations WHERE from_id=? OR to_id=?').get(...args)!.n);
    if (input.cursor) {
      const cursor = decode(input.cursor);
      if (cursor.revision !== revision || cursor.id !== input.id) throw new Error('Catalog changed; restart this query.');
      if (![cursor.from,cursor.to,cursor.kind].every(value => typeof value === 'string')) throw new Error('Invalid relation cursor.');
      cursorSql = ' AND (from_id,to_id,kind)>(?,?,?)'; args.push(cursor.from,cursor.to,cursor.kind);
    }
    const rows = this.db.prepare(`SELECT from_id AS fromId,to_id AS toId,kind,position FROM relations WHERE (from_id=? OR to_id=?)${cursorSql} ORDER BY from_id,to_id,kind LIMIT ?`).all(...args,limit+1);
    const more = rows.length > limit; if (more) rows.pop(); const last = rows.at(-1);
    return { items:rows,total,revision,nextCursor:more && last ? encode({ revision,id:input.id,from:last.fromId,to:last.toId,kind:last.kind }) : undefined };
  }
  private resourceSummary(row: any): ResourceSummary { return { id:row.id,kind:row.kind,moduleId:row.module_id,title:row.title,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,archived:!!row.archived }; }
  resources(input: { kind?: string; limit?: number; cursor?: string } = {}): ResourcePage {
    const limit = Math.max(1,boundedInt(input.limit,50,500)), args: SQLInputValue[] = [];
    let where = 'archived=0'; if (input.kind) { where += ' AND kind=?'; args.push(input.kind); }
    const total = Number(this.db.prepare(`SELECT count(*) AS n FROM resources WHERE ${where}`).get(...args)!.n), revision = this.revision();
    if (input.cursor) { const cursor = decode(input.cursor); if (cursor.revision !== revision || cursor.kind !== (input.kind || '')) throw new Error('Catalog changed; restart this query.'); where += ' AND (title,id)>(?,?)'; args.push(cursor.title,cursor.id); }
    const rows = this.db.prepare(`SELECT * FROM resources WHERE ${where} ORDER BY title,id LIMIT ?`).all(...args,limit + 1);
    const more = rows.length > limit; if (more) rows.pop(); const last = rows.at(-1);
    return { items: rows.map(row => this.resourceSummary(row)), total, revision, nextCursor: more && last ? encode({ revision,kind:input.kind || '',title:last.title,id:last.id }) : undefined };
  }
  selection(query: CatalogQuery): CatalogSelection {
    return this.transaction(() => {
      this.statement('DELETE FROM selections WHERE expires<?').run(Date.now());
      const token = randomUUID(), revision = this.revision(), where = this.where(query), { order } = this.ordering(query);
      this.statement('INSERT INTO selections VALUES(?,?,?,?)').run(token,0,revision,Date.now()+86400000);
      this.db.prepare(`INSERT INTO selection_items SELECT ?,row_number() OVER(ORDER BY ${order})-1,l.id FROM library l WHERE ${where.sql}`).run(token,...where.args);
      const count = Number(this.statement('SELECT count(*) AS n FROM selection_items WHERE token=?').get(token)!.n);
      this.statement('UPDATE selections SET count=? WHERE token=?').run(count,token);
      const hasGroups = !!this.db.prepare(`SELECT 1 FROM library l WHERE ${where.sql} AND json_array_length(json_extract(l.payload,'$.representations'))>1 LIMIT 1`).get(...where.args);
      return { token,count,revision,hasGroups };
    });
  }
  selectionPage(input: { token: string; offset?: number; exclude?: string[] }) {
    const found = this.statement('SELECT * FROM selections WHERE token=? AND expires>?').get(input.token,Date.now());
    if (!found) throw new Error('Selection expired. Select the results again.');
    const offset = boundedInt(input.offset,0,10000000), rows = this.statement('SELECT project_id,position FROM selection_items WHERE token=? AND position>=? ORDER BY position LIMIT 500').all(input.token,offset);
    const excluded = new Set(input.exclude || []);
    return { ids: rows.map(row => String(row.project_id)).filter(id => !excluded.has(id)), nextOffset: rows.length && Number(rows.at(-1)!.position)+1 < Number(found.count) ? Number(rows.at(-1)!.position)+1 : undefined };
  }
  selectionMembers(input: { token:string; ids:string[] }) {
    if (!Array.isArray(input.ids) || input.ids.length>500 || input.ids.some(id=>typeof id!=='string')) throw new Error('Membership checks accept at most 500 IDs.');
    if (!this.statement('SELECT token FROM selections WHERE token=? AND expires>?').get(input.token,Date.now())) throw new Error('Selection expired. Select the results again.');
    return this.statement('SELECT project_id FROM selection_items WHERE token=? AND project_id IN(SELECT value FROM json_each(?))').all(input.token,JSON.stringify(input.ids)).map(row=>row.project_id);
  }
  collections(): CatalogCollection[] { return this.statement('SELECT c.id,c.name,count(DISTINCT l.group_id) AS count FROM durable.collections c LEFT JOIN durable.collection_members m ON m.collection_id=c.id LEFT JOIN projects p ON p.id=m.project_id LEFT JOIN library l ON l.group_id=p.group_id GROUP BY c.id ORDER BY c.name,c.id').all().map(row => ({ id:String(row.id),name:String(row.name),count:Number(row.count),bookIds:[] })); }
  collectionAffectedProjects(input: { id:string; ids?:string[]; selection?:string; remove?:boolean; name?:string }) {
    return this.statement(`SELECT DISTINCT id FROM projects WHERE id IN(SELECT project_id FROM durable.collection_members WHERE collection_id=? AND ?)
      OR group_id IN(SELECT group_id FROM projects WHERE id IN(SELECT value FROM json_each(?)))
      OR id IN(SELECT project_id FROM selection_items WHERE token=?)`).all(input.id,Number(!!input.remove || input.name !== undefined),JSON.stringify(input.ids || []),input.selection || '').map(row=>String(row.id));
  }
  collectionMembershipRows(ids:string[]) {
    return this.statement(`SELECT m.project_id,c.id,c.name FROM durable.collection_members m JOIN durable.collections c ON c.id=m.collection_id WHERE m.project_id IN(SELECT value FROM json_each(?))`).all(JSON.stringify(ids));
  }
  saveCollection(input: { id: string; name?: string; ids?: string[]; selection?: string; exclude?: string[]; remove?: boolean; removeMembers?: boolean; importOnly?: boolean }) {
    return this.transaction(() => {
      if (!input.id || typeof input.id !== 'string' || input.id.length > 200) throw new Error('Invalid collection ID.');
      if (input.remove) this.statement('DELETE FROM durable.collections WHERE id=?').run(input.id);
      else {
        if (input.importOnly && this.statement('SELECT id FROM durable.collections WHERE id=?').get(input.id)) return this.collections();
        if (input.name !== undefined) {
          if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('A collection needs a name of at most 100 characters.');
          this.statement('INSERT INTO durable.collections VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(input.id,input.name.trim());
        }
        if (!this.statement('SELECT id FROM durable.collections WHERE id=?').get(input.id)) throw new Error('Collection not found.');
        if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.some(id => typeof id !== 'string'))) throw new Error('Collection members must be IDs.');
        for (const id of input.ids || []) {
          if (input.removeMembers) this.statement('DELETE FROM durable.collection_members WHERE collection_id=? AND project_id IN(SELECT id FROM projects WHERE group_id=(SELECT group_id FROM projects WHERE id=?))').run(input.id,id);
          else this.statement('INSERT OR IGNORE INTO durable.collection_members VALUES(?,?)').run(input.id,id);
        }
        if (input.selection) {
          if (!this.statement('SELECT token FROM selections WHERE token=? AND expires>?').get(input.selection,Date.now())) throw new Error('Selection expired.');
          if (input.removeMembers) this.statement(`DELETE FROM durable.collection_members WHERE collection_id=? AND project_id IN(
            SELECT member.id FROM projects member JOIN projects selected ON selected.group_id=member.group_id JOIN selection_items s ON s.project_id=selected.id
            WHERE s.token=? AND s.project_id NOT IN(SELECT value FROM json_each(?)))`).run(input.id,input.selection,JSON.stringify(input.exclude || []));
          else this.statement('INSERT OR IGNORE INTO durable.collection_members SELECT ?,project_id FROM selection_items WHERE token=? AND project_id NOT IN(SELECT value FROM json_each(?))').run(input.id,input.selection,JSON.stringify(input.exclude || []));
        }
      }
      this.changed(); return this.collections();
    });
  }
  membershipSuggestions(input: { kind: 'collections' | 'additionalSeries'; query?: string; author?: string; authors?: string[]; jobId?: string }) {
    if (!['collections','additionalSeries'].includes(input.kind)) throw new Error('Unknown membership kind.');
    const authors = [...new Set([...(input.authors || []), input.author || ''].map(name => name.trim().toLowerCase()).filter(Boolean))];
    const sameAuthor = `EXISTS(SELECT 1 FROM json_each(?) wanted WHERE lower(trim(json_extract(p.payload,'$.book.metadata.author')))=wanted.value OR EXISTS(SELECT 1 FROM json_each(json_extract(p.payload,'$.book.metadata.authors')) a WHERE lower(trim(a.value))=wanted.value))`;
    const authorJson = JSON.stringify(authors);
    const query = `%${String(input.query || '').replaceAll('%','').replaceAll('_','').slice(0,100)}%`;
    const item = (name: string, id?: string) => ({ id:id || 'series-' + createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0,24), name });
    let matches: { id:string; name:string }[], quick: { id:string; name:string }[];
    if (input.kind === 'collections') {
      matches = this.statement('SELECT id,name FROM durable.collections WHERE name LIKE ? ORDER BY name LIMIT 40').all(query).map(row => item(String(row.name),String(row.id)));
      const recent = this.statement('SELECT c.id,c.name FROM durable.collections c JOIN durable.collection_members m ON c.id=m.collection_id GROUP BY c.id ORDER BY max(m.rowid) DESC LIMIT 5').all();
      const related = this.db.prepare(`SELECT DISTINCT c.id,c.name FROM durable.collections c JOIN durable.collection_members m ON c.id=m.collection_id JOIN projects p ON p.id=m.project_id WHERE p.hidden=0 AND ${sameAuthor} ORDER BY c.name LIMIT 100`).all(authorJson);
      quick = [...recent,...related].map(row => item(String(row.name),String(row.id)));
    } else {
      const rows = `SELECT json_extract(p.payload,'$.book.metadata.series') name, coalesce(json_extract(p.payload,'$.book.metadata.seriesAddedAt'),json_extract(p.payload,'$.book.createdAt')) added FROM projects p WHERE p.hidden=0
        UNION ALL SELECT json_extract(j.value,'$.name') name, coalesce(json_extract(j.value,'$.addedAt'),json_extract(p.payload,'$.book.metadataUpdatedAt')) added FROM projects p,json_each(json_extract(p.payload,'$.book.metadata.additionalSeries')) j WHERE p.hidden=0`;
      matches = this.db.prepare(`SELECT name FROM (${rows}) WHERE name IS NOT NULL AND trim(name)<>'' AND name LIKE ? GROUP BY lower(name) ORDER BY name LIMIT 40`).all(query).map(row => item(String(row.name)));
      const recent = this.db.prepare(`SELECT name FROM (${rows}) WHERE name IS NOT NULL AND trim(name)<>'' GROUP BY lower(name) ORDER BY max(added) DESC LIMIT 5`).all();
      const related = this.db.prepare(`SELECT json_extract(p.payload,'$.book.metadata.series') name FROM projects p WHERE p.hidden=0 AND ${sameAuthor}
        UNION SELECT json_extract(j.value,'$.name') name FROM projects p,json_each(json_extract(p.payload,'$.book.metadata.additionalSeries')) j WHERE p.hidden=0 AND ${sameAuthor} LIMIT 100`).all(authorJson,authorJson);
      quick = [...recent,...related].filter(row => row.name).map(row => item(String(row.name)));
    }
    const selected = input.kind === 'collections' && input.jobId ? this.statement('SELECT c.id,c.name FROM durable.collections c JOIN durable.collection_members m ON m.collection_id=c.id WHERE m.project_id=? ORDER BY c.name').all(input.jobId).map(row=>item(String(row.name),String(row.id))) : [];
    return { matches, quick:[...new Map(quick.map(value => [value.name.toLowerCase(),value])).values()], selected };
  }
  suggestions(input: { field: string; query?: string }) {
    if (!['author','narrator','series','genres','publisher','language','format'].includes(input.field)) throw new Error('Unknown suggestion field.');
    const expression = ['genres','format'].includes(input.field) ? "json_each.value" : `json_extract(l.payload,'$.metadata.${input.field}')`;
    const join = input.field === 'genres' ? ",json_each(json_extract(l.payload,'$.metadata.genres'))" : input.field === 'format' ? ',json_each(l.formats)' : '';
    return this.db.prepare(`SELECT DISTINCT ${expression} AS value FROM library l${join} WHERE ${expression} IS NOT NULL AND ${expression}<>'' AND ${expression} LIKE ? ORDER BY value LIMIT 100`).all(`%${String(input.query || '').replaceAll('%','').replaceAll('_','')}%`).map(row => row.value);
  }
  maintainMatches() {
    let count = Number(this.statement('SELECT count(*) AS n FROM match_candidates').get()!.n);
    const pending = this.statement('SELECT id FROM match_queue ORDER BY id LIMIT 50').all();
    this.transaction(() => { for (const item of pending) {
      if (count >= 2000) break;
      const row = this.statement('SELECT p.payload FROM projects p JOIN library l ON l.id=p.id WHERE p.id=?').get(item.id);
      if (!row) { this.statement('DELETE FROM match_queue WHERE id=?').run(item.id); continue; }
      const source = JSON.parse(String(row.payload)) as CatalogProject;
      // Seek a bounded set of neighbors in each indexed bucket. A common file
      // size or title must not sort/load a whole library during maintenance.
      const candidateIds=new Set<string>();
      for (const key of source.match ? matchCandidateKeys(source.match.book) : []) {
        for (const direction of ['>','<'] as const) {
          const neighbors=this.statement(`SELECT id FROM match_keys WHERE key=? AND id${direction}? ORDER BY id ${direction==='>'?'ASC':'DESC'} LIMIT 30`).all(key,item.id);
          for (const neighbor of neighbors) { if(candidateIds.size<200) candidateIds.add(String(neighbor.id)); }
        }
        if(candidateIds.size>=200) break;
      }
      const candidates=[...candidateIds].map(id=>this.statement('SELECT p.payload FROM projects p JOIN library l ON l.id=p.id WHERE p.id=?').get(id)).filter((row):row is NonNullable<typeof row>=>!!row);
      for (const candidate of candidates) {
        const other = JSON.parse(String(candidate.payload)) as CatalogProject;
        if (!source.match || !other.match || other.book.sourceMissing || source.groupId === other.groupId) continue;
        const dismissed = this.statement(`SELECT 1 FROM match_decisions d JOIN projects p ON p.id=d.b
          WHERE (d.a=? AND p.group_id=?) OR (d.a=? AND p.group_id=?) LIMIT 1`).get(source.id,other.groupId,other.id,source.groupId);
        if (dismissed) continue;
        const match = findBookMatches([source.match.book,other.match.book],new Set())[0]; if (!match) continue;
        const forward=source.match.confirmed?.[other.id], reverse=other.match.confirmed?.[source.id];
        const confirmation=forward?.leftSignature===source.match.sourceSignature && forward?.rightSignature===other.match.sourceSignature ? forward
          : reverse?.leftSignature===other.match.sourceSignature && reverse?.rightSignature===source.match.sourceSignature ? reverse : undefined;
        if (confirmation) match.kind='audio';
        const [a,b] = [source.id,other.id].sort();
        const inserted = this.statement('INSERT OR IGNORE INTO match_candidates VALUES(?,?,?,?)').run(a,b,match.kind,JSON.stringify({ ...match,evidence:confirmation?.kind,aTitle:source.book.metadata.title,bTitle:other.book.metadata.title }));
        count += Number(inserted.changes); if (count >= 2000) break;
      }
      this.statement('DELETE FROM match_queue WHERE id=?').run(item.id);
    } });
    return { pending:!!this.statement('SELECT 1 FROM match_queue LIMIT 1').get(),full:count>=2000 };
  }
  matches(input: { root?: string; kind?: string; offset?: number; limit?: number; reviewed?: boolean } = {}) {
    const limit = Math.max(1,boundedInt(input.limit,100,500)), offset = boundedInt(input.offset,0,10000000);
    const args: SQLInputValue[] = []; let filter = '1';
    if (input.root) {
      if (!['library','inbox','workbench'].includes(input.root)) throw new Error('Unknown root.');
      filter += ` AND (a.root_${input.root}=1 OR b.root_${input.root}=1)`;
    }
    if (input.kind && input.kind !== 'all') { if (!['book','audio','uncertain'].includes(input.kind)) throw new Error('Unknown match kind.'); filter += ' AND m.kind=?'; args.push(input.kind); }
    const table = input.reviewed ? 'match_decisions' : 'match_candidates';
    const join = `${table} m JOIN library a ON a.id=m.a JOIN projects p ON p.id=m.b JOIN library b ON b.group_id=p.group_id`;
    const total = Number(this.db.prepare(`SELECT count(*) AS n FROM ${join} WHERE ${filter}`).get(...args)!.n);
    // Candidate review is capped at 2,000; browsing never invokes the matcher or touches disks.
    const rows = this.db.prepare(`SELECT m.*,json_extract(a.payload,'$.metadata.title') AS aTitle,json_extract(b.payload,'$.metadata.title') AS bTitle FROM ${join} WHERE ${filter} ORDER BY m.a,m.b LIMIT ? OFFSET ?`).all(...args,limit,offset);
    return { items:rows.map(row=>input.reviewed ? { a:row.a,b:row.b,aTitle:row.aTitle,bTitle:row.bTitle,decision:JSON.parse(String(row.decision)) } : JSON.parse(String(row.payload))),total,offset,
      pending:!!this.statement('SELECT 1 FROM match_queue LIMIT 1').get(), capped:!input.reviewed && Number(this.statement('SELECT count(*) AS n FROM match_candidates').get()!.n)>=2000 };
  }
}
