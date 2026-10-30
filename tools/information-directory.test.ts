import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { createTestFixture } from './test-fixtures.mjs';
import { InformationStore } from './information-store';
import { InformationDirectory } from './information-directory';
import { InformationTerms } from './information-terms';
import { valueKey, equalityKey, searchKey } from './information-history';
import { coreInformationBundle } from '../src/core/information-builtins';
import { audiobookInformationBundle } from '../packages/audiobooks/src/information';
import type { InformationPublication } from '../packages/sdk/information-publication';
import type { SelectionCommit } from '../packages/sdk/suggestions';
import { DurableProjectStore } from './durable-project-store';
const providerId = 'audiobooks.suggest-series', fieldId = 'audiobooks.series';
function fixture(t: any) {
    const f = createTestFixture('.cache/directory-'), old = process.env.SWISSMOUSE_INFORMATION_DIRECTORY;
    process.env.SWISSMOUSE_INFORMATION_DIRECTORY = '1';
    let store: InformationStore;
    try {
        store = new InformationStore(path.join(f.root, 'user.sqlite'));
    }
    finally {
        if (old === undefined)
            delete process.env.SWISSMOUSE_INFORMATION_DIRECTORY;
        else
            process.env.SWISSMOUSE_INFORMATION_DIRECTORY = old;
    }
    store.registerDefinitions([coreInformationBundle, audiobookInformationBundle]);
    store.startEpoch('audiobooks.fixture', 'audiobooks', 'epoch');
    const db = new DatabaseSync(':memory:'), directory = new InformationDirectory(db, store, [{ providerId, contextFieldIds: ['audiobooks.authors'] }]);
    t.after(() => { db.close(); store.close(); f.cleanup(); });
    let version = 0;
    return { root: f.root, store, db, directory, publish: (id: string, series: string, authors = ['Doe, Jane'], retired = false) => {
            const event: InformationPublication = { sourceId: 'audiobooks.fixture', epoch: 'epoch', version: ++version, retired, aliases: [], item: { descriptor: { id, kind: 'core.work', owner: 'audiobooks', typeIds: ['core.work', 'audiobooks.book'], title: id, revision: 0, revisionScope: 'catalog-snapshot', archived: retired }, fields: { 'audiobooks.series': series, 'audiobooks.authors': authors }, relationships: [], memberships: [], omitted: [] } };
            store.publish([event]);
            while (directory.advance().pending) { }
            ;
        } };
}
const request = (query = '', extra: object = {}) => ({ providerId, fieldId, query, limit: 20, ...extra });
const commit = (value: string, time = 100): SelectionCommit => ({ receipt: randomUUID(), providerId, fieldId, value, label: value, key: valueKey(providerId, fieldId, value), valueKind: 'text', contextResourceIds: ['book-a'], committedAt: time });
test('directory searches the full universe, pages deterministically and separates accent search from equality', t => {
    const f = fixture(t);
    for (let i = 0; i < 140; i++)
        f.publish('book-' + i, 'A series ' + String(i).padStart(3, '0'));
    f.publish('late', 'Zyzzyva');
    f.publish('accent', 'José');
    f.publish('plain', 'Jose');
    f.publish('contains', 'The Hidden Needle');
    f.publish('emoji', 'Series 😀');
    assert.ok(f.directory.query(request('Series ')).items.some(item => item.value === 'Series 😀'));
    assert.equal(f.directory.query(request('Zyz')).items[0].value, 'Zyzzyva');
    const accents = f.directory.query(request('Jose')).items;
    assert.equal(accents.length, 2);
    assert.notEqual(accents[0].key, accents[1].key);
    assert.notEqual(equalityKey('José'), equalityKey('Jose'));
    assert.equal(searchKey('José'), searchKey('Jose'));
    assert.equal(f.directory.query(request('Needle')).items[0].reason, 'match');
    assert.equal(f.directory.query(request('ed')).items.length, 0);
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
        const page = f.directory.query(request('A series', { limit: 7, ...(cursor ? { cursor } : {}) }));
        ids.push(...page.items.map(i => i.key));
        cursor = page.nextCursor;
    } while (cursor);
    assert.equal(ids.length, 140);
    assert.equal(new Set(ids).size, 140);
    assert.equal(f.directory.query(request('Jose', { selectedKeys: [valueKey(providerId, fieldId, 'Zyzzyva')] })).selected[0].value, 'Zyzzyva');
    assert.throws(() => f.directory.query(request('x', { profile: 'someone-else' })), /parameter/);
});
test('observed author context changes independently from actual saved selection history', t => {
    const f = fixture(t);
    f.publish('book-a', 'First', ['Author']);
    f.publish('book-b', 'Second', ['Author']);
    let page = f.directory.query(request('', { contextResourceIds: ['book-a'] }));
    assert.ok(page.items.every(i => i.reason === 'related'));
    assert.equal(f.directory.history.recent(providerId, fieldId).length, 0);
    const saved = commit('Second');
    f.directory.history.record(saved);
    assert.equal(f.directory.history.record({ ...saved, committedAt: 200 }).replayed, true);
    assert.equal(f.directory.history.recent(providerId, fieldId)[0].uses, 1);
    assert.throws(() => f.directory.history.record({ ...saved, value: 'Changed' }), /provider/);
    f.publish('book-b', 'Second', ['Different']);
    page = f.directory.query(request('', { contextResourceIds: ['book-a'] }));
    assert.equal(page.items.find(i => i.value === 'Second')!.reason, 'recent');
    f.directory.history.clear();
    page = f.directory.query(request('', { contextResourceIds: ['book-a'] }));
    assert.ok(!page.items.some(i => i.value === 'Second'));
    assert.equal(f.directory.history.record(saved).replayed, true);
    assert.equal(f.directory.history.recent(providerId, fieldId).length, 0, 'old receipt must not repopulate cleared history');
});
test('history keeps fifty distinct values, survives index loss and does not infer selections from observations', t => {
    const f = fixture(t);
    for (let i = 0; i < 60; i++)
        f.directory.history.record(commit('Choice ' + i, i));
    assert.equal(f.directory.history.recent(providerId, fieldId).length, 50);
    const fresh = new DatabaseSync(':memory:');
    try {
        const rebuilt = new InformationDirectory(fresh, f.store, [{ providerId, contextFieldIds: ['audiobooks.authors'] }]);
        assert.equal(rebuilt.query(request()).items.length, 20);
        assert.equal(rebuilt.query(request()).items[0].value, 'Choice 59');
    }
    finally {
        fresh.close();
    }
});
test('global history eviction stays within the current host profile', t => {
    const f = fixture(t), db = f.store.db;
    const insert = db.prepare('INSERT INTO information_history VALUES(?,?,?,?,?,?,?,?,?,?)');
    db.exec('BEGIN');
    for (let i = 0; i < 5010; i++)
        insert.run('local-default', 'fixture.provider-' + i, 'fixture.field', 'key-' + i, 'Label', 'Value', 'text', i, 1, '[]');
    insert.run('other-profile', 'fixture.provider', 'fixture.field', 'private', 'Private', 'Private', 'text', 0, 1, '[]');
    db.exec('COMMIT');
    f.directory.history.record(commit('Newest', 6000));
    assert.equal(db.prepare("SELECT count(*) n FROM information_history WHERE profile='local-default'").get()!.n, 5000);
    f.directory.history.clear();
    assert.equal(db.prepare("SELECT count(*) n FROM information_history WHERE profile='other-profile'").get()!.n, 1);
});
test('directory schema upgrade snapshots version one and failed version-two DDL rolls back', t => {
    const f = createTestFixture('.cache/directory-migration-');
    t.after(() => f.cleanup());
    const file = path.join(f.root, 'user.sqlite');
    let store = new InformationStore(file);
    store.registerDefinitions([coreInformationBundle]);
    store.close();
    const previous = process.env.SWISSMOUSE_INFORMATION_DIRECTORY;
    process.env.SWISSMOUSE_INFORMATION_DIRECTORY = '1';
    const original = DatabaseSync.prototype.exec;
    try {
        DatabaseSync.prototype.exec = function (sql: string) { if (sql.includes('CREATE TABLE information_history('))
            throw new Error('Injected directory migration failure'); return original.call(this, sql); };
        assert.throws(() => new InformationStore(file), /directory migration failure/);
        DatabaseSync.prototype.exec = original;
        const unchanged = new DatabaseSync(file, { readOnly: true });
        assert.equal(unchanged.prepare('PRAGMA user_version').get()!.user_version, 1);
        unchanged.close();
        store = new InformationStore(file);
        assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 2);
        store.close();
        assert.ok(fs.readdirSync(f.root).some(name => name.includes('.schema-1-') && name.endsWith('.bak.json')));
    }
    finally {
        DatabaseSync.prototype.exec = original;
        if (previous === undefined)
            delete process.env.SWISSMOUSE_INFORMATION_DIRECTORY;
        else
            process.env.SWISSMOUSE_INFORMATION_DIRECTORY = previous;
    }
});
test('failed replay rolls back entries and checkpoint; stale cursors reject; Core-only graph excludes modules', async (t) => {
    const f = fixture(t);
    f.publish('a', 'Alpha');
    f.publish('b', 'Alphabet');
    const cursor = f.directory.query(request('Al', { limit: 1 })).nextCursor!;
    f.publish('c', 'Alpine');
    assert.throws(() => f.directory.query(request('Al', { limit: 1, cursor })), /changed/);
    f.db.exec("CREATE TRIGGER fail_directory BEFORE INSERT ON directory_entries BEGIN SELECT RAISE(ABORT,'Injected directory fault'); END;");
    assert.throws(() => f.publish('d', 'Albatross'), /directory fault/);
    const checkpoint = f.db.prepare('SELECT checkpoint FROM directory_state').get()!.checkpoint;
    f.db.exec('DROP TRIGGER fail_directory');
    f.directory.advance();
    assert.ok(Number(f.db.prepare('SELECT checkpoint FROM directory_state').get()!.checkpoint) > Number(checkpoint));
    const bundle = await build({ entryPoints: ['tools/information-directory.ts'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, metafile: true });
    assert.ok(Object.keys(bundle.metafile!.inputs).every(file => !file.includes('audiobooks/') && !file.includes('catalog-store')));
});
test('canonical terms retain IDs on rename and retire without converting legacy genre text', t => {
    const f = fixture(t);
    const definitions = f.store.definitions();
    // Explicit test vocabulary/provider, unrelated to the audiobook genre observation field.
    f.store.registerDefinitions([{ owner: 'fixture', prototypeVersion: 1, definitions: [
                { owner: 'fixture', public: true, definitionVersion: 1, definition: 'taxonomy', id: 'fixture.topics', label: 'Topics', appliesTo: ['core.item'], hierarchy: 'tree', maxDepth: 3, cardinality: 'many', userCreatedTerms: true },
                { owner: 'fixture', public: true, definitionVersion: 1, definition: 'field', id: 'fixture.topic', label: 'Topic', target: 'resource', appliesTo: ['core.item'], valueType: 'reference', cardinality: 'one', filterOperators: ['eq'], sortable: false, referenceTaxonomyId: 'fixture.topics' },
                { owner: 'fixture', public: true, definitionVersion: 1, definition: 'provider', id: 'fixture.suggest-topic', label: 'Topics', fieldId: 'fixture.topic', valueKind: 'term', taxonomyId: 'fixture.topics', matching: ['prefix', 'contains'], minimumContainsLength: 3, defaultLimit: 20, maxLimit: 100 },
            ] }]);
    const terms = new InformationTerms(f.store), term = { id: 'fixture:stable-term', taxonomy: 'fixture.topics', owner: 'fixture', label: 'Original', parent: null, revision: 0, retired: false };
    terms.save(term, 0);
    const db = new DatabaseSync(':memory:');
    try {
        const index = new InformationDirectory(db, f.store);
        index.advance();
        const q = { providerId: 'fixture.suggest-topic', fieldId: 'fixture.topic', query: 'Original' };
        assert.equal(index.query(q).items[0].value, term.id);
        terms.save({ ...term, label: 'Renamed' }, 1);
        index.advance();
        assert.equal(index.query({ ...q, query: 'Renamed' }).items[0].value, term.id);
        assert.throws(() => terms.save({ ...term, parent: term.id }, 2), /hierarchy/);
        terms.save({ ...term, retired: true }, 2);
        index.advance();
        assert.equal(index.query(q).items.length, 0);
        assert.equal(f.store.definitions().filter(d => d.id === 'audiobooks.genre').length, definitions.filter(d => d.id === 'audiobooks.genre').length);
    }
    finally {
        db.close();
    }
});
test('source save and selection outbox commit together; an injected failure creates no history event', t => {
    const f = fixture(t), previous = { directory: process.env.SWISSMOUSE_INFORMATION_DIRECTORY, durable: process.env.SWISSMOUSE_INFORMATION_DURABLE };
    process.env.SWISSMOUSE_INFORMATION_DIRECTORY = '1';
    process.env.SWISSMOUSE_INFORMATION_DURABLE = '1';
    let source: DurableProjectStore;
    try {
        source = new DurableProjectStore(path.join(f.root, 'jobs.json'));
    }
    finally {
        for (const [key, value] of Object.entries({ SWISSMOUSE_INFORMATION_DIRECTORY: previous.directory, SWISSMOUSE_INFORMATION_DURABLE: previous.durable })) {
            if (value === undefined)
                delete process.env[key];
            else
                process.env[key] = value;
        }
    }
    try {
        const jobs = source.load();
        jobs.push({ id: 'saved', name: 'Before', status: 'draft', createdAt: 'now', parts: [], chapters: [], logs: [], candidates: [] } as any);
        source.save(jobs);
        const saved = commit('Selected');
        source.db.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON project_state BEGIN SELECT RAISE(ABORT,'Save failure'); END;");
        jobs[0].name = 'After';
        assert.throws(() => source.withSelectionCommit(saved.receipt, JSON.stringify(saved), () => source.save(jobs)), /Save failure/);
        assert.equal(source.selectionOutbox().length, 0);
        source.db.exec('DROP TRIGGER fail_save');
        source.withSelectionCommit(saved.receipt, JSON.stringify(saved), () => source.save(jobs));
        assert.equal(source.selectionOutbox().length, 1);
        f.directory.history.record(JSON.parse(String(source.selectionOutbox()[0].payload)));
        f.directory.history.record(saved);
        source.acknowledgeSelection(saved.receipt);
        assert.equal(f.directory.history.recent(providerId, fieldId)[0].uses, 1);
    }
    finally {
        source.close();
    }
});
