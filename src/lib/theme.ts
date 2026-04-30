// Theme controller — single source of truth for the light/dark/system
// toggle in the audit UI. Three call sites:
//   - The inline boot script in app/layout.tsx (must run before React
//     hydrates to avoid a flash of wrong theme; mirrors the logic
//     below as plain JS).
//   - The Theme-Toggle button in AuditApp.tsx (cycles through the
//     three modes and persists the choice).
//   - The render-time read in AuditApp.tsx (drives which icon the
//     toggle button shows).

export type Theme = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'seo-audit-theme';

const THEMES: readonly Theme[] = ['light', 'dark', 'system'];

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

// Resolves 'system' to the OS-level prefers-color-scheme. 'light' and
// 'dark' pass through. SSR-safe: returns 'light' when window is absent.
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Reads the user's saved choice; default 'system'. SSR-safe.
export function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

// Writes the resolved value to <html data-theme="…">. CSS picks up the
// attribute and swaps the token set.
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme(theme));
}

// Persists the user's choice and re-applies. Apply happens regardless
// of localStorage success so the UI reflects the click immediately.
export function setTheme(theme: Theme): void {
  applyTheme(theme);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode / quota — silently ignore */
  }
}

// Cycle order for the toggle button: system → light → dark → system.
export function nextTheme(current: Theme): Theme {
  if (current === 'system') return 'light';
  if (current === 'light') return 'dark';
  return 'system';
}
