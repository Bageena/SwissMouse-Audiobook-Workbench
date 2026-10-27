import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { AudiobookJob } from '../src/types';
import { replaceFileAtomically } from './atomic-file';

/** Project records are JSON data; this also accepts lazily loaded project views. */
export function cloneProject<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

export function parseProjects(text: string): AudiobookJob[] {
  const value = JSON.parse(text);
  if (!Array.isArray(value) || value.some(job => !job || typeof job.id !== 'string' || !Array.isArray(job.parts)) ||
      new Set(value.map(job => job.id)).size !== value.length) throw new Error('Invalid project store.');
  return value;
}

// All project writes use the same atomic replacement, including draft autosaves.
// The backup is the previous successful save, never an unvalidated disk file.
export class ProjectStore {
  private committed?: string;
  private strings = new Map<string, string>();
  private remember(value: string, hash: string) {
    if (value.length > 1024 * 1024) return;
    this.strings.set(value,hash);
    while (this.strings.size > 8) this.strings.delete(this.strings.keys().next().value!);
  }
  private readonly assets: string;
  constructor(readonly file: string, private warning: (message: string) => void = () => {}) {
    this.assets = file + '.assets';
  }

  // Immutable, content-addressed payloads keep frequent metadata/progress saves
  // small. Publish and fsync assets before publishing a manifest that uses them.
  // Retain old assets: both the backup and interrupted transactions may need them.
  protected encode(jobs: AudiobookJob[]): string {
    return JSON.stringify(jobs, (key, value) => {
      const largeString = typeof value === 'string' && value.length >= 16384;
      const transcript = (key === 'transcriptWords' || key === 'transcriptSegments') && Array.isArray(value) && value.length >= 1000;
      if (!largeString && !transcript) return value;
      let hash = largeString ? this.strings.get(value) : undefined;
      if (!hash) {
        const text = JSON.stringify(value);
        hash = createHash('sha256').update(text).digest('hex');
        fs.mkdirSync(this.assets, { recursive: true });
        const target = path.join(this.assets, hash + '.json');
        if (!fs.existsSync(target)) this.replace(target, text);
        if (largeString) this.remember(value, hash);
      }
      return { $swissmouseAsset: hash };
    });
  }

  protected decode(text: string): AudiobookJob[] {
    // Validate the project envelope separately from resolving payload references.
    parseProjects(text);
    return JSON.parse(text, (_key, value) => {
      if (!value || typeof value !== 'object' || !('$swissmouseAsset' in value)) return value;
      const hash = value.$swissmouseAsset;
      if (Object.keys(value).length !== 1 || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid project asset reference.');
      const content = fs.readFileSync(path.join(this.assets, hash + '.json'), 'utf8');
      if (createHash('sha256').update(content).digest('hex') !== hash) throw new Error('Project asset checksum mismatch.');
      const decoded = JSON.parse(content);
      if (typeof decoded === 'string') this.remember(decoded, hash);
      return decoded;
    });
  }

  load(): AudiobookJob[] {
    if (!fs.existsSync(this.file) && !fs.existsSync(this.file + '.bak')) { this.committed = '[]'; return []; }
    try {
      const text = fs.readFileSync(this.file, 'utf8');
      const jobs = this.decode(text);
      this.committed = text;
      return jobs;
    } catch (error: any) {
      let text: string;
      try { text = fs.readFileSync(this.file + '.bak', 'utf8'); this.decode(text); }
      catch { throw new Error(`Cannot load ${this.file}: ${error.message}. No valid backup is available. The original store was preserved; restore it before restarting.`); }
      const recovery = `${this.file}.corrupt-${Date.now()}-${randomUUID()}`;
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, recovery, fs.constants.COPYFILE_EXCL);
      this.replace(this.file, text);
      this.committed = text;
      this.warning(`Recovered projects from ${this.file}.bak. The damaged store was retained at ${recovery}.`);
      return this.decode(text);
    }
  }

  snapshot(): AudiobookJob[] { return this.decode(this.committed || '[]'); }

  save(jobs: AudiobookJob[], backup = true): void {
    const text = this.encode(jobs);
    if (text === this.committed) return;
    if (backup && this.committed !== undefined) this.replace(this.file + '.bak', this.committed);
    this.replace(this.file, text);
    this.committed = text;
  }

  private replace(target: string, text: string): void {
    replaceFileAtomically(target, text);
  }
}
