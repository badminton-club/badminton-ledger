import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Timestamp } from 'firebase/firestore';
import CalendarGrid from '../CalendarGrid';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { resetFirebaseTestState } from '../../../test-utils/firebaseTestHelpers';
import type { Session } from '../../../types';

beforeEach(() => {
  resetFirebaseTestState();
});

function makeSession(id: string, date: Date, overrides: Partial<Session> = {}): Session {
  return {
    id,
    date,
    durationHours: 2,
    courtCount: 2,
    totalCost: 0,
    totalCourtCost: 24,
    totalBirdieCost: 12,
    totalSessionCost: 36,
    birdieUsage: [],
    courtCreditUsage: [],
    players: [],
    createdAt: Timestamp.fromDate(new Date(2026, 0, 1)),
    ...overrides,
  };
}

describe('CalendarGrid', () => {
  it('renders the weekday header, 31 day cells, and August 2026 aligned to start on Saturday', () => {
    const { container } = renderWithProviders(
      <CalendarGrid currentDate={new Date(2026, 7, 15)} sessions={[]} selectedDate={null} onDayClick={jest.fn()} />
    );

    expect(screen.getByText('Sun')).toBeInTheDocument();
    expect(screen.getByText('Sat')).toBeInTheDocument();

    const grid = container.firstChild as HTMLElement;
    const weekRows = Array.from(grid.children).slice(1) as HTMLElement[];
    expect(weekRows).toHaveLength(6);

    const firstWeekCells = Array.from(weekRows[0].children) as HTMLElement[];
    expect(firstWeekCells).toHaveLength(7);
    firstWeekCells.slice(0, 6).forEach((cell) => expect(cell).toHaveTextContent(/^$/));
    expect(firstWeekCells[6]).toHaveTextContent('1');

    const dayCells = weekRows
      .flatMap((row) => Array.from(row.children) as HTMLElement[])
      .filter((cell) => /^\d+$/.test(cell.textContent?.trim() ?? ''));
    expect(dayCells).toHaveLength(31);
    expect(screen.getByText('31')).toBeInTheDocument();
  });

  it('shows multi-session counts on the correct day and calls onDayClick with that date', async () => {
    const user = userEvent.setup();
    const onDayClick = jest.fn();

    renderWithProviders(
      <CalendarGrid
        currentDate={new Date(2026, 7, 1)}
        selectedDate={new Date(2026, 7, 10)}
        onDayClick={onDayClick}
        sessions={[
          makeSession('s1', new Date(2026, 7, 10), {
            players: [{ id: 'p1', percentage: 100, cost: 18, paid: true, comped: false, highlighted: false }],
          }),
          makeSession('s2', new Date(2026, 7, 10), {
            players: [{ id: 'p2', percentage: 100, cost: 18, paid: false, comped: false, highlighted: false }],
          }),
          makeSession('s3', new Date(2026, 7, 12)),
        ]}
      />
    );

    const dayCell = screen.getByText('10').parentElement as HTMLElement;
    expect(dayCell).toHaveTextContent('×2');

    await user.click(dayCell);

    expect(onDayClick).toHaveBeenCalledTimes(1);
    expect(onDayClick).toHaveBeenCalledWith(new Date(2026, 7, 10));
  });
});
