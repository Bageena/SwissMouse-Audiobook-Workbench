import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8')) as { version: string };
const releaseRoot = resolve(projectRoot, 'release');
const releaseDirectory = resolve(releaseRoot, `SwissMouse-${packageJson.version}`);

if (!releaseDirectory.startsWith(`${releaseRoot}${sep}`)) {
  throw new Error('Refusing to write a release outside the release directory.');
}

await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });

const releaseFiles = [
  '.env.example',
  'CUSTOM-THEMES.md',
  'FORMAT-SUPPORT.md',
  'TRANSCRIPTION.md',
  'CHAPTER-DETECTION.md',
  'REQUIREMENTS.md',
  'LIBRIVOX.md',
  'metadata.json',
  'package-lock.json',
  'package.json',
  'README.md',
  'Start Audiobook Workbench.bat',
  'themes',
  'dist',
];

for (const source of releaseFiles) {
  const sourcePath = resolve(projectRoot, source);
  const destinationPath = resolve(releaseDirectory, source);
  if (!relative(releaseDirectory, destinationPath) || relative(releaseDirectory, destinationPath).startsWith('..')) {
    throw new Error(`Refusing to copy ${source} outside the release directory.`);
  }
  await cp(sourcePath, destinationPath, { recursive: true });
}

console.log(releaseDirectory);
