import React from 'react';
import { Card, ButtonGroup, ToggleButton } from 'react-bootstrap';
import { useTheme, type ThemeMode } from '../features/theme/useTheme';

const OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
  { mode: 'system', label: 'Match device' },
];

/**
 * Light / Dark / Match device selector. "Match device" (the default) follows the
 * device's color scheme live; Light and Dark are saved overrides. See useTheme.
 */
export default function AppearanceCard() {
  const { mode, theme, setMode } = useTheme();

  return (
    <Card className="mt-3">
      <Card.Body>
        <Card.Title>Appearance</Card.Title>
        <Card.Text className="text-muted">
          Choose how the app looks. <strong>Match device</strong> follows your OS and updates live when it changes.
        </Card.Text>
        <ButtonGroup aria-label="Theme">
          {OPTIONS.map(({ mode: m, label }) => (
            <ToggleButton
              key={m}
              id={`theme-${m}`}
              type="radio"
              name="theme-mode"
              variant="outline-primary"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
            >
              {label}
            </ToggleButton>
          ))}
        </ButtonGroup>
        <div className="small text-muted mt-3">
          Currently showing: {mode === 'system' ? `Match device (${theme})` : theme}
        </div>
      </Card.Body>
    </Card>
  );
}
