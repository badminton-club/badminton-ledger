import React from 'react';
import { useTheme, type ThemeMode } from '../features/theme/useTheme';

const OPTIONS: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
  {
    mode: 'light',
    label: 'Light',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="5" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
    ),
  },
  {
    mode: 'dark',
    label: 'Dark',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15 3a9 9 0 1 0 6 15.5A9.5 9.5 0 0 1 15 3Z" fill="currentColor" />
      </svg>
    ),
  },
  {
    mode: 'system',
    label: 'Match device',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <line x1="8" y1="20" x2="16" y2="20" />
        <line x1="12" y1="16" x2="12" y2="20" />
      </svg>
    ),
  },
];

/**
 * A three-way Light / Dark / Match device selector. "Match device" (the default)
 * follows the device's color scheme; Light and Dark are saved overrides.
 * See useTheme for the persisted state it reads/writes.
 */
export default function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div
      role="group"
      aria-label="Theme"
      style={{
        display: 'inline-flex',
        borderRadius: 12,
        boxShadow: 'inset 0 0 0 1.5px #ffffff',
        background: 'rgba(255, 255, 255, 0.18)',
        padding: 2,
        gap: 2,
        flexShrink: 0,
      }}
    >
      {OPTIONS.map(({ mode: m, label, icon }) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-label={label}
            aria-pressed={active}
            title={label}
            style={{
              width: 24,
              height: 20,
              border: 'none',
              borderRadius: 10,
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              background: active ? '#ffffff' : 'transparent',
              color: active ? '#0d6efd' : '#ffffff',
            }}
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
}
