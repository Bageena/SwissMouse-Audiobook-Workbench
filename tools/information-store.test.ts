import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import type { InformationPublication } from '../packages/sdk/information-publication';
import { coreInformationBundle } from '../src/core/information-builtins';
import { InformationStore } from './information-store';
import { InformationProjection } from './information-projection';
import { CatalogStore } from './catalog-store';
import { createTestFixture } from './test-fixtures.mjs';
const event = (version = 1, title = 'Saved item'): InformationPublication => ({ sourceId: 'core.fixture', epoch: 'epoch-a', version, retired: false, aliases: [{ namespace: 'core:fixture', key: 'old-id' }],
    item: { descriptor: { id: 'existing-resource-id', kind: 'core.item', typeIds: ['core.item'], owner: 'core', title, revision: 0, revisionScope: 'catalog-snapshot', archived: false }, fields: { 'core.title': title }, relationships: [], memberships: [], omitted: [] } });
function fixture(t: {
    after: (callback: () => void) => void;
}) {
    const f = createTestFixture('.cache/information-store-');
    const file = path.join(f.root, 'catalog.sqlite.user.sqlite');
    let store = new InformationStore(file);
    store.registerDefinitions([coreInformationBundle]);
    store.startEpoch('core.fixture', 'core', 'epoch-a');
    t.after(() => { store.close(); f.cleanup(); });
    return { root: f.root, file, get store() { return store; }, reopen: () => { store.close(); store = new InformationStore(file); return store; } };
}
test('authoritative publication, alias, receipt and revision survive reopen and exact replay', t => {
    const f = fixture(t);
    assert.deepEqual(f.store.publish([event()]), { applied: 1, replayed: 0 });
    f.reopen();
    assert.deepEqual(f.store.publish([event()]), { applied: 0, replayed: 1 });
    const item = f.store.get('existing-resource-id')!;
    assert.equal(item.item.descriptor.id, 'existing-resource-id');
    assert.equal(item.item.descriptor.revision, 1);
    assert.equal(item.item.descriptor.revisionScope, 'resource');
    assert.equal(f.store.db.prepare('SELECT resource_id FROM aliases WHERE source_key=?').get('old-id')!.resource_id, 'existing-resource-id');
    f.store.publish([event(2)]);
    assert.equal(f.store.get('existing-resource-id')!.item.descriptor.revision, 1, 'a replayed observation does not manufacture an edit');
});

test('a partially missing derived projection cannot silently keep a completed checkpoint', t => {
    const f = fixture(t), db = new DatabaseSync(':memory:');
    try {
        f.store.publish([event()]);
        const projection = new InformationProjection(db, f.store); projection.advance();
        db.exec('DROP TABLE information_index');
        assert.throws(() => new InformationProjection(db, f.store), /Incomplete information projection/);
        assert.equal(f.store.get('existing-resource-id')!.item.descriptor.title, 'Saved item');
    } finally { db.close(); }
});
test('gaps, conflicting replays, alias collisions and a failed batch leave checkpoint and saved data unchanged', t => {
    const f = fixture(t);
    f.store.publish([event()]);
    assert.throws(() => f.store.publish([event(3)]), /gap/);
    assert.throws(() => f.store.publish([event(1, 'Conflicting')]), /Conflicting/);
    const conflicting = event(2);
    conflicting.aliases = [{ namespace: 'core:fixture', key: 'owned-elsewhere' }];
    f.store.db.prepare('INSERT INTO aliases VALUES(?,?,?)').run('core:fixture', 'owned-elsewhere', 'another-resource');
    assert.throws(() => f.store.publish([conflicting]), /Alias identity conflict/);
    assert.throws(() => f.store.publish([event(2, 'Would change'), event(4, 'Gap')]), /gap/);
    assert.equal(f.store.source('core.fixture')!.checkpoint, 1);
    assert.equal(f.store.get('existing-resource-id')!.item.descriptor.title, 'Saved item');
    assert.equal(f.store.changes(0).length, 1);
});
test('tombstones and epoch rotation cannot be undone by delayed old events', t => {
    const f = fixture(t);
    f.store.publish([event()]);
    const retired = event(2);
    retired.retired = true;
    f.store.publish([retired]);
    f.reopen();
    assert.equal(f.store.get('existing-resource-id')!.item.descriptor.archived, true);
    assert.throws(() => f.store.startEpoch('core.fixture', 'core', 'epoch-b', 'wrong-previous'), /conflict/);
    f.store.startEpoch('core.fixture', 'core', 'epoch-b', 'epoch-a');
    assert.throws(() => f.store.publish([event(3, 'Old epoch')]), /epoch/);
    assert.throws(() => f.store.startEpoch('core.fixture', 'core', 'epoch-a', 'epoch-b'), /retired epoch/);
    const fresh = event(1, 'Explicitly restored');
    fresh.epoch = 'epoch-b';
    f.store.publish([fresh]);
    assert.equal(f.store.get('existing-resource-id')!.retired, false);
    assert.equal(f.store.get('existing-resource-id')!.item.descriptor.revision, 3);
});
test('Core-only projection reconstructs fields, labels and tombstones without any module adapter', async (t) => {
    const f = fixture(t);
    f.store.publish([event()]);
    const retired = event(2);
    retired.retired = true;
    f.store.publish([retired]);
    f.reopen();
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    const index = new InformationProjection(db, f.store);
    while (index.advance().pending) { /* bounded replay */ }
    assert.equal(index.page().items.length, 0);
    assert.equal(index.page({ includeRetired: true }).items[0].fields['core.title'], 'Saved item');
    assert.ok(f.store.definitions().some(d => d.id === 'core.item'));
    const before = index.checkpoint();
    index.reset();
    while (index.advance(1).pending) { /* bounded rebuild */ }
    assert.equal(index.checkpoint(), before);
    const graph = await build({ entryPoints: ['tools/information-store.ts', 'tools/information-projection.ts'], bundle: true, platform: 'node', write: false, metafile: true, outdir: '.cache/information-core-proof' });
    assert.equal(Object.keys(graph.metafile!.inputs).some(file => /audiobook|catalog-store|transcription|react/i.test(file)), false);
});
test('a failed index transaction rolls back its checkpoint and can safely replay', t => {
    const f = fixture(t);
    f.store.publish([event()]);
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    const index = new InformationProjection(db, f.store);
    db.exec("CREATE TRIGGER fail_projection BEFORE INSERT ON information_index BEGIN SELECT RAISE(ABORT,'fixture index failure'); END;");
    assert.throws(() => index.advance(), /fixture index failure/);
    assert.equal(index.checkpoint(), 0);
    assert.equal(index.page().items.length, 0);
    db.exec('DROP TRIGGER fail_projection');
    index.advance();
    assert.equal(index.page().items.length, 1);
});
test('bounded projection replay never publishes future payloads ahead of its checkpoint', t => {
    const f = fixture(t);
    f.store.publish([event(1, 'Before'), event(2, 'After')]);
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    const index = new InformationProjection(db, f.store);
    index.advance(1);
    assert.equal(index.page().items[0].descriptor.title, 'Before');
    index.advance(1);
    assert.equal(index.page().items[0].descriptor.title, 'After');
    f.store.db.prepare('UPDATE information_changes SET chain=? WHERE seq=2').run('restored-branch');
    assert.throws(() => index.page(), /does not match/);
    assert.throws(() => index.advance(), /does not match/);
    index.reset();
    index.advance();
    assert.equal(index.page().items[0].descriptor.title, 'After');
});
test('foreign and future user schemas are refused before a catalog is created or changed', t => {
    const f = createTestFixture('.cache/information-schema-');
    t.after(() => f.cleanup());
    const catalog = path.join(f.root, 'catalog.sqlite');
    const user = new DatabaseSync(catalog + '.user.sqlite');
    user.exec('CREATE TABLE foreign_data(value TEXT);');
    user.close();
    const digest = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const before = digest(catalog + '.user.sqlite');
    assert.throws(() => new CatalogStore(catalog), /Unrecognized/);
    assert.equal(fs.existsSync(catalog), false);
    assert.equal(digest(catalog + '.user.sqlite'), before);
    const foreign = new DatabaseSync(catalog + '.user.sqlite');
    foreign.exec('PRAGMA user_version=99;');
    foreign.close();
    const future = digest(catalog + '.user.sqlite');
    assert.throws(() => new CatalogStore(catalog), /Unsupported user database schema/);
    assert.equal(digest(catalog + '.user.sqlite'), future);
    assert.equal(fs.existsSync(catalog), false);
});
test('legacy WAL data has a verified backup and companion snapshot before schema changes', t => {
    const f = createTestFixture('.cache/information-migration-');
    t.after(() => f.cleanup());
    const catalog = path.join(f.root, 'catalog.sqlite');
    const old = new CatalogStore(catalog);
    old.close();
    const writer = new DatabaseSync(catalog + '.user.sqlite');
    writer.exec("PRAGMA journal_mode=WAL; INSERT INTO aliases VALUES('core:fixture','wal-source','res_stable'); INSERT INTO collections VALUES('shelf','Keep shelf');");
    const migrated = new InformationStore(catalog + '.user.sqlite', () => { }, [catalog]);
    try {
        assert.equal(migrated.db.prepare('PRAGMA user_version').get()!.user_version, 1);
        assert.equal(migrated.db.prepare('SELECT name FROM collections').get()!.name, 'Keep shelf');
        const manifestFile = fs.readdirSync(f.root).find(name => name.endsWith('.bak.json'))!;
        assert.ok(manifestFile);
        const manifest = JSON.parse(fs.readFileSync(path.join(f.root, manifestFile), 'utf8'));
        assert.equal(manifest.counts.aliases, 1);
        assert.equal(manifest.companions.length, 1);
        assert.equal(createHash('sha256').update(fs.readFileSync(manifest.backup)).digest('hex'), manifest.sha256);
        const backup = new DatabaseSync(manifest.backup, { readOnly: true });
        try {
            assert.equal(backup.prepare('PRAGMA user_version').get()!.user_version, 0);
            assert.equal(backup.prepare('SELECT resource_id FROM aliases').get()!.resource_id, 'res_stable');
        }
        finally {
            backup.close();
        }
    }
    finally {
        migrated.close();
        writer.close();
    }
});
test('failed migration DDL retains legacy rows/version and leaves recovery material', t => {
    const f = createTestFixture('.cache/information-migration-fail-');
    t.after(() => f.cleanup());
    const catalog = path.join(f.root, 'catalog.sqlite');
    const old = new CatalogStore(catalog);
    old.close();
    const originalExec = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function (sql: string) { if (/CREATE INDEX (IF NOT EXISTS )?information_alias_resource/.test(sql))
        throw new Error('Injected migration failure'); return originalExec.call(this, sql); };
    try {
        assert.throws(() => new InformationStore(catalog + '.user.sqlite'), /Injected migration failure/);
    }
    finally {
        DatabaseSync.prototype.exec = originalExec;
    }
    const user = new DatabaseSync(catalog + '.user.sqlite', { readOnly: true });
    try {
        assert.equal(user.prepare('PRAGMA user_version').get()!.user_version, 0);
        assert.equal(user.prepare("SELECT 1 FROM sqlite_master WHERE name='information_resources'").get(), undefined);
    }
    finally {
        user.close();
    }
    assert.ok(fs.readdirSync(f.root).some(name => name.endsWith('.bak.json')));
});
