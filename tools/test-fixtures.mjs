import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';

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
