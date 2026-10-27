import fs from 'node:fs';
import { replaceFileAtomically } from './atomic-file';

export function validThemeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(value);
}

export function readAppearance(file: string): { theme: string | null } {
  if (!fs.existsSync(file)) return { theme: null };
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!validThemeId(value?.theme)) throw new Error('The shared appearance preference is invalid.');
  return { theme: value.theme };
}

export function saveAppearance(file: string, theme: string, initialize = false): { theme: string } {
  if (!validThemeId(theme)) throw new Error('Choose a valid theme.');
  if (initialize) {
    const current = readAppearance(file);
    if (current.theme) return { theme: current.theme };
  }
  replaceFileAtomically(file, JSON.stringify({ theme }, null, 2) + '\n');
  return { theme };
}
