import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { catalogSortKey, normalizeCatalogText } from '../src/core/catalog';
import { fileKind, type BrowserEntry, type FileDetails } from '../src/utils/bookFiles';
import { pathKey } from './library-filesystem';

export interface DirectoryQuery { query?: string; filter?: string; sort?: string; limit?: number; cursor?: string; before?: boolean; refresh?: boolean }
/** Rebuildable directory observations. Enumeration never probes audio or edits media. */
export class DirectoryIndex {
  readonly db: DatabaseSync;
  private running = new Map<string,Promise<void>>();
  constructor(file: string) {
    this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS directory_state(directory TEXT PRIMARY KEY,generation INTEGER,complete INTEGER,observed INTEGER,error TEXT);
      CREATE TABLE IF NOT EXISTS directory_entries(directory TEXT,path TEXT,name TEXT,folder INTEGER,kind TEXT,size REAL,modified REAL,payload TEXT,search TEXT,generation INTEGER,PRIMARY KEY(directory,path));
      CREATE INDEX IF NOT EXISTS directory_name ON directory_entries(directory,folder,name,path);
      CREATE INDEX IF NOT EXISTS directory_size ON directory_entries(directory,folder,size,name,path);
      CREATE INDEX IF NOT EXISTS directory_modified ON directory_entries(directory,folder,modified,name,path);
      CREATE VIRTUAL TABLE IF NOT EXISTS directory_search USING fts5(search,content='directory_entries',content_rowid='rowid',tokenize='trigram');
      CREATE TRIGGER IF NOT EXISTS directory_insert AFTER INSERT ON directory_entries BEGIN INSERT INTO directory_search(rowid,search) VALUES(new.rowid,new.search); END;
      CREATE TRIGGER IF NOT EXISTS directory_delete AFTER DELETE ON directory_entries BEGIN INSERT INTO directory_search(directory_search,rowid,search) VALUES('delete',old.rowid,old.search); END;`);
  }
  private write(directory: string, entries: BrowserEntry[], generation: number) {
    this.db.exec('BEGIN');
    try {
      const existing=this.db.prepare('SELECT payload FROM directory_entries WHERE directory=? AND path=?');
      const remove=this.db.prepare('DELETE FROM directory_entries WHERE directory=? AND path=?');
      const insert=this.db.prepare('INSERT INTO directory_entries VALUES(?,?,?,?,?,?,?,?,?,?)');
      for (const entry of entries) {
        const row=existing.get(directory,entry.path), previous=row && JSON.parse(String(row.payload));
        if (previous?.stamp === entry.stamp) entry.metadata ||= previous.metadata;
        remove.run(directory,entry.path);
        insert.run(directory,entry.path,catalogSortKey(entry.name),Number(entry.type!=='folder'),fileKind(entry),-(entry.sizeBytes || 0),-(entry.modifiedMs || 0),JSON.stringify(entry),normalizeCatalogText([entry.name,entry.metadata?.title,entry.metadata?.author,entry.metadata?.narrator,entry.metadata?.year].join(' ')),generation);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  has(directory: string) { return !!this.db.prepare('SELECT 1 FROM directory_state WHERE directory=?').get(directory); }
  refresh(directory: string, excluded: string[] = []) {
    if (this.running.has(directory)) return this.running.get(directory)!;
    const previous=this.db.prepare('SELECT * FROM directory_state WHERE directory=?').get(directory);
    // Re-enumerate an interrupted directory: OS directory offsets are not durable.
    // Completed observations and cached metadata are reused; absent entries are
    // retired only after a complete pass, never after a network/share error.
    const generation=Number(previous?.generation || 0)+1;
    this.db.prepare('INSERT OR REPLACE INTO directory_state VALUES(?,?,0,?,NULL)').run(directory,generation,Date.now());
    const task=(async()=>{
      let batch: BrowserEntry[]=[];
      const blocked=new Set(excluded.map(pathKey));
      const { assertUnlinked } = await import('./library-filesystem');
      await assertUnlinked(directory);
      const directoryHandle=await fs.opendir(directory);
      for await (const entry of directoryHandle) {
        const file=path.join(directory,entry.name);
        if (entry.isSymbolicLink() || entry.name.startsWith('.swissmouse') || blocked.has(pathKey(file)) || !entry.isFile() && !entry.isDirectory()) continue;
        let stat; try { stat=await fs.lstat(file); } catch { /* Retain an unavailable observation. */ }
        batch.push({path:file,name:entry.name,relativePath:entry.name,type:entry.isDirectory()?'folder':'file',sizeBytes:stat?.size,modifiedMs:stat?.mtimeMs,
          stamp:stat?`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`:undefined,unavailable:!stat,audio:fileKind({name:entry.name,type:'file'})==='audio'});
        if (batch.length===100) { this.write(directory,batch,generation); batch=[]; await new Promise<void>(resolve=>setImmediate(resolve)); }
      }
      this.write(directory,batch,generation);
      this.db.exec('BEGIN');
      try { this.db.prepare('DELETE FROM directory_entries WHERE directory=? AND generation<>?').run(directory,generation);
        this.db.prepare('UPDATE directory_state SET complete=1,observed=?,error=NULL WHERE directory=?').run(Date.now(),directory); this.db.exec('COMMIT');
      } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    })().catch(error=>{ this.db.prepare('UPDATE directory_state SET error=?,observed=? WHERE directory=?').run(error.message,Date.now(),directory); })
      .finally(()=>this.running.delete(directory));
    this.running.set(directory,task); return task;
  }
  query(directory: string, input: DirectoryQuery={}, excluded: string[]=[]) {
    const state=this.db.prepare('SELECT * FROM directory_state WHERE directory=?').get(directory);
    // Resume interrupted work immediately, but back off after an actual I/O
    // failure. Cached browsing must not hammer an unavailable network share.
    if (!state || input.refresh || !state.complete && !state.error || Date.now()-Number(state.observed)>=60000) void this.refresh(directory,excluded);
    const limit=Number(input.limit || 100); if (!Number.isSafeInteger(limit) || limit<1 || limit>500) throw new Error('Choose between 1 and 500 files.');
    const sort=input.sort || 'name'; if (!['name','size','modified'].includes(sort)) throw new Error('Unknown file sort.');
    if (typeof input.query !== 'undefined' && (typeof input.query!=='string' || input.query.length>500)) throw new Error('Invalid file search.');
    if (input.filter && !['all','audio','video','image','document','folder'].includes(input.filter)) throw new Error('Unknown file filter.');
    let where='directory=?'; const args:any[]=[directory];
    // Apply current exclusions even when a previous observation predates them.
    for (const blocked of excluded.filter(file=>pathKey(path.dirname(file))===pathKey(directory))) { where+=' AND path<>? COLLATE NOCASE'; args.push(blocked); }
    if (input.filter === 'folder') where+=' AND folder=0';
    else if (input.filter && input.filter!=='all') { where+=' AND (folder=0 OR kind=?)'; args.push(input.filter); }
    if (input.query) { where+=' AND rowid IN(SELECT rowid FROM directory_search WHERE search LIKE ?)'; args.push('%'+normalizeCatalogText(input.query)+'%'); }
    const identity=createHash('sha256').update(JSON.stringify([directory,input.query,input.filter,sort])).digest('hex');
    const total=Number(this.db.prepare(`SELECT count(*) AS n FROM directory_entries WHERE ${where}`).get(...args)!.n);
    let cursor:any; if (input.cursor) {
      try { cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8')); } catch { throw new Error('Invalid directory cursor.'); }
      if (cursor.identity!==identity || !Array.isArray(cursor.keys) || cursor.keys.length!==4) throw new Error('Directory query changed.');
      where+=` AND (folder,${sort},name,path)${input.before?'<':'>'}(?,?,?,?)`; args.push(...cursor.keys);
    }
    const order=input.before?'DESC':'ASC';
    const rows=this.db.prepare(`SELECT * FROM directory_entries WHERE ${where} ORDER BY folder ${order},${sort} ${order},name ${order},path ${order} LIMIT ?`).all(...args,limit+1);
    const more=rows.length>limit; if(more) rows.pop(); if(input.before) rows.reverse();
    const encode=(row:any)=>Buffer.from(JSON.stringify({identity,keys:[row.folder,row[sort],row.name,row.path]})).toString('base64url');
    return {entries:rows.map(row=>JSON.parse(String(row.payload)) as BrowserEntry),total,indexing:this.running.has(directory),error:state?.error,
      nextCursor:rows.length && (input.before || more)?encode(rows.at(-1)):undefined,
      previousCursor:rows.length && (input.before?more:!!cursor)?encode(rows[0]):undefined};
  }
  remember(directory: string, file: string, metadata: FileDetails) {
    const row=this.db.prepare('SELECT payload,generation FROM directory_entries WHERE directory=? AND path=?').get(directory,file);
    if(row) this.write(directory,[{...JSON.parse(String(row.payload)),metadata}],Number(row.generation));
  }
  async close() { await Promise.all(this.running.values()); this.db.close(); }
}
