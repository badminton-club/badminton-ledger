import { act, renderHook } from '@testing-library/react';
import { useTheme } from '../useTheme';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-bs-theme');
});

describe('useTheme', () => {
  it('defaults to light mode and reflects it on the document root and localStorage', () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
    expect(window.localStorage.getItem('theme')).toBe('light');
  });

  it('toggles to dark mode, persisting it and updating the document root', () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    expect(window.localStorage.getItem('theme')).toBe('dark');

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
    expect(window.localStorage.getItem('theme')).toBe('light');
  });

  it('restores a previously saved theme on mount', () => {
    window.localStorage.setItem('theme', 'dark');

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
  });
});
