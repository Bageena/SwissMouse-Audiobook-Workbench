import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

/** Publish a complete, flushed file in one rename; never expose partial JSON. */
export function replaceFileAtomically(target: string, text: string): void {
  const staging = `${target}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(staging, 'wx');
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(staging, target);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(staging)) fs.unlinkSync(staging);
  }
}
