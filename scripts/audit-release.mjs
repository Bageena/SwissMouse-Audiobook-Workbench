// Copyright (C) 2026 SwissMouse contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Audit only public inputs, never the personal data in a used installation.
const packageRoot = process.argv[2];
const root = path.resolve(packageRoot || '.');
let files;
if (packageRoot) {
  files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Symlink in package: ${file}`);
      if (entry.isDirectory()) walk(file);
      else files.push(path.relative(root, file).replaceAll('\\', '/'));
    }
  };
  walk(root);
} else {
  files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: root }).split('\0').filter(Boolean);
}
const roots = new Set(['src', 'packages', 'tools', 'scripts', 'themes', 'docs', '.github', ...(packageRoot ? ['dist'] : [])]);
const rootFiles = new Set(['.env.example', '.gitignore', 'LICENSE', 'package.json', 'package-lock.json', 'server.ts', 'index.html', 'tsconfig.json', 'vite.config.ts', 'Start Audiobook Workbench.bat']);
for (const file of files) {
  const parts = file.split('/');
  assert.ok(parts.length > 1 ? roots.has(parts[0]) : rootFiles.has(file) || /^[A-Z][A-Z0-9_-]*\.md$/.test(file), `Unexpected public path: ${file}`);
  assert.ok(!/(^|\/)(node_modules|runtime|models|inputs|inbox|output|listening|logs|\.cache|\.tmp|local|\.installed-modules)(\/|$)|^tools\/yt-dlp(?:\/|$)|(^|\/)module-trust\.json$|\.smmodule$/i.test(file), `Private or installed component: ${file}`);
  assert.ok(!/\.(exe|dll|so|dylib|msi|zip|7z|rar|whl|nupkg|pt|onnx|safetensors|sqlite(?:-shm|-wal)?|bak|mp3|m4b|m4a|flac|ogg|opus|wav|mp4)$/i.test(file), `Binary, media, model, archive or local state: ${file}`);
  assert.ok(!/(^|\/)(jobs|config|ui-preferences)\.json$|^\.gitleaks-report/i.test(file), `Local data: ${file}`);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[''].version, manifest.version);
assert.equal(manifest.license, 'AGPL-3.0-or-later');
if (packageRoot) {
  for (const file of ['LICENSE', 'THIRD_PARTY.md', 'dist/THIRD_PARTY_NOTICES.txt', 'dist/server.cjs', 'dist/catalog-worker.cjs', 'src/main.tsx', 'docs/screenshots/alpha5-cheese.jpg', 'docs/screenshots/alpha5-forest.jpg'])
    assert.ok(fs.statSync(path.join(root, file)).size > 0, `Missing required release file: ${file}`);
}
console.log(`Release input audit passed: ${files.length} ${packageRoot ? 'packaged' : 'tracked/staged'} files; version ${manifest.version}; no private state, dependency trees or processing binaries.`);
