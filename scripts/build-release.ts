// Copyright (C) 2026 SwissMouse contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { cp, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, relative, sep, extname } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8')) as { version: string };
const releaseRoot = resolve(projectRoot, 'release');
const releaseDirectory = resolve(releaseRoot, `SwissMouse-${packageJson.version}`);

// Refuse older builds that omitted bundled dependency licenses.
await readFile(resolve(projectRoot, 'dist/THIRD_PARTY_NOTICES.txt'), 'utf8');
await readFile(resolve(projectRoot, 'dist/catalog-worker.cjs'));

if (!releaseDirectory.startsWith(`${releaseRoot}${sep}`)) {
  throw new Error('Refusing to write a release outside the release directory.');
}

await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });

const releaseFiles = [
  '.env.example',
  '.gitignore',
  '.github/workflows/release.yml',
  'LICENSE',
  'THIRD_PARTY.md',
  'LICENSING_AUDIT.md',
  'CUSTOM-THEMES.md',
  'FORMAT-SUPPORT.md',
  'TRANSCRIPTION.md',
  'CHAPTER-DETECTION.md',
  'REQUIREMENTS.md',
  'LIBRIVOX.md',
  'package-lock.json',
  'package.json',
  'README.md',
  'PERFORMANCE.md',
  'ROADMAP.md',
  'ARCHITECTURE.md',
  'docs',
  'Start Audiobook Workbench.bat',
  'themes/_template',
  'themes/example-theme',
  // Preferred source form and build/installation scripts travel with the app.
  'server.ts',
  'src',
  'packages',
  'tools',
  'index.html',
  'tsconfig.json',
  'vite.config.ts',
  'scripts/build-release.ts',
  'scripts/build-audiobook-module.mjs',
  'scripts/audit-release.mjs',
  'scripts/build-release.bat',
  'scripts/third-party-notices.ts',
  'scripts/prepare-public-release.ps1',
  'scripts/smoke-release.mjs',
  'scripts/verify-release-runtime.mjs',
  'dist',
];

for (const source of releaseFiles) {
  const sourcePath = resolve(projectRoot, source);
  const destinationPath = resolve(releaseDirectory, source);
  if (!relative(releaseDirectory, destinationPath) || relative(releaseDirectory, destinationPath).startsWith('..')) {
    throw new Error(`Refusing to copy ${source} outside the release directory.`);
  }
  await cp(sourcePath, destinationPath, {
    recursive: true,
    filter: async (file) => {
      const info = await lstat(file);
      const name = relative(projectRoot, file).split(sep).join('/');
      if (info.isSymbolicLink()) throw new Error(`Release input must not be a symlink: ${name}`);
      if (/(^|\/)(runtime|models|node_modules|\.cache|\.git|local|\.installed-modules)(\/|$)/i.test(name) || /(^|\/)module-trust\.json$/.test(name) || name === 'tools/yt-dlp') return false;
      if (info.isDirectory()) return true;
      // New asset types need review; never copy executables, archives or models.
      const allowed = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.txt', '.map', '.png', '.jpg', '.jpeg', '.svg', '.bat', '.ps1', '.yml'];
      if (!allowed.includes(extname(name)) && !['LICENSE', '.env.example', '.gitignore', '.gitkeep'].includes(name.split('/').pop()!)) {
        throw new Error(`Unexpected release input; review before distributing: ${name}`);
      }
      return true;
    },
  });
}

console.log(releaseDirectory);
