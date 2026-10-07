import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, makeClubState } from '../../test-utils/renderWithProviders';
import { resetFirebaseTestState, setCurrentUser, TEST_CLUB_ID } from '../../test-utils/firebaseTestHelpers';
import { __getAllPaths } from '../../test-utils/fakeFirestore';
import FaqPage from '../FaqPage';

describe('FaqPage', () => {
  beforeEach(() => {
    resetFirebaseTestState();
  });

  it('renders the help heading and every FAQ question, collapsed by default', () => {
    renderWithProviders(<FaqPage />);

    expect(screen.getByRole('heading', { name: 'Help & FAQ' })).toBeInTheDocument();
    expect(screen.getByText('How do I get access to Gmail e-Transfer imports?')).toBeInTheDocument();
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

  it('explains the e-Transfer import eligibility and approval requirements', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FaqPage />);

    await user.click(screen.getByText('How do I get access to Gmail e-Transfer imports?'));

    const canadaRequirement = screen.getByText(/supported only for Canadian Interac/i);
    expect(canadaRequirement.closest('.accordion-collapse')).toHaveClass('show');
    expect(screen.getByText(/wait for confirmation that the account has been approved/i)).toBeInTheDocument();
    expect(screen.getByText(/opens a prefilled message to wedclub2026@gmail.com/i)).toBeInTheDocument();
  });

  it('builds a tester-access email for the requested Google account', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FaqPage />);

    await user.click(screen.getByText('How do I get access to Gmail e-Transfer imports?'));
    const requestLink = screen.getByText('Open access request email');
    expect(requestLink).toHaveAttribute('aria-disabled', 'true');

    await user.type(screen.getByLabelText('Google/Gmail email to approve'), 'treasurer@gmail.com');

    expect(requestLink).toHaveAttribute('aria-disabled', 'false');
    expect(requestLink.getAttribute('href')).toContain('mailto:wedclub2026@gmail.com');
    expect(requestLink.getAttribute('href')).toContain('treasurer%40gmail.com');
  });

  it('submits a suggestion and saves it under the current club', async () => {
    const user = userEvent.setup();
    setCurrentUser({ uid: 'member-1', displayName: 'Jamie Lee', email: 'jamie@example.com' });

    renderWithProviders(<FaqPage />, {
      preloadedState: { club: makeClubState({ currentClubId: TEST_CLUB_ID }) },
    });

    const textarea = screen.getByPlaceholderText('What would you like to suggest?');
    await user.type(textarea, 'Add dark mode please');

    const submitButton = screen.getByRole('button', { name: 'Submit suggestion' });
    await user.click(submitButton);

    expect(await screen.findByText('Thanks — your suggestion was submitted.')).toBeInTheDocument();
    // Clears the box so a second suggestion isn't accidentally appended to it.
    expect(textarea).toHaveValue('');

    await waitFor(() => {
      const path = __getAllPaths().find((p) => p.startsWith(`clubs/${TEST_CLUB_ID}/suggestions/`));
      expect(path).toBeDefined();
    });
  });

  it('disables the submit button until a suggestion is typed', () => {
    setCurrentUser({ uid: 'member-1', displayName: 'Jamie Lee', email: 'jamie@example.com' });
    renderWithProviders(<FaqPage />, {
      preloadedState: { club: makeClubState({ currentClubId: TEST_CLUB_ID }) },
    });

    expect(screen.getByRole('button', { name: 'Submit suggestion' })).toBeDisabled();
  });
});
