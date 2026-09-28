// Copyright (C) 2026 SwissMouse contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

// Include actual bundled packages, plus CSS and Vite's virtual browser helpers.
export function thirdPartyNotices(): Plugin {
  let root: string;
  return {
    name: 'swissmouse-third-party-notices',
    apply: 'build',
    configResolved(config) { root = config.root; },
    generateBundle(_options, bundle) {
      const packages = new Set<string>(['tailwindcss', 'vite'].map(name => resolve(root, 'node_modules', name)));
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of Object.keys(output.modules)) {
          if (!id.replaceAll('\\', '/').includes('/node_modules/')) continue;
          let directory = dirname(id.replace(/^\0/, '').split('?')[0]);
          while (directory.replaceAll('\\', '/').includes('/node_modules/')) {
            const manifest = resolve(directory, 'package.json');
            if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name) break;
            directory = dirname(directory);
          }
          if (!directory.replaceAll('\\', '/').includes('/node_modules/')) throw new Error(`Cannot identify bundled dependency: ${id}`);
          packages.add(directory);
        }
      }
      const sections = [...packages].sort().map(directory => {
        const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
        const files = readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name)).sort();
        if (!files.some(name => /^(licen[cs]e|copying)([.-]|$)/i.test(name))) {
          throw new Error(`Missing license text for bundled dependency ${manifest.name}; review before releasing.`);
        }
        return `${manifest.name} ${manifest.version}\nDeclared license: ${manifest.license || 'See text below'}\n${manifest.homepage || ''}\n\n` +
          files.map(name => `--- ${name} ---\n${readFileSync(resolve(directory, name), 'utf8')}`).join('\n');
      });
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source:
        'Third-party notices for the SwissMouse browser build\n\n' +
        'These components retain their own licenses. This file does not relicense them under the SwissMouse AGPL.\n' +
        'Generated from installed package license files. Vite and Tailwind notices cover build-provided browser helpers and CSS.\n\n' +
        sections.join('\n\n============================================================\n\n') });
    },
  };
}
