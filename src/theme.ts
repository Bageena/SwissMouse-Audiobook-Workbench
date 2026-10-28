export const themes = ['light', 'parchment', 'blue', 'slate', 'forest', 'dark', 'cheese'] as const;

export type AppTheme = (typeof themes)[number];

export interface CustomTheme {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  extends: AppTheme;
  tokens: Record<string, string>;
}

export interface ThemeDiscoveryResponse {
  themes: CustomTheme[];
  warnings: string[];
  directory: string;
}

export const themeLabels: Record<AppTheme, string> = {
  light: 'Light',
  parchment: 'Parchment',
  blue: 'Blue',
  slate: 'Slate',
  forest: 'Forest',
  dark: 'Dark',
  cheese: 'Cheese · Paper & Ink',
};

export const THEME_STORAGE_KEY = 'swissmouse_appearance_theme';
export const DEFAULT_THEME: AppTheme = 'forest';
let appliedCustomTokens = new Set<string>();

export function isAppTheme(value: string | null): value is AppTheme {
  return themes.includes(value as AppTheme);
}

export function getStoredTheme(): string {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored && /^[a-z][a-z0-9-]{1,63}$/.test(stored) ? stored : DEFAULT_THEME;
  } catch { return DEFAULT_THEME; }
}

export function applyTheme(themeId: string, customTheme?: CustomTheme): void {
  for (const token of appliedCustomTokens) document.documentElement.style.removeProperty(token);
  appliedCustomTokens = new Set();

  const baseTheme = customTheme?.extends ?? (isAppTheme(themeId) ? themeId : DEFAULT_THEME);
  document.documentElement.dataset.theme = baseTheme;
  document.documentElement.dataset.themeId = customTheme?.id ?? baseTheme;
  document.documentElement.style.colorScheme = baseTheme === 'dark' ? 'dark' : 'light';
  if (customTheme) {
    for (const [token, value] of Object.entries(customTheme.tokens)) {
      document.documentElement.style.setProperty(token, value);
      appliedCustomTokens.add(token);
    }
  }
  window.dispatchEvent(new CustomEvent('swissmouse-theme-changed', { detail: { themeId } }));
}

export function persistTheme(themeId: string, customTheme?: CustomTheme): void {
  try { localStorage.setItem(THEME_STORAGE_KEY, themeId); } catch { /* Apply for this session when browser storage is blocked. */ }
  applyTheme(themeId, customTheme);
}
