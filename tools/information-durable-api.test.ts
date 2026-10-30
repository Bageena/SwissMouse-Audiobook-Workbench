import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createTestFixture, stopTestServer } from './test-fixtures.mjs';
test('opt-in durable publication migrates privately, preserves work and resumes after restart', { timeout: 60000 }, async (t) => {
    const fixture = createTestFixture('.cache/information-durable-api-'), root = fixture.root;
    let child: ChildProcess | undefined;
    t.after(async () => { if (child)
        await stopTestServer(child); fixture.cleanup(); });
    const books = Array.from({ length: 12 }, (_, i) => ({ id: `saved-${i}`, name: `Book ${i}`, status: 'draft', createdAt: '2026-01-01', parts: [], chapters: [], candidates: [], logs: [], personalRating: 7,
        metadata: { title: `Book ${i}`, author: 'Doe, Jane', authors: ['Doe, Jane'], narrator: 'Reader', genres: ['Fantasy'], language: 'en', abridged: false, explicit: false },
        transcriptSegments: [{ id: 0, start: 0, end: 1, text: 'Private transcript sentinel', words: [] }], metadataDraft: { title: 'Unfinished title sentinel' } }));
    const original = JSON.stringify(books);
    fs.writeFileSync(path.join(root, 'jobs.json'), original);
    const listener = net.createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const port = (listener.address() as net.AddressInfo).port;
    await new Promise<void>(done => listener.close(() => done()));
    const base = `http://127.0.0.1:${port}`;
    let output = '';
    const read = async (route: string) => { const response = await fetch(base + route); assert.ok(response.ok, await response.clone().text() + '\n' + output); return response.json(); };
    async function start(durable: boolean) {
        output = '';
        child = spawn(process.execPath, [path.resolve('dist/server.cjs')], { env: { ...process.env, APP_ROOT: root, PORT: String(port), NODE_ENV: 'production', SWISSMOUSE_RUNTIME_MODE: 'managed', SWISSMOUSE_OPEN_BROWSER: '0', SWISSMOUSE_INFORMATION_PREVIEW: '1', SWISSMOUSE_INFORMATION_DURABLE: durable ? '1' : '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout!.on('data', bytes => { output += bytes; });
        child.stderr!.on('data', bytes => { output += bytes; });
        for (let i = 0; i < 500; i++) {
            if (child.exitCode !== null)
                assert.fail(output);
            try {
                const response = await fetch(base + '/api/catalog/status');
                if (response.ok && !(await response.json()).indexing)
                    return;
            }
            catch { /* startup */ }
            await new Promise(done => setTimeout(done, 40));
        }
        assert.fail('Durable fixture did not settle: ' + output);
    }
    await start(false);
    const existing = await read('/api/information-preview/library?limit=50');
    const userFile = path.join(root, 'catalog.sqlite.user.sqlite');
    const legacy = new DatabaseSync(userFile, { readOnly: true });
    assert.equal(legacy.prepare('PRAGMA user_version').get()!.user_version, 0);
    legacy.close();
    await stopTestServer(child!);
    child = undefined;
    await start(true);
    const durable = await read('/api/information-preview/durable-resources?limit=100');
    assert.equal(durable.status.enabled, true);
    assert.equal(durable.status.dirty, 0);
    assert.equal(durable.status.outbox, 0);
    assert.equal(durable.status.error, undefined);
    assert.equal(durable.items.filter((item: any) => item.descriptor.kind === 'core.work').length, 12);
    for (const old of existing.items)
        assert.ok(durable.items.some((item: any) => item.descriptor.id === old.descriptor.id));
    assert.doesNotMatch(JSON.stringify(durable), /Private transcript sentinel|Unfinished title sentinel/);
    assert.ok(fs.readdirSync(root).some(file => file.endsWith('.bak.json')));
    assert.ok(fs.readdirSync(root).some(file => /^jobs\.json\.sqlite\.information-.*\.bak$/.test(file)));
    const epoch = durable.status.epoch, checkpoint = durable.status.checkpoint;
    await stopTestServer(child!);
    child = undefined;
    await start(true);
    const restarted = await read('/api/information-preview/durable-resources?limit=100');
    assert.equal(restarted.status.epoch, epoch);
    assert.ok(restarted.status.checkpoint >= checkpoint);
    assert.deepEqual(restarted.items.map((item: any) => item.descriptor.id), durable.items.map((item: any) => item.descriptor.id));
    const saved = await read('/api/jobs/saved-0');
    assert.equal(saved.personalRating, 7);
    assert.equal(saved.transcriptSegments[0].text, 'Private transcript sentinel');
    assert.equal(saved.metadataDraft.title, 'Unfinished title sentinel');
    assert.equal(fs.readFileSync(path.join(root, 'jobs.json'), 'utf8'), original);
    assert.equal((await fetch(base + '/api/information-preview/durable-resources?limit=501')).status, 400);
    assert.equal((await fetch(base + '/api/information-preview/durable-resources', { method: 'POST' })).status, 404);
});
