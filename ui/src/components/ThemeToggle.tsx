import React from 'react';
import { useTheme } from '../features/theme/useTheme';

const TRACK_WIDTH = 34;
const TRACK_HEIGHT = 18;
const KNOB_SIZE = 18;
const KNOB_INSET = (TRACK_HEIGHT - KNOB_SIZE) / 2;

/**
 * A sliding light/dark switch — a pill-shaped track with a circular knob
 * that carries a small sun (light mode) or moon (dark mode) glyph and slides
 * to the opposite side when clicked. Mirrors the familiar iOS/Android-style
 * theme switch. See useTheme for the persisted state it reads/writes.
 */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      style={{
        width: TRACK_WIDTH,
        height: TRACK_HEIGHT,
        borderRadius: TRACK_HEIGHT / 2,
        border: 'none',
        boxShadow: 'inset 0 0 0 1.5px #ffffff',
        background: 'rgba(255, 255, 255, 0.18)',
        padding: 0,
        boxSizing: 'border-box',
        position: 'relative',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: KNOB_INSET,
          left: isDark ? TRACK_WIDTH - KNOB_SIZE - KNOB_INSET : KNOB_INSET,
          width: KNOB_SIZE,
          height: KNOB_SIZE,
          borderRadius: '50%',
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'left 0.2s ease',
        }}
      >
        {isDark ? (
          // Moon — shown in the knob once dark mode is active
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 3a9 9 0 1 0 6 15.5A9.5 9.5 0 0 1 15 3Z" fill="#0d6efd" />
          </svg>
        ) : (
          // Sun — shown in the knob while light mode is active
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="5" fill="#0d6efd" />
            <g stroke="#0d6efd" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="1.5" x2="12" y2="3.5" />
              <line x1="12" y1="20.5" x2="12" y2="22.5" />
              <line x1="1.5" y1="12" x2="3.5" y2="12" />
              <line x1="20.5" y1="12" x2="22.5" y2="12" />
              <line x1="4.7" y1="4.7" x2="6.1" y2="6.1" />
              <line x1="17.9" y1="17.9" x2="19.3" y2="19.3" />
              <line x1="4.7" y1="19.3" x2="6.1" y2="17.9" />
              <line x1="17.9" y1="6.1" x2="19.3" y2="4.7" />
            </g>
          </svg>
        )}
      </span>
    </button>
  );
}
