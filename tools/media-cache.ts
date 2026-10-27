import fs from 'node:fs/promises';
import { pathKey } from './library-filesystem';

// Cache observations, never membership or user metadata. Changes, replacements,
// and failed probes invalidate observations; concurrency and retained size are bounded.
export class MediaCache<T> {
  private cache = new Map<string, { signature: string; value: T }>();
  private pending = new Map<string, Promise<T>>();
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private probe: (tool: string, file: string) => Promise<T>, private limit = 2, private capacity = 1000) {}
  private async signature(file: string) {
    const info = await fs.stat(file);
    return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':');
  }
  async read(tool: string, file: string): Promise<T> {
    const key = tool + ':' + pathKey(file), signature = await this.signature(file);
    const cached = this.cache.get(key);
    if (cached?.signature === signature) {
      this.cache.delete(key); this.cache.set(key, cached); return structuredClone(cached.value);
    }
    const pendingKey = key + ':' + signature;
    let pending = this.pending.get(pendingKey);
    if (!pending) {
      pending = this.measure(tool, file).then(async value => {
        if (await this.signature(file) !== signature) throw new Error('Audio changed during inspection. Refresh and try again.');
        this.cache.delete(key); this.cache.set(key, { signature, value });
        while (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
        return value;
      }).finally(() => this.pending.delete(pendingKey));
      this.pending.set(pendingKey, pending);
    }
    return structuredClone(await pending);
  }
  private async measure(tool: string, file: string) {
    if (this.active >= this.limit) await new Promise<void>(resolve => this.queue.push(resolve));
    else this.active++;
    try { return await this.probe(tool, file); }
    finally { const next = this.queue.shift(); if (next) next(); else this.active--; }
  }
}
