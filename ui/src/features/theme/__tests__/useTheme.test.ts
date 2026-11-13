import { act, renderHook } from '@testing-library/react';
import { useTheme } from '../useTheme';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-bs-theme');
});

describe('useTheme', () => {
  it('defaults to light mode without saving anything', () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
    expect(window.localStorage.getItem('theme-preference')).toBeNull();
  });

  it('follows the device setting live until the user picks a theme', () => {
    let listener: ((e: { matches: boolean }) => void) | undefined;
    const original = window.matchMedia;
    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: (_: string, cb: typeof listener) => { listener = cb; },
      removeEventListener: jest.fn(),
    })) as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(window.localStorage.getItem('theme-preference')).toBeNull();

    act(() => listener!({ matches: false }));
    expect(result.current.theme).toBe('light');

    act(() => result.current.toggleTheme());
    act(() => listener!({ matches: true }));
    expect(result.current.theme).toBe('dark');
    expect(window.localStorage.getItem('theme-preference')).toBe('dark');

    act(() => listener!({ matches: false }));
    expect(result.current.theme).toBe('dark');

    // toggling back to the device's theme resets to following the device
    act(() => result.current.toggleTheme());
    expect(window.localStorage.getItem('theme-preference')).toBeNull();
    act(() => listener!({ matches: true }));
    expect(result.current.theme).toBe('dark');

    window.matchMedia = original;
  });

  it('lets a saved theme override the device setting', () => {
    const original = window.matchMedia;
    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn(),
    })) as unknown as typeof window.matchMedia;
    window.localStorage.setItem('theme-preference', 'light');

    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');

    window.matchMedia = original;
  });

  it('toggles to dark mode, persisting it and updating the document root', () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    expect(window.localStorage.getItem('theme-preference')).toBe('dark');

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
    expect(window.localStorage.getItem('theme-preference')).toBeNull();
  });

  it('restores a previously saved theme on mount', () => {
    window.localStorage.setItem('theme-preference', 'dark');

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
  });

  it('ignores the legacy auto-saved "theme" key', () => {
    window.localStorage.setItem('theme', 'light');
    const original = window.matchMedia;
    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn(),
    })) as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');

    window.matchMedia = original;
  });
});
