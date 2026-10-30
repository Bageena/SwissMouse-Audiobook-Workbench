import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createTestFixture } from './test-fixtures.mjs';
import { InformationStore } from './information-store';
import { InformationDirectory } from './information-directory';
import { valueKey, searchKey } from './information-history';
import { coreInformationBundle } from '../src/core/information-builtins';
import { audiobookInformationBundle } from '../packages/audiobooks/src/information';
// Synthetic projection benchmark only. No media, user library, model or network access.
const f = createTestFixture('.cache/directory-benchmark-');
const previous = process.env.SWISSMOUSE_INFORMATION_DIRECTORY;
process.env.SWISSMOUSE_INFORMATION_DIRECTORY = '1';
let source: InformationStore;
try {
    source = new InformationStore(path.join(f.root, 'user.sqlite'));
}
finally {
    if (previous === undefined)
        delete process.env.SWISSMOUSE_INFORMATION_DIRECTORY;
    else
        process.env.SWISSMOUSE_INFORMATION_DIRECTORY = previous;
}
source.registerDefinitions([coreInformationBundle, audiobookInformationBundle]);
source.startEpoch('audiobooks.benchmark','audiobooks','benchmark-epoch');
let editVersion=0;
let db = new DatabaseSync(path.join(f.root, 'index.sqlite'));
const rules = [{ providerId: 'audiobooks.suggest-series', contextFieldIds: ['audiobooks.authors'] }];
let directory = new InformationDirectory(db, source, rules);
const providerId = 'audiobooks.suggest-series', fieldId = 'audiobooks.series', scope = createHash('sha256').update(JSON.stringify([providerId, fieldId])).digest('hex');
const cases = { latePrefix: 'Zyz', shortCommonPrefix: 'S', contains: 'Legacy', commonContains: 'eri', unicode: 'Jose' };
const samples = (run: () => unknown) => { const times: number[] = []; for (let i = 0; i < 40; i++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
} times.sort((a, b) => a - b); return { p50: times[19], p95: times[37], p99: times[39] }; };
const result: any = { seed: 'directory-v1-sequential-20261029', node: process.version, sqlite: process.versions.sqlite, os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ramGiB: os.totalmem() / 2 ** 30, storage: 'Workspace drive; storage medium not independently verified', scope: 'Direct worker-engine query costs over synthetic projection rows. OS cache is not flushed; not full library import, taxonomy traversal or playback acceptance.', profiles: [] };
try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE benchmark_files(id INTEGER PRIMARY KEY,work_id INTEGER NOT NULL);');
    let inserted = 0;
    for (const count of [40000, 500000]) {
        const start = performance.now();
        db.exec('BEGIN IMMEDIATE');
        const insert = db.prepare('INSERT INTO directory_entries(key,provider,field,scope,value,label,kind,search,observations) VALUES(?,?,?,?,?,?,\'text\',?,1)');
        for (let i = inserted; i < count; i++) {
            const label = i === count - 1 ? 'Zyzzyva Legacy Last ' + count : i % 10000 === 0 ? 'José Legacy ' + i : 'Series ' + String(i).padStart(6, '0');
            insert.run(valueKey(providerId, fieldId, label), providerId, fieldId, scope, label, label, searchKey(label));
        }
        db.prepare('WITH RECURSIVE ids(i) AS(SELECT ? UNION ALL SELECT i+1 FROM ids WHERE i<?) INSERT INTO benchmark_files SELECT i,i FROM ids').run(inserted + 1, count);
        db.exec('COMMIT');
        inserted = count;
        if (count === 500000) {
            db.exec(`BEGIN IMMEDIATE; WITH RECURSIVE contexts(i) AS(SELECT 0 UNION ALL SELECT i+1 FROM contexts WHERE i<4999) INSERT INTO directory_associations SELECT 'author-'||i,e.key,1 FROM contexts CROSS JOIN directory_entries e WHERE e.id<=1000; INSERT INTO directory_resource_context VALUES('context-fixture','author-4999'); COMMIT;`);
        }
        db.exec('ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);');
        const q = (query: string, extra: object = {}) => directory.query({ providerId, fieldId, query, limit: 20, ...extra });
        const timings = Object.fromEntries(Object.entries(cases).map(([name, query]) => [name, samples(() => q(query))]));
        Object.assign(timings, { related: samples(() => q('', { contextResourceIds: ['context-fixture'] })) });
        const editToVisible=samples(()=>{
          const version=++editVersion,value='Interactive '+count+' '+version;
          source.publish([{sourceId:'audiobooks.benchmark',epoch:'benchmark-epoch',version,retired:false,aliases:[],item:{descriptor:{id:'benchmark-work',kind:'core.work',typeIds:['core.work','audiobooks.book'],owner:'audiobooks',title:'Benchmark work',revision:0,revisionScope:'catalog-snapshot',archived:false},fields:{'audiobooks.series':value,'audiobooks.authors':['Benchmark author']},relationships:[],memberships:[],omitted:[]}}]);
          directory.advance();q(value);
        });
        const retainedHeapBytes:number[]=[];
        for(let window=0;window<4;window++){for(let i=0;i<250;i++)q('S');(globalThis as {gc?:()=>void}).gc?.();retainedHeapBytes.push(process.memoryUsage().heapUsed);}
        const seedMs = performance.now() - start;
        db.close();
        db = new DatabaseSync(path.join(f.root, 'index.sqlite'));
        directory = new InformationDirectory(db, source, rules);
        const reopenStart = performance.now();
        q('Zyz');
        const firstAfterReopenMs = performance.now() - reopenStart;
        result.profiles.push({ syntheticLogicalEntries: count, syntheticFileRows: count, authoritativeWorkResources:1,authoritativeRecordingResources:0, directoryEntries: Number(db.prepare('SELECT count(*) n FROM directory_entries').get()!.n), associationRows: Number(db.prepare('SELECT count(*) n FROM directory_associations').get()!.n), seedAndSamplingMs:seedMs, firstAfterReopenMs, timings, editToVisible,retainedHeapBytes, databaseBytes: fs.statSync(path.join(f.root, 'index.sqlite')).size, rssBytes: process.memoryUsage().rss, plans: { prefix: db.prepare('EXPLAIN QUERY PLAN SELECT key FROM directory_entries WHERE provider=? AND field=? AND search>=? AND search<? ORDER BY search,key LIMIT 21').all(providerId, fieldId, 's', 't'), contains: db.prepare('EXPLAIN QUERY PLAN SELECT rowid FROM directory_search WHERE directory_search MATCH ? AND rowid>? ORDER BY rowid LIMIT 201').all(`scope:"${scope}" AND search:"eri"`, 0) } });
        console.log(`Completed ${count} entries / ${count} file rows.`);
    }
    fs.writeFileSync('.cache/batch10-benchmark.json', JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result.profiles.map((p: any) => ({ entries: p.directoryEntries, associations: p.associationRows, timings: p.timings })), null, 2));
}
finally {
    db.close();
    source.close();
    f.cleanup();
}
