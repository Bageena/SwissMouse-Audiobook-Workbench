import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createTestFixture, stopTestServer, waitForTestServer } from './test-fixtures.mjs';

test('functional readiness retries incomplete responses, closes probe connections and rejects stopped children', async t => {
  const child=spawn(process.execPath,['-e',`const http=require('node:http');let calls=0;const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({indexing:++calls<3,closed:req.headers.connection==='close'}));});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));`],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  t.after(()=>stopTestServer(child));
  const [bytes]=await once(child.stdout,'data'),port=Number(String(bytes).trim());
  await waitForTestServer(child,`http://127.0.0.1:${port}`,body=>!body.indexing&&body.closed,3000);
  await stopTestServer(child);
  await assert.rejects(waitForTestServer(child,`http://127.0.0.1:${port}`),/exited before readiness/);
});

test('fixture cleanup removes only its generated root and permits repeated cleanup', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-fixture-'));
  try {
    const sentinel = path.join(parent, 'keep.txt'); fs.writeFileSync(sentinel, 'preserve');
    const fixture = createTestFixture(path.join(parent, 'case-'));
    fs.writeFileSync(path.join(fixture.root, 'generated.txt'), 'temporary');
    fixture.cleanup(); fixture.cleanup();
    assert.equal(fs.existsSync(fixture.root), false);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('fixture cleanup refuses a directory replaced after fixture creation', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-fixture-'));
  try {
    const fixture = createTestFixture(path.join(parent, 'case-'));
    fs.renameSync(fixture.root, fixture.root + '-original'); fs.mkdirSync(fixture.root);
    const sentinel = path.join(fixture.root, 'keep.txt'); fs.writeFileSync(sentinel, 'preserve');
    assert.throws(() => fixture.cleanup(), /replaced test fixture/);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('stopping test servers waits for exit and also handles already exited children', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true });
  await once(child, 'spawn'); await stopTestServer(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await stopTestServer(child);
});

test('fixtures can be explicitly retained for debugging', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-fixture-'));
  const original = process.env.SWISSMOUSE_KEEP_TEST_FIXTURES;
  try {
    const fixture = createTestFixture(path.join(parent, 'case-'));
    process.env.SWISSMOUSE_KEEP_TEST_FIXTURES = '1'; fixture.cleanup();
    assert.equal(fs.existsSync(fixture.root), true);
    delete process.env.SWISSMOUSE_KEEP_TEST_FIXTURES; fixture.cleanup();
    assert.equal(fs.existsSync(fixture.root), false);
  } finally {
    if (original === undefined) delete process.env.SWISSMOUSE_KEEP_TEST_FIXTURES;
    else process.env.SWISSMOUSE_KEEP_TEST_FIXTURES = original;
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
