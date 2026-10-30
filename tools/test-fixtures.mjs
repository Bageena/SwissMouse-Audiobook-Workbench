import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';

/** Functional readiness, not a startup benchmark. Close each probe connection across server restarts. */
export async function waitForTestServer(child, url, accepts = () => true, timeoutMs = 30000) {
  const start = Date.now(); let last = 'No response';
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Fixture server exited before readiness (${child.exitCode ?? child.signalCode}): ${last}`);
    try {
      const response = await fetch(url, {headers:{Connection:'close'},signal:AbortSignal.timeout(1500)});
      const text = await response.text(); last = `${response.status}: ${text.slice(0,1000)}`;
      if (response.ok && accepts(JSON.parse(text))) return {elapsedMs:Date.now()-start};
    } catch (error) { last = String(error); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Fixture did not become ready in ${timeoutMs} ms: ${last}`);
}

/** Only remove a fixture created by this process, inside its declared parent. */
export function createTestFixture(prefix) {
  const absolute = path.resolve(prefix);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const root = fs.mkdtempSync(absolute);
  const identity = fs.lstatSync(root, { bigint: true });
  return {
    root,
    cleanup() {
      if (process.env.SWISSMOUSE_KEEP_TEST_FIXTURES === '1') {
        console.log(`Retained test fixture: ${root}`);
        return;
      }
      if (!fs.existsSync(root)) return;
      const current = fs.lstatSync(root, { bigint: true });
      if (path.dirname(root) !== path.dirname(absolute) || !path.basename(root).startsWith(path.basename(absolute))
        || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino)
        throw new Error(`Refusing to remove a replaced test fixture: ${root}`);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

export async function stopTestServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}
