import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { setImmediate } from 'node:timers/promises';
import type { AudiobookJob } from '../src/types';
import { projectCatalogRecord, type CatalogProject } from './catalog-projection';

interface ProjectFeed {
  changes(after: number, limit?: number): { id: string; version: number; deleted: number }[];
  get(id: string): AudiobookJob | undefined;
  version(): number;
}

/** A worker owns SQLite so search, indexing, and bulk selections cannot block playback requests. */
export class CatalogService {
  private worker: Worker;
  private observer: Worker;
  private requests = new Map<number,{ resolve: (value: any) => void; reject: (error: Error) => void }>();
  private nextId = 0;
  private requested = 1;
  private completed = 0;
  private refreshFiles = true;
  private syncing?: Promise<void>;
  private failure?: Error;
  private timer?: ReturnType<typeof setTimeout>;
  private informationRetry?: ReturnType<typeof setTimeout>;
  private informationRetryDelay = 1000;
  private informationState?: any;
  private closing = false;
  private async publishInformation() {
    if (process.env.SWISSMOUSE_INFORMATION_DURABLE !== '1' || this.failure || this.closing) return;
    while (!this.closing) {
      const status = await this.call<any>('informationAdvance');
      if (this.closing) return;
      const previousError = this.informationState?.error; this.informationState = status;
      if (status.error) {
        if (status.error !== previousError) this.warning(`Information publication pending: ${status.error}`);
        if (!this.informationRetry) {
          this.informationRetry = setTimeout(() => { this.informationRetry = undefined; void this.publishInformation().catch(error => this.warning(`Information retry failed: ${error.message}`)); }, this.informationRetryDelay);
          this.informationRetryDelay = Math.min(30000, this.informationRetryDelay * 2);
        }
        return;
      }
      if (!status.enabled || (!status.dirty && !status.outbox && !status.pendingProjection && !status.pendingDirectory)) {
        if (this.informationRetry) clearTimeout(this.informationRetry); this.informationRetry = undefined; this.informationRetryDelay = 1000; return;
      }
      await setImmediate();
    }
  }
  constructor(file: string, private source: () => AudiobookJob[], private project: (job: AudiobookJob) => CatalogProject = projectCatalogRecord, private warning: (message: string) => void = console.warn, workerFile?: string, private feed?: ProjectFeed) {
    const entry = path.resolve(process.argv[1]);
    this.worker = new Worker(workerFile || path.join(path.dirname(entry),entry.endsWith('.ts') ? 'dist/catalog-worker.cjs' : 'catalog-worker.cjs'), { workerData: { file } });
    this.observer = new Worker(workerFile || path.join(path.dirname(entry),entry.endsWith('.ts') ? 'dist/catalog-worker.cjs' : 'catalog-worker.cjs'), { workerData: { observe: true } });
    const receive = ({ id,result,error }: any) => {
      const request = this.requests.get(id); if (!request) return;
      this.requests.delete(id); error ? request.reject(new Error(error)) : request.resolve(result);
    };
    this.worker.on('message', receive); this.observer.on('message', receive);
    const fail = (error: Error) => { this.failure = error; for (const request of this.requests.values()) request.reject(error); this.requests.clear(); this.warning(`Catalog unavailable: ${error.message}`); };
    this.worker.on('error',fail);
    this.observer.on('error',fail);
    this.worker.on('exit',code => { if (code !== 0) fail(new Error(`Catalog worker stopped (${code}).`)); });
    if (feed) this.refreshFiles = false;
    this.invalidate();
  }
  call<T = any>(method: string, ...args: unknown[]): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.nextId;
    return new Promise((resolve,reject) => { this.requests.set(id,{ resolve,reject }); (method === 'observe' ? this.observer : this.worker).postMessage({ id,method,args }); });
  }
  invalidate(refreshFiles = false) {
    this.refreshFiles ||= refreshFiles;
    this.requested++;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.ready().catch(error => this.warning(`Catalog indexing failed: ${error.message}`)); },100);
  }
  async ready(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.syncing) { await this.syncing; if (this.completed < this.requested) return this.ready(); return; }
    if (this.completed >= this.requested) return;
    this.syncing = (async () => {
      while (this.completed < this.requested) {
        const revision = this.requested, refreshFiles = this.refreshFiles;
        this.refreshFiles = false;
        if (this.feed) {
          let checkpoint = refreshFiles ? 0 : await this.call<number>('checkpoint');
          // Project changes and removals are durable. A crash before this ack
          // replays a bounded batch; a crash after it resumes with the next one.
          while (true) {
            const changes = this.feed.changes(checkpoint, 100); if (!changes.length) break;
            const records = changes.filter(item => !item.deleted).map(item => this.feed!.get(item.id)).filter((job): job is AudiobookJob => !!job).map(job => JSON.parse(JSON.stringify({ ...this.project(job), stateVersion:this.feed!.version() })));
            checkpoint = changes.at(-1)!.version;
            const observed = await this.call('observe', records);
            await this.call('applyChanges', observed, changes.filter(item => item.deleted).map(item => item.id), checkpoint);
            await this.publishInformation();
            await this.call('maintainMatches');
            await setImmediate();
          }
          while (true) { const work = await this.call('maintainMatches'); if (!work.pending || work.full) break; await setImmediate(); }
          await this.publishInformation();
          this.completed = revision;
          continue;
        }
        const jobs = this.source();
        const generation = await this.call<number>('beginSync');
        for (let start = 0; start < jobs.length; start += 200) {
          await this.call('upsertProjects',jobs.slice(start,start+200).map(job => JSON.parse(JSON.stringify(this.project(job)))),generation,refreshFiles);
          await setImmediate();
        }
        await this.call('endSync',generation); this.completed = revision;
        await this.publishInformation();
      }
    })();
    try { await this.syncing; } finally { this.syncing = undefined; }
  }
  /** Publish a user edit without waiting for a whole-library reconciliation. */
  async publish(ids: string[]) {
    if (!this.feed) { await this.ready(); return; }
    for (let offset=0;offset<ids.length;offset+=100) {
      const records=ids.slice(offset,offset+100).map(id=>this.feed!.get(id)).filter((job):job is AudiobookJob=>!!job)
        .map(job=>JSON.parse(JSON.stringify({...this.project(job),stateVersion:this.feed!.version()})));
      const observed=await this.call('observe',records);
      // Publishing an edit must not skip older, still-unindexed changes.
      await this.call('applyChanges',observed,[],0);
    }
    await this.call('maintainMatches');
    await this.publishInformation();
  }
  status() { return { indexing: this.completed < this.requested, error: this.failure?.message, ...(this.informationState ? { information: this.informationState } : {}) }; }
  async close() { this.closing = true; if (this.timer) clearTimeout(this.timer); if (this.informationRetry) clearTimeout(this.informationRetry); await Promise.all([this.worker.terminate(), this.observer.terminate()]); }
}
