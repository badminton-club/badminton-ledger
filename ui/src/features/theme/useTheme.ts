import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export type ThemeMode = Theme | 'system';

// New key: the old 'theme' key was auto-saved on every visit, so it is not a real user choice.
const STORAGE_KEY = 'theme-preference';

function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function getSavedTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

const CHANGE_EVENT = 'theme-preference-change';

function savePreference(value: Theme | null) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, value);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable: the choice still applies for this session
  }
  // Keeps every useTheme instance (navbar toggle, account menu) in sync.
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Tracks the app's light/dark theme, reflecting it on `<html data-bs-theme="...">`
 * — the attribute Bootstrap 5.3 reads for dark mode — so Bootstrap components and
 * this app's `--color-*` CSS variables (see App.css) restyle together.
 *
 * By default the device's `prefers-color-scheme` is followed live. A theme is only
 * saved to localStorage once the user toggles it; that saved choice then overrides
 * the device setting until `setMode('system')` clears it.
 */
export function useTheme(): {
  theme: Theme;
  toggleTheme: () => void;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
} {
  const [saved, setSaved] = useState<Theme | null>(getSavedTheme);
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    const sync = () => setSaved(getSavedTheme());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const theme: Theme = saved ?? (systemDark ? 'dark' : 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setSaved(next);
    savePreference(next);
  }, [theme]);

  const setMode = useCallback((mode: ThemeMode) => {
    const value = mode === 'system' ? null : mode;
    setSaved(value);
    savePreference(value);
  }, []);

  return { theme, toggleTheme, mode: saved ?? 'system', setMode };
}
