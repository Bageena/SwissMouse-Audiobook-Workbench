import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CatalogStore } from './catalog-store';
import { projectCatalogRecord } from './catalog-projection';
import { InformationStore } from './information-store';
import { InformationProjection } from './information-projection';
import { CatalogService } from './catalog-service';
import { createTestFixture } from './test-fixtures.mjs';
import type { AudiobookJob } from '../src/types';
function open(file: string) {
    const old = process.env.SWISSMOUSE_INFORMATION_DURABLE;
    process.env.SWISSMOUSE_INFORMATION_DURABLE = '1';
    try {
        return new CatalogStore(file);
    }
    finally {
        if (old === undefined)
            delete process.env.SWISSMOUSE_INFORMATION_DURABLE;
        else
            process.env.SWISSMOUSE_INFORMATION_DURABLE = old;
    }
}
function settle(store: CatalogStore) {
    for (let i = 0; i < 100; i++) {
        const status = store.informationAdvance() as any;
        assert.equal(status.error, undefined, JSON.stringify(status));
        if (!status.dirty && !status.outbox && !status.pendingProjection)
            return status;
    }
    assert.fail('Capture did not settle');
}
function job(root: string): AudiobookJob {
    return { id: 'existing-project', name: 'Existing Book', status: 'draft', createdAt: '2026-01-01', chapters: [], candidates: [], logs: [],
        parts: [{ id: 'part-stable', name: path.join(root, 'source.mp3'), order: 1, durationSeconds: 10, bitrate: 64, sizeBytes: 14 }], totalDurationSeconds: 10, totalSizeBytes: 14,
        metadata: { title: 'Existing Book', author: 'Doe, Jane', authors: ['Doe, Jane'], narrator: 'Reader', genres: ['Fantasy'], tags: Array.from({ length: 150 }, (_, i) => `Tag ${i}`), language: 'en', explicit: false, abridged: false,
            collections: Array.from({ length: 151 }, (_, i) => ({ id: `existing-collection-${i}`, name: `Shelf ${i}` })) },
    } as AudiobookJob;
}
test('catalog capture retains complete metadata, canonical IDs/aliases and file ordering across restart', t => {
    const fixture = createTestFixture('.cache/information-capture-');
    let catalog: CatalogStore | undefined;
    t.after(() => { catalog?.close(); fixture.cleanup(); });
    const file = path.join(fixture.root, 'catalog.sqlite');
    fs.writeFileSync(path.join(fixture.root, 'source.mp3'), 'Original bytes');
    const source = job(fixture.root);
    catalog = new CatalogStore(file);
    catalog.upsertProjects([projectCatalogRecord(source)], 1);
    const before = catalog.query().items[0];
    catalog.close();
    catalog = open(file);
    settle(catalog);
    let page = catalog.informationPage({ limit: 500 });
    const work = page.items.find(item => item.descriptor.id === before.resourceId)!;
    assert.deepEqual(work.fields['audiobooks.authors'], ['Doe, Jane']);
    assert.equal(work.memberships.length, 151);
    assert.equal((work.fields['audiobooks.tags'] as string[]).length, 150);
    assert.deepEqual(work.omitted, []);
    const recording = page.items.find(item => item.descriptor.id === before.recordingId)!;
    assert.ok(recording.relationships.some(r => r.relationshipId === 'core.contains' && r.position === 0));
    const originalIds = page.items.map(item => item.descriptor.id).sort();
    catalog.close();
    catalog = open(file);
    settle(catalog);
    page = catalog.informationPage({ limit: 500 });
    assert.deepEqual(page.items.map(item => item.descriptor.id).sort(), originalIds);
    assert.equal(fs.readFileSync(path.join(fixture.root, 'source.mp3'), 'utf8'), 'Original bytes');
});
test('crash after durable commit before outbox acknowledgement replays without duplicate edits', t => {
    const fixture = createTestFixture('.cache/information-ack-');
    let catalog: CatalogStore | undefined;
    t.after(() => { catalog?.close(); fixture.cleanup(); });
    const file = path.join(fixture.root, 'catalog.sqlite');
    catalog = open(file);
    catalog.upsertProjects([projectCatalogRecord(job(fixture.root))], 1);
    catalog.db.exec("CREATE TRIGGER fail_ack BEFORE DELETE ON information_outbox BEGIN SELECT RAISE(ABORT,'Injected ack crash'); END;");
    const failed = catalog.informationAdvance() as any;
    assert.match(failed.error, /Injected ack crash/);
    assert.ok(failed.outbox > 0);
    assert.ok(failed.checkpoint > 0);
    const user = new InformationStore(file + '.user.sqlite');
    const revisions = user.db.prepare('SELECT id,revision FROM information_resources ORDER BY id').all();
    user.close();
    catalog.db.exec('DROP TRIGGER fail_ack');
    catalog.close();
    catalog = open(file);
    settle(catalog);
    const reopened = new InformationStore(file + '.user.sqlite');
    try {
        for (const row of revisions)
            assert.equal(reopened.get(String(row.id))!.item.descriptor.revision, row.revision);
    }
    finally {
        reopened.close();
    }
});
test('retirement persists through a fresh Core-only index rebuild without loading source payloads', t => {
    const fixture = createTestFixture('.cache/information-retire-');
    let catalog: CatalogStore | undefined;
    t.after(() => { catalog?.close(); fixture.cleanup(); });
    const file = path.join(fixture.root, 'catalog.sqlite');
    const source = job(fixture.root);
    catalog = open(file);
    catalog.upsertProjects([{ ...projectCatalogRecord(source), stateVersion: 1 }], 0);
    settle(catalog);
    const workId = catalog.query().items[0].resourceId!;
    catalog.applyChanges([], [source.id], 2);
    settle(catalog);
    catalog.close();
    catalog = undefined;
    const core = new InformationStore(file + '.user.sqlite'), db = new DatabaseSync(':memory:');
    try {
        assert.equal(core.get(workId)!.retired, true);
        const index = new InformationProjection(db, core);
        while (index.advance().pending) { /* replay generic durable facts only */ }
        assert.equal(index.page().items.length, 0);
        assert.ok(index.page({ includeRetired: true }).items.some(item => item.descriptor.id === workId));
    }
    finally {
        db.close();
        core.close();
    }
});
test('retirement before first acknowledgement preserves the latest captured metadata', t => {
    const fixture = createTestFixture('.cache/information-pending-retire-');
    let catalog: CatalogStore | undefined;
    t.after(() => { catalog?.close(); fixture.cleanup(); });
    const file = path.join(fixture.root, 'catalog.sqlite');
    const source = job(fixture.root);
    catalog = open(file);
    catalog.upsertProjects([{ ...projectCatalogRecord(source), stateVersion: 1 }], 0);
    const workId = catalog.query().items[0].resourceId!;
    const publish = InformationStore.prototype.publish;
    InformationStore.prototype.publish = function () { throw new Error('Injected delivery outage'); };
    try {
        assert.match((catalog.informationAdvance() as any).error, /delivery outage/);
    }
    finally {
        InformationStore.prototype.publish = publish;
    }
    catalog.applyChanges([], [source.id], 2);
    settle(catalog);
    const core = new InformationStore(file + '.user.sqlite');
    try {
        const retained = core.get(workId)!;
        assert.equal(retained.retired, true);
        assert.deepEqual(retained.item.fields['audiobooks.authors'], ['Doe, Jane']);
        assert.equal(retained.item.memberships.length, 151);
    }
    finally {
        core.close();
    }
});
test('derived-index replacement uses a fresh epoch, retains data and reports unobserved live records as stale', t => {
    const fixture = createTestFixture('.cache/information-epoch-');
    let catalog: CatalogStore | undefined;
    t.after(() => { catalog?.close(); fixture.cleanup(); });
    const file = path.join(fixture.root, 'catalog.sqlite');
    catalog = open(file);
    catalog.upsertProjects([projectCatalogRecord(job(fixture.root))], 1);
    const initial = settle(catalog);
    catalog.close();
    catalog = undefined;
    // Dispose only this fixture's derived index. Its authoritative user DB is retained.
    fs.unlinkSync(file);
    catalog = open(file);
    const stale = settle(catalog);
    assert.notEqual(stale.epoch, initial.epoch);
    assert.ok(stale.staleRetained > 0);
    assert.ok(catalog.informationPage().items.length > 0);
    catalog.upsertProjects([projectCatalogRecord(job(fixture.root))], 1);
    assert.equal(settle(catalog).staleRetained, 0);
});
test('a restored acknowledgement with a divergent receipt is refused without losing publications', t => {
    const fixture = createTestFixture('.cache/information-divergent-');
    const file = path.join(fixture.root, 'catalog.sqlite');
    t.after(() => fixture.cleanup());
    const catalog = open(file);
    catalog.upsertProjects([projectCatalogRecord(job(fixture.root))], 1);
    settle(catalog);
    catalog.db.exec("UPDATE information_origin SET ack_hash='different-branch'");
    catalog.close();
    assert.throws(() => open(file), /acknowledgement history disagrees/);
    const core = new InformationStore(file + '.user.sqlite');
    try {
        assert.ok(core.db.prepare('SELECT count(*) n FROM information_resources').get()!.n);
    }
    finally {
        core.close();
    }
});
test('a transient publication failure retries in the background without another user edit', { timeout: 15000 }, async (t) => {
    const fixture = createTestFixture('.cache/information-retry-');
    const file = path.join(fixture.root, 'catalog.sqlite');
    const catalog = open(file);
    catalog.close();
    const authority = new DatabaseSync(file + '.user.sqlite');
    authority.exec("CREATE TRIGGER pause_publication BEFORE INSERT ON information_resources BEGIN SELECT RAISE(ABORT,'Injected temporary outage'); END;");
    const previous = process.env.SWISSMOUSE_INFORMATION_DURABLE;
    process.env.SWISSMOUSE_INFORMATION_DURABLE = '1';
    const service = new CatalogService(file, () => [job(fixture.root)], undefined, () => { }, path.resolve('dist/catalog-worker.cjs'));
    t.after(async () => { await service.close(); authority.close(); if (previous === undefined)
        delete process.env.SWISSMOUSE_INFORMATION_DURABLE;
    else
        process.env.SWISSMOUSE_INFORMATION_DURABLE = previous; fixture.cleanup(); });
    await service.ready();
    assert.match(service.status().information.error, /temporary outage/);
    authority.exec('DROP TRIGGER pause_publication');
    for (let i = 0; i < 100; i++) {
        const status = service.status().information;
        if (!status.error && !status.dirty && !status.outbox && !status.pendingProjection) {
            assert.ok(status.checkpoint > 0);
            return;
        }
        await new Promise(done => setTimeout(done, 50));
    }
    assert.fail('Background publication did not resume');
});
