import assert from 'node:assert/strict';
import test from 'node:test';
import { readApiJson } from '../src/utils/apiResponse';

test('HTML from an old server produces actionable protocol diagnostics', async () => {
  const response = new Response('<!DOCTYPE html><html><body>SwissMouse</body></html>', { status: 404, statusText: 'Not Found', headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(readApiJson(response, 'Recheck project audio'), error => {
    assert.match((error as Error).message, /HTTP 404/);
    assert.match((error as Error).message, /HTML page instead of JSON/);
    assert.match((error as Error).message, /Restart SwissMouse/);
    assert.doesNotMatch((error as Error).message, /Unexpected token/);
    return true;
  });
});

test('valid JSON errors retain server details and malformed responses have bounded diagnostics', async () => {
  assert.deepEqual(await readApiJson(new Response(JSON.stringify({ error: 'Missing source file' }), { status: 400 }), 'Recheck'), { error: 'Missing source file' });
  await assert.rejects(readApiJson(new Response('invalid'.repeat(1000), { status: 502 }), 'Recheck'), error => {
    assert.match((error as Error).message, /HTTP 502/);
    assert.ok((error as Error).message.length < 600);
    return true;
  });
});
