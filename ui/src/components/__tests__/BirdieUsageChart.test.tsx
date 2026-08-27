import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders';
import BirdieUsageChart from '../BirdieUsageChart';

describe('BirdieUsageChart', () => {
  it('renders an empty-state message when there are no points', () => {
    renderWithProviders(<BirdieUsageChart points={[]} />);

    expect(screen.getByText('No birdie usage recorded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Birds used per session over time' })).not.toBeInTheDocument();
  });

  it('renders the chart axes, labels, and one point per usage entry', () => {
    const { container } = renderWithProviders(
      <BirdieUsageChart
        points={[
          { date: new Date('2026-01-09T12:00:00Z'), value: 5, totalBirds: 20, totalPlayers: 8, totalCourts: 4 },
          { date: new Date('2026-01-01T12:00:00Z'), value: 2, totalBirds: 8, totalPlayers: 4, totalCourts: 4 },
          { date: new Date('2026-01-05T12:00:00Z'), value: 3.5, totalBirds: 14, totalPlayers: 6, totalCourts: 4 },
        ]}
      />
    );

    expect(screen.getByRole('img', { name: 'Birds used per session over time' })).toBeInTheDocument();
    expect(screen.getByText('Session date')).toBeInTheDocument();
    expect(screen.getByText('Birds / court')).toBeInTheDocument();
    expect(screen.getByText('Jan 1')).toBeInTheDocument();
    expect(screen.getByText('Jan 5')).toBeInTheDocument();
    expect(screen.getByText('Jan 9')).toBeInTheDocument();
    expect(container.querySelectorAll('circle[fill="transparent"]')).toHaveLength(3);
  });

  it('shows and hides the hover tooltip for the sorted point being hovered', () => {
    const { container } = renderWithProviders(
      <BirdieUsageChart
        points={[
          { date: new Date('2026-01-09T12:00:00Z'), value: 5, totalBirds: 20, totalPlayers: 8, totalCourts: 4 },
          { date: new Date('2026-01-01T12:00:00Z'), value: 2, totalBirds: 8, totalPlayers: 4, totalCourts: 4 },
        ]}
      />
    );

    const hitTargets = container.querySelectorAll('circle[fill="transparent"]');
    fireEvent.mouseEnter(hitTargets[0]);

    expect(screen.getByText('Jan 1, 2026')).toBeInTheDocument();
    expect(screen.getByText('Total birds: 8')).toBeInTheDocument();
    expect(screen.getByText('Players: 4')).toBeInTheDocument();
    expect(screen.getByText('Courts: 4')).toBeInTheDocument();
    expect(screen.getByText('Avg birds/court: 2')).toBeInTheDocument();

    fireEvent.mouseLeave(hitTargets[0]);

    expect(screen.queryByText('Total birds: 8')).not.toBeInTheDocument();
  });
});
