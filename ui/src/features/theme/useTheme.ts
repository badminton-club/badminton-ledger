import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

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
    // Toggling back to the device's theme clears the override, so the app
    // follows the device setting again.
    const matchesDevice = next === (systemDark ? 'dark' : 'light');
    setSaved(matchesDevice ? null : next);
    try {
      if (matchesDevice) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable: the choice still applies for this session
    }
  }, [theme, systemDark]);

  return { theme, toggleTheme };
}
