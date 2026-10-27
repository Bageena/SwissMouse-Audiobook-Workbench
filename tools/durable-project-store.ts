import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { AudiobookJob } from '../src/types';
import { ProjectStore } from './project-store';
import { openProjectDatabase } from './project-schema';

/** Authoritative user data. The catalog is disposable; this database is not. */
export class DurableProjectStore extends ProjectStore {
  readonly db: DatabaseSync;
  private ids: string[] = [];
  private collection?: AudiobookJob[];
  private dirty = new Map<string, AudiobookJob>();
  private removed = new Set<string>();
  private live = new Map<string, WeakRef<AudiobookJob>>();
  private recent = new Map<string, AudiobookJob>();
  private raw = new WeakMap<object, () => any>();
  private records = new Map<string, AudiobookJob>();
  private resident = new Map<string, WeakRef<AudiobookJob>>();
  private dirtyRecords = new Map<string, AudiobookJob>();
  private external = new Map<string, WeakRef<AudiobookJob>>();
  private restoring = false;
  constructor(file: string, warning?: (message: string) => void) {
    super(file, warning);
    this.db = openProjectDatabase(file + '.sqlite', warning);
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = run(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private nextVersion() { return Number(this.db.prepare("UPDATE project_meta SET value=value+1 WHERE key='version' RETURNING value").get()!.value); }
  /** Read one JSON object at a time during the one-time legacy migration. */
  private *legacy(file: string): Generator<AudiobookJob> {
    const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(65536);
    const decoder = new TextDecoder(); let text = '', depth = 0, quoted = false, escaped = false, started = false, ended = false;
    let expect = 'open';
    try {
      let bytes: number;
      do {
        bytes = fs.readSync(fd, buffer); const chunk = decoder.decode(buffer.subarray(0, bytes), { stream: bytes > 0 });
        for (const char of chunk) {
          if (!started) {
            if (/\s/.test(char)) continue;
            if (expect === 'open' && char === '[') { expect = 'first'; continue; }
            if ((expect === 'first' || expect === 'comma') && char === ']') { ended = true; expect = 'end'; continue; }
            if (expect === 'comma' && char === ',') { expect = 'value'; continue; }
            if (!['first','value'].includes(expect) || char !== '{' || ended) throw new Error('Invalid legacy project array.');
            started = true; depth = 0; text = '';
          }
          text += char;
          if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
          else if (char === '"') quoted = true;
          else if (char === '{' || char === '[') depth++;
          else if (char === '}' || char === ']') depth--;
          if (!depth && !quoted) { yield this.decode('[' + text + ']')[0]; text = ''; started = false; expect = 'comma'; }
        }
      } while (bytes);
      if (!ended || started) throw new Error('Incomplete legacy project array.');
    } finally { fs.closeSync(fd); }
  }
  override load(): AudiobookJob[] {
    if (!this.db.prepare("SELECT value FROM project_meta WHERE key='migrated'").get()) {
      const migrate = (file?: string) => this.transaction(() => {
        const insert = this.db.prepare('INSERT INTO project_state(id,payload,version) VALUES(?,?,?)');
        if (file) for (const job of this.legacy(file)) insert.run(job.id, this.encode([job]), this.nextVersion());
        this.db.prepare("INSERT INTO project_meta VALUES('migrated',1)").run();
      });
      try {
        if (!fs.existsSync(this.file) && fs.existsSync(this.file + '.bak')) super.load();
        migrate(fs.existsSync(this.file) ? this.file : undefined);
      }
      catch (error) {
        // Validate/recover using the established recovery policy; never overwrite an invalid original silently.
        super.load(); migrate(this.file);
      }
    }
    this.ids = [];
    for (const row of this.db.prepare('SELECT id FROM project_state WHERE deleted=0 ORDER BY rowid').iterate()) this.ids.push(String(row.id));
    const store = this;
    // Array compatibility for processing tools. Only small IDs stay resident;
    // numeric access hydrates one project, and saves visit only dirty records.
    this.collection = new Proxy([] as AudiobookJob[], {
      get(target, key, receiver) {
        if (key === 'length') return store.ids.length;
        if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) return store.get(store.ids[Number(key)]);
        return Reflect.get(target, key, receiver);
      },
      has(target, key) { return typeof key === 'string' && /^\d+$/.test(key) ? Number(key) < store.ids.length : Reflect.has(target, key); },
      set(_target, key, value) {
        if (key === 'length') { for (const id of store.ids.slice(value)) store.removed.add(id); store.ids.length = value; return true; }
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          const index = Number(key), old = store.ids[index]; if (old && old !== value.id) store.removed.add(old);
          store.ids[index] = value.id; store.removed.delete(value.id);
          store.track(value); return true;
        }
        return false;
      },
      deleteProperty(_target, key) { if (typeof key === 'string' && /^\d+$/.test(key)) { const id = store.ids[Number(key)]; if (id) store.removed.add(id); } return true; },
    });
    return this.collection;
  }
  private record(id: string): AudiobookJob {
    let value = this.dirtyRecords.get(id) || this.external.get(id)?.deref() || this.records.get(id) || this.resident.get(id)?.deref();
    if (!value) {
      const row = this.db.prepare('SELECT payload FROM project_state WHERE id=? AND deleted=0').get(id);
      if (!row) throw new Error('Project no longer exists.');
      value = JSON.parse(String(row.payload))[0] as AudiobookJob;
    }
    this.resident.set(id,new WeakRef(value));
    this.records.delete(id); this.records.set(id,value);
    while (this.records.size > 32) this.records.delete(this.records.keys().next().value!);
    return value;
  }
  private unwrap(value: any): any {
    if (!value || typeof value !== 'object') return value;
    const known=this.raw.get(value); if (known) return known();
    // Array filter/map and object spreads may contain nested proxies. Resolve
    // them before assigning the new value, preserving normal object semantics.
    for (const key of Object.keys(value)) { const next=this.unwrap(value[key]); if (next!==value[key]) value[key]=next; }
    return value;
  }
  private tracked(id: string): AudiobookJob {
    let root: AudiobookJob;
    const nested = new WeakMap<object,any>();
    const changed = (record: AudiobookJob) => { if (!this.restoring) { this.dirtyRecords.set(id,record); this.dirty.set(id,root); } };
    const readProperty = (value: any, key: PropertyKey) => {
      let next=Reflect.get(value,key);
      if (next && typeof next==='object' && '$swissmouseAsset' in next) {
        next=(this.decode(JSON.stringify([{id:'asset',parts:[],value:next}]))[0] as any).value;
        Reflect.set(value,key,next);
      }
      return next;
    };
    const wrap = (value: any, record: AudiobookJob): any => {
      if (!value || typeof value!=='object') return value;
      const cached=nested.get(value); if(cached) return cached;
      // A retained nested reference pins just its active project, so sorting,
      // reordering and in-flight processing keep ordinary JS object identity.
      const proxy=new Proxy(value,{
        get:(target,key)=>wrap(readProperty(target,key),record),
        set:(target,key,next)=>{const raw=this.unwrap(next); if(Reflect.get(target,key)!==raw){changed(record);Reflect.set(target,key,raw);}return true;},
        deleteProperty:(target,key)=>{if(Reflect.has(target,key)){changed(record);Reflect.deleteProperty(target,key);}return true;},
      });
      nested.set(value,proxy); this.raw.set(proxy,()=>value); return proxy;
    };
    root=new Proxy({} as AudiobookJob,{
      get:(_target,key)=>{ if(key==='id') return id; const record=this.record(id); return wrap(readProperty(record,key),record); },
      set:(_target,key,next)=>{const record=this.record(id),raw=this.unwrap(next);if(Reflect.get(record,key)!==raw){changed(record);Reflect.set(record,key,raw);}return true;},
      deleteProperty:(_target,key)=>{const record=this.record(id);if(Reflect.has(record,key)){changed(record);Reflect.deleteProperty(record,key);}return true;},
      has:(_target,key)=>Reflect.has(this.record(id),key),
      ownKeys:()=>Reflect.ownKeys(this.record(id)),
      getOwnPropertyDescriptor:(_target,key)=>Reflect.has(this.record(id),key)?{writable:true,enumerable:true,configurable:true}:undefined,
    });
    this.raw.set(root,()=>this.record(id)); this.live.set(id,new WeakRef(root)); return root;
  }
  private track(job: AudiobookJob) {
    const saved = this.raw.get(job);
    if (saved) return; // Array reordering does not change the project's durable row.
    this.unwrap(job);
    this.external.set(job.id,new WeakRef(job)); this.dirtyRecords.set(job.id,job);
    const value = saved ? job : this.live.get(job.id)?.deref() || this.tracked(job.id);
    this.live.set(job.id,new WeakRef(value)); this.dirty.set(job.id,value);
  }
  get(id: string | undefined): AudiobookJob | undefined {
    if (!id) return;
    let value=this.live.get(id)?.deref();
    if (!value) {
      if (!this.dirtyRecords.has(id) && !this.db.prepare('SELECT 1 FROM project_state WHERE id=? AND deleted=0').get(id)) return;
      value=this.tracked(id);
    }
    this.recent.delete(id); this.recent.set(id,value);
    while (this.recent.size>32) this.recent.delete(this.recent.keys().next().value!);
    // A periodic weak-reference sweep avoids growing with previously visited projects.
    if (this.live.size>1024 && this.live.size%1024===0) for (const [key,ref] of this.live) if (!ref.deref()) { this.live.delete(key); if (!this.resident.get(key)?.deref()) this.resident.delete(key); }
    return value;
  }
  override save(jobs: AudiobookJob[], backup = true): void {
    for (const [id, reference] of this.external) {
      const value = reference.deref(); if (value) this.dirty.set(id, value); else this.external.delete(id);
    }
    if (jobs !== this.collection) {
      const ids = new Set<string>();
      for (const job of jobs) { ids.add(job.id); this.track(job); }
      for (const id of this.ids) if (!ids.has(id)) this.removed.add(id);
      this.ids = [...ids];
    }
    if (this.removed.size) {
      const current = new Set(this.ids);
      for (const id of this.removed) if (current.has(id)) this.removed.delete(id);
    }
    this.transaction(() => {
      const write = this.db.prepare(`INSERT INTO project_state(id,payload,version) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET
        previous=CASE WHEN ? THEN project_state.payload ELSE project_state.previous END,payload=excluded.payload,version=excluded.version,deleted=0`);
      for (const [id, job] of this.dirty) {
        if (this.removed.has(id)) continue;
        const payload = this.encode([(this.raw.get(job)?.() || job) as AudiobookJob]);
        if (this.db.prepare('SELECT 1 FROM project_state WHERE id=? AND payload=? AND deleted=0').get(id, payload)) continue;
        write.run(id, payload, this.nextVersion(), Number(backup));
      }
      for (const id of this.removed) this.db.prepare('UPDATE project_state SET deleted=1,version=? WHERE id=?').run(this.nextVersion(), id);
    });
    for (const id of this.removed) { this.live.delete(id); this.recent.delete(id); this.external.delete(id); this.records.delete(id); this.resident.delete(id); }
    this.dirty.clear(); this.dirtyRecords.clear(); this.removed.clear();
  }
  view() { return this.collection!; }
  adopt(id: string) { const job=this.get(id); this.external.delete(id); return job; }
  /** Roll back only touched records, keeping references held by active operations valid. */
  rollback() {
    this.restoring = true;
    try { for (const [id, job] of this.dirty) {
      const row = this.db.prepare('SELECT payload FROM project_state WHERE id=? AND deleted=0').get(id);
      if (!row) { this.live.delete(id); this.recent.delete(id); this.external.delete(id); this.records.delete(id); this.resident.delete(id); continue; }
      const raw = this.raw.get(job)?.() || job; for (const key of Object.keys(raw)) delete (raw as any)[key];
      Object.assign(raw, this.decode(String(row.payload))[0]);
    } } finally { this.restoring = false; this.dirty.clear(); this.dirtyRecords.clear(); this.removed.clear(); }
    return this.load();
  }
  changes(after: number, limit = 100) {
    return this.db.prepare('SELECT id,version,deleted FROM project_state WHERE version>? ORDER BY version LIMIT ?').all(after, Math.min(500, limit)) as unknown as { id: string; version: number; deleted: number }[];
  }
  version() { return Number(this.db.prepare("SELECT value FROM project_meta WHERE key='version'").get()!.value); }
  *interrupted() {
    for (const row of this.db.prepare(`SELECT id FROM project_state WHERE deleted=0 AND EXISTS (
      SELECT 1 FROM json_each(payload,'$[0].exports') WHERE json_extract(value,'$.status') IN ('running','queued'))`).iterate()) {
      const job = this.get(String(row.id)); if (job) yield job;
    }
  }
  group(ids: string[]) {
    if (!ids.length) return [];
    return this.db.prepare(`SELECT id FROM project_state WHERE deleted=0 AND coalesce(json_extract(payload,'$[0].logicalBookId'),id) IN (${ids.map(()=>'?').join(',')})`)
      .all(...ids).map(row=>this.get(String(row.id))!);
  }
  outputRoots() {
    return this.db.prepare("SELECT DISTINCT json_extract(payload,'$[0].outputFolderPath') AS root FROM project_state WHERE deleted=0").all().map(row => row.root).filter((value): value is string => typeof value === 'string');
  }
  close() { this.db.close(); }
}
