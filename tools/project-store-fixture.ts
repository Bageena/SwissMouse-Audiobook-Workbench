import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DurableProjectStore } from './durable-project-store';
import { ProjectStore, cloneProject } from './project-store';
import type { AudiobookJob } from '../src/types';

/** Integration fixtures inspect the authoritative store, including large assets. */
export function readProjectState(root: string): AudiobookJob[] {
  const file=path.join(root,'jobs.json');
  if (!fs.existsSync(file+'.sqlite')) return new ProjectStore(file).load();
  const store=new DurableProjectStore(file);
  try { return cloneProject(store.load()); } finally { store.close(); }
}
/** Use only while the fixture server is stopped. */
export function writeProjectState(root: string, jobs: AudiobookJob[]) {
  const file=path.join(root,'jobs.json');
  if (!fs.existsSync(file+'.sqlite')) { fs.writeFileSync(file,JSON.stringify(jobs)); return; }
  const store=new DurableProjectStore(file);
  try { store.load(); store.save(jobs); } finally { store.close(); }
}
/** Fault injection targets actual SQLite commits instead of the retired manifest. */
export function rejectProjectWrites(root: string) {
  const db=new DatabaseSync(path.join(root,'jobs.json.sqlite'));
  for (const operation of ['INSERT','UPDATE','DELETE']) db.exec(`CREATE TRIGGER fixture_reject_${operation} BEFORE ${operation} ON project_state BEGIN SELECT RAISE(ABORT,'Fixture project write failed'); END`);
  db.close();
  return () => { const db=new DatabaseSync(path.join(root,'jobs.json.sqlite')); for(const operation of ['INSERT','UPDATE','DELETE']) db.exec(`DROP TRIGGER fixture_reject_${operation}`); db.close(); };
}
