import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import AdmZip from 'adm-zip';

const root = path.resolve(import.meta.dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** Independent module build. Never imports or rebuilds the host application. */
export async function buildAudiobookModule({ output = path.join(root, '.cache', 'module-packages'), version = '0.0.1' } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use a numeric prototype module version.');
  fs.mkdirSync(output, { recursive: true });
  const files = new Map();
  for (const entry of ['client.tsx', 'server.ts']) {
    const result = await build({ entryPoints: [path.join(root, 'packages/audiobooks/src', entry)], bundle: true, write: false, format: 'esm', platform: entry === 'server.ts' ? 'node' : 'browser', target: 'es2022', tsconfigRaw: { compilerOptions: { jsx: 'react', jsxFactory: 'React.createElement', jsxFragmentFactory: 'React.Fragment' } }, jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', metafile: true });
    for (const input of Object.keys(result.metafile.inputs)) if (!path.resolve(root, input).startsWith(path.join(root, 'packages', 'audiobooks') + path.sep)) throw new Error(`Module has a private host or bundled third-party dependency: ${input}`);
    files.set(entry === 'client.tsx' ? 'client.mjs' : 'backend.mjs', Buffer.from(result.outputFiles[0].contents));
  }
  files.set('panel.css', fs.readFileSync(path.join(root, 'packages/audiobooks/src/panel.css')));
  files.set('book.svg', fs.readFileSync(path.join(root, 'packages/audiobooks/src/book.svg')));
  files.set('LICENSE', fs.readFileSync(path.join(root, 'LICENSE')));
  files.set('package.json', Buffer.from(JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(root, 'packages/audiobooks/package.json'))), version }, null, 2)));
  for (const name of ['client.tsx', 'server.ts', 'BookInformation.tsx', 'panel.css', 'book.svg']) files.set(`source/${name}`, fs.readFileSync(path.join(root, 'packages/audiobooks/src', name)));
  files.set('source/sdk.ts', fs.readFileSync(path.join(root, 'packages/sdk/index.ts')));
  files.set('source/build-audiobook-module.mjs', fs.readFileSync(import.meta.filename));
  files.set('README.txt', Buffer.from('SwissMouse Audiobooks read-only proof. AGPL-3.0-or-later.\nSource is included; canonical build inputs and instructions are in the matching SwissMouse source release under packages/audiobooks, packages/sdk, and scripts/build-audiobook-module.mjs. Build with npm run module:build. No processing runtimes, models or React implementation are included.\n'));
  const manifest = { format: 'swissmouse.module', id: 'audiobooks', publisher: 'swissmouse-development', name: 'Audiobooks — read-only proof', version, apiVersion: 1, reactMajor: 18,
    browser: 'client.mjs', backend: 'backend.mjs', styles: ['panel.css'], assets: ['book.svg'], panels: [{ id: 'audiobooks.information', title: 'Book information', operation: 'audiobooks.summary' }], operations: ['audiobooks.summary'], files: Object.fromEntries([...files].map(([name, bytes]) => [name, hash(bytes)])) };
  const zip = new AdmZip(); zip.addFile('module.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  for (const [name, bytes] of files) zip.addFile(name, bytes);
  const bytes = zip.toBuffer(), sha256 = hash(bytes);
  const artifact = path.join(output, `audiobooks-${version}.smmodule`); fs.writeFileSync(artifact, bytes);
  return { artifact, sha256, manifest, catalogEntry: { id: manifest.id, publisher: manifest.publisher, version, sha256 } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = await buildAudiobookModule({ version: process.argv[2] || '0.0.1' });
  const catalog = path.join(path.dirname(result.artifact), 'module-catalog.json');
  const previous = fs.existsSync(catalog) ? JSON.parse(fs.readFileSync(catalog, 'utf8')).packages : [];
  fs.writeFileSync(catalog, JSON.stringify({ schemaVersion: 1, packages: [...previous.filter(item => item.sha256 !== result.sha256), result.catalogEntry].slice(-32) }, null, 2));
  console.log(`Package: ${result.artifact}\nSHA-256: ${result.sha256}\nDevelopment trust catalog: ${catalog}\nProvision this catalog explicitly as APP_ROOT/module-trust.json in a disposable host; it is not installed automatically.`);
}
