import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverCustomThemes } from './custom-themes';
import { applyTheme, getStoredTheme, persistTheme } from '../src/theme';

function fixture(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'swissmouse-themes-')); }

test('switching themes clears custom tokens and tolerates blocked browser storage', () => {
  const keys = ['document', 'window', 'localStorage'] as const;
  const previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const tokens = new Map<string, string>();
  const root = { dataset: {} as Record<string, string>, style: {
    colorScheme: '', setProperty: (key: string, value: string) => tokens.set(key, value), removeProperty: (key: string) => tokens.delete(key),
  } };
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: root } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent() {} } });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
    assert.equal(getStoredTheme(), 'forest');
    applyTheme('custom', { id: 'custom', name: 'Custom', version: '1', extends: 'blue', tokens: { '--sm-accent': '#123456' } });
    assert.equal(root.dataset.theme, 'blue');
    assert.equal(tokens.get('--sm-accent'), '#123456');
    persistTheme('dark');
    assert.equal(root.dataset.theme, 'dark');
    assert.equal(root.dataset.themeId, 'dark');
    assert.equal(root.style.colorScheme, 'dark');
    assert.equal(tokens.size, 0);
  } finally {
    keys.forEach((key, index) => { if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!); else delete (globalThis as any)[key]; });
  }
});
function writeTheme(root: string, folder: string, manifest: object, css = ':root { --sm-accent: #456789; }') {
  const directory = path.join(root, folder); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'theme.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, 'theme.css'), css);
}

test('cover frames accept theme colors and bounded dimensions', () => {
  const root = fixture();
  try {
    writeTheme(root, 'framed', { name: 'Framed', id: 'framed', version: '1', extends: 'cheese', css: 'theme.css' }, ':root { --sm-cover-frame-bg: #eee; --sm-cover-frame-border: #765; --sm-cover-mat: #fff; --sm-cover-frame-shadow: #0006; --sm-cover-frame-padding: 12px; --sm-cover-frame-radius: 0px; }');
    for (const [index, value] of ['-1px', '100px', 'url(example)', '2rem'].entries()) {
      const id = `bad-frame-${index}`;
      writeTheme(root, id, { name: id, id, version: '1', extends: 'light', css: 'theme.css' }, `:root { --sm-cover-frame-padding: ${value}; }`);
    }
    const result = discoverCustomThemes(root);
    assert.deepEqual(result.themes.map(theme => theme.id), ['framed']);
    assert.equal(result.themes[0].tokens['--sm-cover-frame-padding'], '12px');
    assert.equal(result.warnings.length, 4);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('invalid colors cannot poison a theme and valid color formats work', () => {
  const root = fixture();
  try {
    for (const [index, color] of ['not-a-color', 'var(--missing)', 'rgb(999, 0, 0)', 'rgba(0, 0, 0, 2)', 'hsl(20, 50, 50)'].entries()) {
      const id = `bad-${index}`;
      writeTheme(root, id, { name: id, id, version: '1', extends: 'light', css: 'theme.css' }, `:root { --sm-accent: ${color}; }`);
    }
    writeTheme(root, 'valid', { name: 'Valid', id: 'valid', version: '1', extends: 'dark', css: 'theme.css' }, ':root { --sm-accent: RGBA(20, 40, 60, 0.5); --sm-on-accent: #fff; --sm-ring: HSL(210, 50%, 40%); }');
    const result = discoverCustomThemes(root);
    assert.deepEqual(result.themes.map(theme => theme.id), ['valid']);
    assert.equal(result.warnings.length, 5);
    assert.equal(result.themes[0].tokens['--sm-on-accent'], '#fff');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unreadable theme root reports a warning instead of stopping startup', () => {
  const root = fixture();
  try {
    const notDirectory = path.join(root, 'file'); fs.writeFileSync(notDirectory, 'fixture');
    const result = discoverCustomThemes(notDirectory);
    assert.equal(result.themes.length, 0);
    assert.equal(result.warnings.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('discovers approved variables and built-in inheritance', () => {
  const root = fixture();
  try {
    writeTheme(root, 'ocean-mist', { name: 'Ocean Mist', id: 'ocean-mist', version: '1.0', extends: 'blue', css: 'theme.css' }, ':root { --sm-app-bg: ; --sm-accent: #456789; }');
    const result = discoverCustomThemes(root);
    assert.equal(result.warnings.length, 0);
    assert.deepEqual(result.themes[0], { id: 'ocean-mist', name: 'Ocean Mist', version: '1.0', author: undefined, description: undefined, extends: 'blue', tokens: { '--sm-accent': '#456789' } });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('isolates invalid themes and rejects unrestricted CSS', () => {
  const root = fixture();
  try {
    writeTheme(root, 'valid-theme', { name: 'Valid', id: 'valid-theme', version: '1.0', extends: 'light', css: 'theme.css' });
    writeTheme(root, 'broken-theme', { name: 'Broken', id: 'broken-theme', version: '1.0', extends: 'light', css: 'theme.css' }, ':root { --sm-accent: red; } body { display: none; }');
    const result = discoverCustomThemes(root);
    assert.deepEqual(result.themes.map(theme => theme.id), ['valid-theme']);
    assert.match(result.warnings[0], /only one :root|Invalid declaration/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects duplicate built-in ids without blocking other themes', () => {
  const root = fixture();
  try {
    writeTheme(root, 'light', { name: 'Fake Light', id: 'light', version: '1.0', extends: 'dark', css: 'theme.css' });
    writeTheme(root, 'safe-theme', { name: 'Safe', id: 'safe-theme', version: '1.0', extends: 'forest', css: 'theme.css' });
    const result = discoverCustomThemes(root);
    assert.deepEqual(result.themes.map(theme => theme.id), ['safe-theme']);
    assert.match(result.warnings[0], /duplicate or reserved/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('accepts local raster assets and rejects missing CSS files', () => {
  const root = fixture();
  try {
    writeTheme(root, 'asset-theme', { name: 'Asset', id: 'asset-theme', version: '1.0', extends: 'parchment', css: 'theme.css' }, ':root { --sm-app-background-image: url("./assets/paper.webp"); }');
    fs.mkdirSync(path.join(root, 'asset-theme', 'assets'));
    fs.writeFileSync(path.join(root, 'asset-theme', 'assets', 'paper.webp'), 'test');
    const missing = path.join(root, 'missing-css'); fs.mkdirSync(missing);
    fs.writeFileSync(path.join(missing, 'theme.json'), JSON.stringify({ name: 'Missing', id: 'missing-css', version: '1.0', extends: 'light', css: 'theme.css' }));
    const result = discoverCustomThemes(root);
    assert.match(result.themes[0].tokens['--sm-app-background-image'], /^url\("\/api\/themes\/assets\/asset-theme\/paper\.webp\?v=\d+"\)$/);
    assert.match(result.warnings[0], /missing CSS file/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('loading motion tokens accept bounded tuning and reject invalid dimensions', () => {
  const root=fixture();
  try {
    writeTheme(root,'loading',{name:'Loading',id:'loading',version:'1',extends:'cheese',css:'theme.css'},':root { --sm-loading-lift: 8px; --sm-loading-scale: 1.4; --sm-loading-duration: 250ms; --sm-loading-spin-duration: 900ms; --sm-loading-shadow: #302e2966; }');
    for(const [index,value] of ['0','3','url(bad)'].entries()) writeTheme(root,`invalid-loading-${index}`,{name:'Invalid',id:`invalid-loading-${index}`,version:'1',extends:'light',css:'theme.css'},`:root { --sm-loading-scale: ${value}; }`);
    const result=discoverCustomThemes(root);
    assert.deepEqual(result.themes.map(theme=>theme.id),['loading']); assert.equal(result.warnings.length,3);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
