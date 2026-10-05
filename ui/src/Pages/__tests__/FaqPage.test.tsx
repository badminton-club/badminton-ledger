import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders';
import FaqPage from '../FaqPage';

describe('FaqPage', () => {
  it('renders the help heading and every FAQ question, collapsed by default', () => {
    renderWithProviders(<FaqPage />);

    expect(screen.getByRole('heading', { name: 'Help & FAQ' })).toBeInTheDocument();
    expect(screen.getByText('What does "Comp" mean?')).toBeInTheDocument();
    expect(screen.getByText('What is "Default payer"?')).toBeInTheDocument();
    expect(screen.getByText('What is a "Guest" / "non-regular player"?')).toBeInTheDocument();

    // Answers are collapsed until a question is clicked — react-bootstrap keeps the
    // content in the DOM but without the "show" class.
    const compAnswer = screen.getByText(/club owner has settled this/);
    expect(compAnswer.closest('.accordion-collapse')).not.toHaveClass('show');
  });

  it('expands an answer when its question is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FaqPage />);

    await user.click(screen.getByText('What does "Comp" mean?'));

    const compAnswer = await screen.findByText(/club owner has settled this/);
    expect(compAnswer.closest('.accordion-collapse')).toHaveClass('show');
  });
});
