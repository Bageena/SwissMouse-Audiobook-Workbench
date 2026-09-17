// Share in-flight work and expire snapshots on demand; no background polling.
export class StatusCache<T> {
  private value?: T;
  private expires = 0;
  private pending?: Promise<T>;
  private generation = 0;
  constructor(private ttlMs: number) {}
  invalidate() { this.generation++; this.expires = 0; this.pending = undefined; }
  refresh(load: () => Promise<T>): Promise<T> {
    if (this.pending) return this.pending;
    this.invalidate();
    return this.get(load);
  }
  get(load: () => Promise<T>): Promise<T> {
    if (this.pending) return this.pending;
    if (this.expires > Date.now()) return Promise.resolve(this.value!);
    const generation = this.generation;
    const pending = load().then(value => {
      if (generation === this.generation) { this.value = value; this.expires = Date.now() + this.ttlMs; }
      return value;
    }).finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending;
    return pending;
  }
}
