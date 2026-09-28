// Copyright (C) 2026 SwissMouse contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';

interface ArchiveEntry {
  entryName: string;
  isDirectory: boolean;
  header: { attr: number };
  getData(): Buffer;
}

// The caller verifies the provider's archive checksum before passing entries.
// Keep all companion content, rather than guessing whether COPYING, LICENSE,
// a nested notice, or an HTML document contains this build's licensing terms.
export function installFfmpegDistribution(entries: ArchiveEntry[], runtimeRoot: string, archiveSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(archiveSha256)) throw new Error('Invalid FFmpeg archive SHA-256.');
  const files = entries.filter(entry => !entry.isDirectory);
  const ffmpeg = files.find(entry => /(^|\/)bin\/ffmpeg\.exe$/i.test(entry.entryName));
  const ffprobe = files.find(entry => /(^|\/)bin\/ffprobe\.exe$/i.test(entry.entryName));
  if (!ffmpeg || !ffprobe) throw new Error('The downloaded FFmpeg archive did not contain both ffmpeg.exe and ffprobe.exe.');

  const companions = files.filter(entry => !/\.(exe|dll|pdb|lib|a|so(?:\.\d+)*|dylib)$/i.test(entry.entryName));
  if (!companions.length) throw new Error('The FFmpeg archive has no accompanying distribution files; preserving the archive for review.');
  const seen = new Set<string>();
  for (const entry of companions) {
    const parts = entry.entryName.split('/');
    // Validate for Windows even when tests run on another platform. Refuse
    // aliases, device names, streams, traversal and archive symlink entries.
    if (parts.some(part => !part || part === '.' || part === '..' || /[\\<>:"|?*\x00-\x1f]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) ||
        ((entry.header.attr >>> 16) & 0xf000) === 0xa000) {
      throw new Error(`Unsafe FFmpeg distribution path: ${entry.entryName}`);
    }
    const key = entry.entryName.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate FFmpeg distribution path: ${entry.entryName}`);
    seen.add(key);
  }

  const root = path.resolve(runtimeRoot);
  function directory(relative: string) {
    let target = root;
    fs.mkdirSync(target, { recursive: true });
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error('FFmpeg runtime directory must not be redirected.');
    for (const part of relative.split('/').filter(Boolean)) {
      target = path.join(target, part);
      if (!fs.existsSync(target)) fs.mkdirSync(target);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`FFmpeg destination must be a real directory: ${target}`);
    }
    return target;
  }
  function write(relative: string, data: Buffer) {
    const parts = relative.split('/');
    const file = parts.pop()!;
    const target = path.join(directory(parts.join('/')), file);
    // Also catches dangling symlinks, which existsSync alone would miss.
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || !stat.isFile())) throw new Error(`Unsafe FFmpeg destination: ${target}`);
    fs.writeFileSync(target, data);
  }

  const noticesRelative = `licenses/ffmpeg/${archiveSha256}`;
  // Finish retaining upstream content before replacing either active binary.
  // A failed write propagates so the caller keeps the verified archive.
  for (const entry of companions) write(`${noticesRelative}/${entry.entryName}`, entry.getData());
  write('bin/ffmpeg.exe', ffmpeg.getData());
  write('bin/ffprobe.exe', ffprobe.getData());
  return { noticesDirectory: path.join(root, ...noticesRelative.split('/')), preservedFiles: companions.length };
}
