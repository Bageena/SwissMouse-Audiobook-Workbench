import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createTestFixture, stopTestServer } from './test-fixtures.mjs';
import { valueKey } from './information-history';
test('directory pilot records only successful explicit saves and replays pending history across restart', { timeout: 90000 }, async (t) => {
    const fixture = createTestFixture('.cache/directory-api-'), root = fixture.root;
    let child: ChildProcess | undefined, output = '';
    t.after(async () => { if (child)
        await stopTestServer(child); fixture.cleanup(); });
    const metadata = (series: string) => ({ title: 'Saved title', series, author: 'Doe, Jane', authors: ['Doe, Jane'], narrator: 'Reader', genres: ['Fantasy'], language: 'en', abridged: false, explicit: false });
    fs.writeFileSync(path.join(root, 'jobs.json'), JSON.stringify(Array.from({ length: 141 }, (_, i) => ({ id: 'saved-' + i, name: 'Saved title', status: 'draft', createdAt: '2026-01-01', parts: [], chapters: [], logs: [], candidates: [], metadata: metadata(i === 140 ? 'Zyzzyva' : 'Series ' + String(i).padStart(3, '0')) }))));
    const listener = net.createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const port = (listener.address() as net.AddressInfo).port;
    await new Promise<void>(done => listener.close(() => done()));
    const base = `http://127.0.0.1:${port}`, userFile = path.join(root, 'catalog.sqlite.user.sqlite');
    const read = async (route: string) => { const r = await fetch(base + route); assert.ok(r.ok, await r.clone().text() + '\n' + output); return r.json(); };
    const post = async (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const query = async (query = '', extra: object = {}) => read('/api/information-directory/suggestions?request=' + encodeURIComponent(JSON.stringify({ providerId: 'audiobooks.suggest-series', fieldId: 'audiobooks.series', query, ...extra })));
    async function start(enabled: boolean) {
        output = '';
        child = spawn(process.execPath, [path.resolve('dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, PORT: String(port), NODE_ENV: 'production', SWISSMOUSE_RUNTIME_MODE: 'managed', SWISSMOUSE_OPEN_BROWSER: '0', SWISSMOUSE_INFORMATION_DURABLE: enabled ? '1' : '0', SWISSMOUSE_INFORMATION_DIRECTORY: enabled ? '1' : '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout!.on('data', bytes => { output += bytes; });
        child.stderr!.on('data', bytes => { output += bytes; });
        for (let i = 0; i < 750; i++) {
            if (child.exitCode !== null)
                assert.fail(output);
            try {
                const r = await fetch(base + '/api/catalog/status');
                if (r.ok) {
                    const s = await r.json();
                    if (!s.indexing && (!enabled || s.information && !s.information.error && !s.information.pendingDirectory && !s.information.dirty && !s.information.outbox && !s.information.pendingProjection))
                        return;
                }
            }
            catch { }
            await new Promise(done => setTimeout(done, 30));
        }
        assert.fail('Fixture did not settle: ' + output);
    }
    await start(false);
    assert.equal((await read('/api/information-directory/config?jobId=saved-0')).enabled, false);
    await stopTestServer(child!);
    child = undefined;
    await start(true);
    assert.equal((await query('Zyz')).items[0].value, 'Zyzzyva');
    assert.equal((await query()).items.length, 0, 'imported books do not become actual history');
    const selection = { receipt: randomUUID(), key: valueKey('audiobooks.suggest-series', 'audiobooks.series', 'Zyzzyva'), value: 'Zyzzyva' };
    await post('/api/jobs/saved-0/metadata-draft', { metadata: metadata('Zyzzyva') });
    assert.equal((await query()).items.length, 0);
    let job = await read('/api/jobs/saved-0');
    assert.equal((await post('/api/jobs/saved-0/metadata', { metadata: { ...metadata('Zyzzyva'), title: '' }, expectedRevision: job.metadataRevision || 0, selection })).status, 400);
    assert.equal((await query()).items.length, 0);
    assert.equal((await post('/api/jobs/saved-0/metadata', { metadata: metadata('Zyzzyva'), expectedRevision: 999, selection })).status, 409);
    let response = await post('/api/jobs/saved-0/metadata', { metadata: metadata('Zyzzyva'), expectedRevision: job.metadataRevision || 0, selection });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).historyPending, false);
    assert.equal((await query()).items[0].reason, 'recent');
    job = await read('/api/jobs/saved-0');
    response = await post('/api/jobs/saved-0/metadata', { metadata: metadata('Zyzzyva'), expectedRevision: job.metadataRevision || 0, selection });
    assert.equal(response.status, 200);
    let db = new DatabaseSync(userFile);
    assert.equal(db.prepare('SELECT uses FROM information_history').get()!.uses, 1);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 2);
    db.exec("CREATE TRIGGER delivery_outage BEFORE INSERT ON information_history BEGIN SELECT RAISE(ABORT,'Injected history outage'); END;");
    db.close();
    job = await read('/api/jobs/saved-1');
    const second = { receipt: randomUUID(), key: valueKey('audiobooks.suggest-series', 'audiobooks.series', 'Series 001'), value: 'Series 001' };
    response = await post('/api/jobs/saved-1/metadata', { metadata: metadata('Series 001'), expectedRevision: job.metadataRevision || 0, selection: second });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).historyPending, true);
    await stopTestServer(child!);
    child = undefined;
    db = new DatabaseSync(userFile);
    db.exec('DROP TRIGGER delivery_outage');
    db.close();
    await start(true);
    for (let i = 0; i < 100; i++) {
        if ((await query()).items.some((item: any) => item.value === 'Series 001'))
            break;
        await new Promise(done => setTimeout(done, 30));
    }
    assert.ok((await query()).items.some((item: any) => item.value === 'Series 001'));
    assert.doesNotMatch(JSON.stringify((await read('/api/jobs/saved-1')).metadata), /receipt|providerId|committedAt/);
    assert.ok(fs.readdirSync(root).some(file => /^jobs\.json\.sqlite\.schema-1-.*\.bak\.json$/.test(file)));
    assert.equal((await post('/api/information-directory/history/clear', { profile: 'other' })).status, 400);
    assert.equal((await post('/api/information-directory/history/clear', {})).status, 200);
    assert.equal((await query()).items.length, 0);
    assert.equal((await fetch(base + '/api/information-directory/suggestions?request=' + encodeURIComponent(JSON.stringify({ providerId: 'audiobooks.suggest-series', fieldId: 'audiobooks.series', query: 's', profile: 'other' })))).status, 400);
});
