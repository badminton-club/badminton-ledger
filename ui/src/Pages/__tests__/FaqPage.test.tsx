import React from 'react';
import { screen } from '@testing-library/react';
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

  it('opens an encoded GitHub issue draft without saving or adding private account data', async () => {
    const user = userEvent.setup();
    setCurrentUser({ uid: 'member-1', displayName: 'Jamie Lee', email: 'jamie@example.com' });

    renderWithProviders(<FaqPage />, {
      preloadedState: { club: makeClubState({ currentClubId: TEST_CLUB_ID }) },
    });

    const textarea = screen.getByPlaceholderText('What would you like to suggest?');
    const message = 'Add dark mode & contrast?\nThanks #1 + 你好';
    await user.type(textarea, message);

    const draftLink = screen.getByRole('link', { name: 'Open GitHub issue draft' });
    const url = new URL(draftLink.getAttribute('href')!);
    expect(url.origin + url.pathname).toBe('https://github.com/badminton-club/badminton-ledger/issues/new');
    expect(Array.from(url.searchParams.entries())).toEqual([
      ['title', 'App suggestion'],
      ['body', message],
    ]);
    expect(draftLink).toHaveAttribute('target', '_blank');
    expect(draftLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(draftLink).toHaveAttribute('aria-disabled', 'false');
    expect(textarea).toHaveValue(message);
    expect(screen.getByText(/GitHub issues are public/)).toBeInTheDocument();
    expect(screen.getByText(/review the draft, and submit it there/)).toBeInTheDocument();
    expect(screen.queryByText('Thanks — your suggestion was submitted.')).not.toBeInTheDocument();
    expect(__getAllPaths().some((p) => p.includes('/suggestions/'))).toBe(false);
  });

  it('disables the issue draft link for empty or whitespace-only suggestions', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FaqPage />);
    const draftLink = screen.getByRole('link', { name: 'Open GitHub issue draft' });
    expect(draftLink).toHaveAttribute('aria-disabled', 'true');
    expect(draftLink).toHaveAttribute('tabindex', '-1');
    await user.type(screen.getByLabelText('Your app suggestion'), '   ');
    expect(draftLink).toHaveAttribute('aria-disabled', 'true');
    expect(draftLink).toHaveAttribute('href', '#');
  });

  it('allows app feedback without a signed-in account or a selected club', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FaqPage />, {
      preloadedState: { club: makeClubState({ currentClubId: null }) },
    });
    await user.type(screen.getByLabelText('Your app suggestion'), '  Improve help  ');
    const draftLink = screen.getByRole('link', { name: 'Open GitHub issue draft' });
    expect(new URL(draftLink.getAttribute('href')!).searchParams.get('body')).toBe('Improve help');
    expect(draftLink).toHaveAttribute('aria-disabled', 'false');
  });
});
