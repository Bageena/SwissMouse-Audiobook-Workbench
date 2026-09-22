import fs from 'node:fs';
import path from 'node:path';

export const BUILT_IN_THEME_IDS = ['light', 'parchment', 'blue', 'slate', 'forest', 'dark'] as const;

export const CUSTOM_THEME_TOKENS = new Set([
  '--sm-app-bg', '--sm-app-bg-top', '--sm-app-background-image',
  '--sm-surface', '--sm-surface-elevated', '--sm-surface-subtle', '--sm-input', '--sm-hover',
  '--sm-ink', '--sm-text-secondary', '--sm-muted', '--sm-border', '--sm-border-soft',
  '--sm-accent', '--sm-accent-hover', '--sm-accent-soft', '--sm-accent-text', '--sm-secondary-accent',
  '--sm-strong', '--sm-strong-hover', '--sm-on-strong', '--sm-on-strong-muted', '--sm-on-accent',
  '--sm-success', '--sm-success-soft', '--sm-warning', '--sm-warning-soft',
  '--sm-error', '--sm-error-soft', '--sm-info', '--sm-info-soft', '--sm-ring', '--sm-overlay',
  '--sm-terminal-bg', '--sm-terminal-header', '--sm-terminal-text', '--sm-terminal-muted', '--sm-terminal-border',
  '--sm-waveform-baseline', '--sm-waveform', '--sm-waveform-playhead',
  '--sm-chapter-marker', '--sm-chapter-marker-selected',
  '--sm-transcript-highlight', '--sm-transcript-highlight-text',
]);

export interface CustomThemeDefinition {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  extends: typeof BUILT_IN_THEME_IDS[number];
  tokens: Record<string, string>;
}

export interface CustomThemeDiscovery {
  themes: CustomThemeDefinition[];
  warnings: string[];
}

const safeId = /^[a-z][a-z0-9-]{1,63}$/;
const safeAsset = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:png|jpe?g|webp|gif|avif)$/i;

function validColor(value: string): boolean {
  if (/^#(?:[a-f\d]{3,4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value)) return true;
  if (/^(transparent|black|white|red|green|blue|gray|grey|yellow|orange|purple|navy|teal|maroon|olive|silver|lime|aqua|fuchsia)$/i.test(value)) return true;
  const match = /^(rgb|rgba|hsl|hsla)\(([^()]+)\)$/i.exec(value);
  if (!match) return false;
  const parts = match[2].split(',').map(part => part.trim());
  const functionName = match[1].toLowerCase();
  if (parts.length !== (functionName.endsWith('a') ? 4 : 3)) return false;
  return parts.every((part, index) => {
    if (!/^\d+(?:\.\d+)?%?$/.test(part)) return false;
    const number = parseFloat(part);
    const percent = part.endsWith('%');
    if (index === 3) return number <= (percent ? 100 : 1);
    if (functionName.startsWith('hsl')) return index === 0 ? !percent && number <= 360 : percent && number <= 100;
    return number <= (percent ? 100 : 255);
  });
}

function containedFile(directory: string, file: string): boolean {
  const relative = path.relative(fs.realpathSync(directory), fs.realpathSync(file));
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative) && fs.statSync(file).isFile();
}

function parseThemeCss(css: string, themeDirectory: string, themeId: string): Record<string, string> {
  if (Buffer.byteLength(css, 'utf8') > 64 * 1024) throw new Error('theme.css exceeds the 64 KB limit');
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const rootMatch = withoutComments.match(/^:root\s*\{([^{}]*)\}\s*$/);
  if (!rootMatch) throw new Error('theme.css must contain only one :root { ... } variable block');

  const tokens: Record<string, string> = {};
  for (const rawDeclaration of rootMatch[1].split(';')) {
    const declaration = rawDeclaration.trim();
    if (!declaration) continue;
    const match = declaration.match(/^(--[a-z0-9-]+)\s*:\s*(.*)$/i);
    if (!match) throw new Error(`Invalid declaration: ${declaration.slice(0, 80)}`);
    const [, token, rawValue] = match;
    if (!CUSTOM_THEME_TOKENS.has(token)) throw new Error(`Unsupported theme variable: ${token}`);
    const value = rawValue.trim();
    if (!value) continue;
    if (value.length > 300 || /[{};@]|expression\s*\(|javascript:|data:/i.test(value)) {
      throw new Error(`Unsafe or invalid value for ${token}`);
    }
    if (token === '--sm-app-background-image') {
      if (value === 'none') { tokens[token] = value; continue; }
      const assetMatch = value.match(/^url\(\s*["']?\.\/assets\/([^"')/\\]+)["']?\s*\)$/i);
      const assetName = assetMatch?.[1];
      if (!assetName || !safeAsset.test(assetName)) throw new Error('Background image must be none or a raster file in ./assets/');
      const assetPath = path.join(themeDirectory, 'assets', assetName);
      if (!fs.existsSync(assetPath) || !containedFile(themeDirectory, assetPath)) throw new Error(`Background asset is missing or outside the theme: assets/${assetName}`);
      const assetVersion = Math.round(fs.statSync(assetPath).mtimeMs);
      tokens[token] = `url("/api/themes/assets/${encodeURIComponent(themeId)}/${encodeURIComponent(assetName)}?v=${assetVersion}")`;
      continue;
    }
    if (!validColor(value)) throw new Error(`Invalid color for ${token}; use a hex color, rgb(a), hsl(a), or a basic named color`);
    tokens[token] = value;
  }
  return tokens;
}

export function discoverCustomThemes(themesDirectory: string): CustomThemeDiscovery {
  const result: CustomThemeDiscovery = { themes: [], warnings: [] };
  try { fs.mkdirSync(themesDirectory, { recursive: true }); }
  catch (error) { return { themes: [], warnings: [`Cannot create themes folder: ${String(error)}`] }; }
  const seen = new Set<string>(BUILT_IN_THEME_IDS);
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(themesDirectory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
  catch (error) { return { themes: [], warnings: [`Cannot read themes folder: ${String(error)}`] }; }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const directory = path.join(themesDirectory, entry.name);
    try {
      const manifestPath = path.join(directory, 'theme.json');
      if (!fs.existsSync(manifestPath)) throw new Error('missing theme.json');
      if (!containedFile(directory, manifestPath) || fs.statSync(manifestPath).size > 32 * 1024) throw new Error('theme.json is outside the theme or exceeds 32 KB');
      const manifestText = fs.readFileSync(manifestPath, 'utf8');
      if (Buffer.byteLength(manifestText, 'utf8') > 32 * 1024) throw new Error('theme.json exceeds the 32 KB limit');
      const manifest = JSON.parse(manifestText) as Record<string, unknown>;
      for (const key of ['name', 'id', 'version', 'extends', 'css']) {
        if (typeof manifest[key] !== 'string' || !String(manifest[key]).trim()) throw new Error(`${key} must be a non-empty string`);
      }
      const id = String(manifest.id);
      if (!safeId.test(id)) throw new Error('id must use lowercase letters, numbers, and hyphens');
      if (id !== entry.name) throw new Error(`folder name must match theme id "${id}"`);
      if (seen.has(id)) throw new Error(`duplicate or reserved theme id "${id}"`);
      if (!BUILT_IN_THEME_IDS.includes(manifest.extends as typeof BUILT_IN_THEME_IDS[number])) throw new Error(`invalid base theme "${manifest.extends}"`);
      const cssName = String(manifest.css);
      if (path.basename(cssName) !== cssName || !cssName.toLowerCase().endsWith('.css')) throw new Error('css must name a CSS file in the theme folder');
      const cssPath = path.join(directory, cssName);
      if (!fs.existsSync(cssPath) || !containedFile(directory, cssPath)) throw new Error(`missing CSS file "${cssName}" or file outside the theme`);
      if (fs.statSync(cssPath).size > 64 * 1024) throw new Error('theme.css exceeds the 64 KB limit');
      const tokens = parseThemeCss(fs.readFileSync(cssPath, 'utf8'), directory, id);
      seen.add(id);
      result.themes.push({
        id,
        name: String(manifest.name).trim(),
        version: String(manifest.version).trim(),
        author: typeof manifest.author === 'string' ? manifest.author.trim() : undefined,
        description: typeof manifest.description === 'string' ? manifest.description.trim() : undefined,
        extends: manifest.extends as CustomThemeDefinition['extends'],
        tokens,
      });
    } catch (error) {
      result.warnings.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

export function isSafeThemeAssetName(value: string): boolean {
  return safeAsset.test(value);
}
