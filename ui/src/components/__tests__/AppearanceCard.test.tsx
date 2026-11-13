import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppearanceCard from '../AppearanceCard';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-bs-theme');
});

it('switches between light, dark and match-device modes', async () => {
  const user = userEvent.setup();
  render(<AppearanceCard />);

  expect(screen.getByLabelText('Match device')).toBeChecked();

  await user.click(screen.getByLabelText('Dark'));
  expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
  expect(window.localStorage.getItem('theme-preference')).toBe('dark');

  await user.click(screen.getByLabelText('Match device'));
  expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
  expect(window.localStorage.getItem('theme-preference')).toBeNull();
  expect(screen.getByText(/Currently showing: Match device \(light\)/)).toBeInTheDocument();
});
