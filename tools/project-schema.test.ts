import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DurableProjectStore } from './durable-project-store';
import { PROJECT_SCHEMA_VERSION } from './project-schema';

function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-schema-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file: path.join(root, 'jobs.json') };
}

test('new databases distinguish schema version from record revisions', t => {
  const { file } = fixture(t), store = new DurableProjectStore(file);
  try { store.load(); assert.equal(store.version(), 0); assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, PROJECT_SCHEMA_VERSION); }
  finally { store.close(); }
});

test('unversioned database migration snapshots WAL data and preserves previous payloads and tombstones', t => {
  const { file, root } = fixture(t);
  const old = new DatabaseSync(file + '.sqlite');
  old.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE project_state(id TEXT PRIMARY KEY,payload TEXT NOT NULL,previous TEXT,version INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE project_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
    INSERT INTO project_meta VALUES('version',7),('migrated',1);`);
  const saved = JSON.stringify([{ id: 'book', parts: [], metadataDraft: { title: 'Unfinished' }, personalRating: 4 }]);
  old.prepare('INSERT INTO project_state VALUES(?,?,?,?,?)').run('book', saved, 'previous sentinel', 6, 0);
  old.prepare('INSERT INTO project_state VALUES(?,?,?,?,?)').run('deleted', '[{"id":"deleted","parts":[]}]', null, 7, 1);
  let migrated: DurableProjectStore | undefined;
  try {
    migrated = new DurableProjectStore(file); migrated.load();
    assert.equal(migrated.version(), 7); assert.equal(migrated.get('book')!.metadataDraft!.title, 'Unfinished');
    assert.equal(migrated.get('deleted'), undefined);
    const backups = fs.readdirSync(root).filter(name => name.endsWith('.bak')); assert.equal(backups.length, 1);
    const backup = new DatabaseSync(path.join(root, backups[0]), { readOnly: true });
    try {
      assert.equal(backup.prepare('PRAGMA user_version').get()!.user_version, 0);
      assert.deepEqual(backup.prepare('SELECT * FROM project_state ORDER BY id').all(), migrated.db.prepare('SELECT * FROM project_state ORDER BY id').all());
    } finally { backup.close(); }
    migrated.close(); migrated = new DurableProjectStore(file);
    assert.equal(fs.readdirSync(root).filter(name => name.endsWith('.bak')).length, 1, 'current schemas do not repeatedly back up');
  } finally { migrated?.close(); old.close(); }
});

test('future schema is refused without changing database bytes or creating replacement data', t => {
  const { file, root } = fixture(t), db = new DatabaseSync(file + '.sqlite');
  db.exec(`PRAGMA user_version=${PROJECT_SCHEMA_VERSION + 1}; CREATE TABLE future(data TEXT); INSERT INTO future VALUES('keep');`); db.close();
  const bytes = fs.readFileSync(file + '.sqlite'), names = fs.readdirSync(root);
  assert.throws(() => new DurableProjectStore(file), /newer compatible SwissMouse/);
  assert.deepEqual(fs.readFileSync(file + '.sqlite'), bytes); assert.deepEqual(fs.readdirSync(root), names);
});

test('backup failure aborts migration before schema changes', t => {
  const { file } = fixture(t), initial = new DurableProjectStore(file); initial.load(); initial.db.exec('PRAGMA user_version=0'); initial.close();
  const prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) {
    if (sql === 'VACUUM INTO ?') throw new Error('simulated disk full');
    return prepare.call(this, sql);
  });
  assert.throws(() => new DurableProjectStore(file), /disk full/);
  const db = new DatabaseSync(file + '.sqlite', { readOnly: true });
  try { assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 0); } finally { db.close(); }
});

test('manual stopped-folder backup restores drafts, membership and large assets', t => {
  const { file, root } = fixture(t), store = new DurableProjectStore(file), jobs = store.load();
  const words = Array.from({ length: 1200 }, (_, i) => ({ word: `word ${i}`, start: i, end: i + 1 }));
  jobs.push({ id: 'book', name: 'Book', parts: [{ id: 'part', name: 'book.m4b', order: 1 }], metadataDraft: { title: 'Draft' }, sourceMembership: 'confirmed', personalRating: 5, transcriptWords: words } as any);
  store.save(jobs); store.close();
  const target = path.join(root, 'restored'); fs.mkdirSync(target);
  for (const name of fs.readdirSync(root).filter(name => name.startsWith('jobs.json'))) fs.cpSync(path.join(root, name), path.join(target, name), { recursive: true });
  const restored = new DurableProjectStore(path.join(target, 'jobs.json'));
  try {
    restored.load(); const book = restored.get('book')!;
    assert.equal(book.metadataDraft!.title, 'Draft'); assert.equal(book.parts[0].id, 'part');
    assert.equal(book.sourceMembership, 'confirmed'); assert.equal(book.personalRating, 5); assert.deepEqual(book.transcriptWords, words);
  } finally { restored.close(); }
});
