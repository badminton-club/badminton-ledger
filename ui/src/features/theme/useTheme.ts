import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

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

/**
 * Tracks the app's light/dark theme, reflecting it on `<html data-bs-theme="...">`
 * — the attribute Bootstrap 5.3 reads for dark mode — so Bootstrap components and
 * this app's `--color-*` CSS variables (see App.css) restyle together.
 *
 * The device's `prefers-color-scheme` is the default and is followed live. A theme
 * is only saved to localStorage once the user toggles it; that saved choice then
 * overrides the device setting on later visits.
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [saved, setSaved] = useState<Theme | null>(getSavedTheme);
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  const theme: Theme = saved ?? (systemDark ? 'dark' : 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setSaved(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable: the choice still applies for this session
    }
  }, [theme]);

  return { theme, toggleTheme };
}
