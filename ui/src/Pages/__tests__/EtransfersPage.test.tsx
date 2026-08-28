import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EtransfersPage from '../EtransfersPage';
import { renderWithProviders, makeClubState, makePlayersState } from '../../test-utils/renderWithProviders';
import {
  resetFirebaseTestState,
  seedClubDoc,
  getClubDocData,
  setCurrentUser,
  ts,
} from '../../test-utils/firebaseTestHelpers';
import { searchEtransferEmails, labelEtransferEmailProcessed } from '../../services/firebase/gmail';
import type { Player } from '../../types';

jest.mock('../../services/firebase/gmail', () => {
  const actual = jest.requireActual('../../services/firebase/gmail');
  return {
    ...actual,
    searchEtransferEmails: jest.fn(),
    labelEtransferEmailProcessed: jest.fn(),
  };
});

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    firstName: 'Cai',
    firstNameLower: 'cai',
    lastName: 'Wu',
    lastNameLower: 'wu',
    email: null,
    balance: 10,
    owed: 0,
    description: '',
    sessionCount: 0,
    createdAt: undefined as never,
    ...overrides,
  };
}

function renderPage() {
  return renderWithProviders(<EtransfersPage />, {
    route: '/etransfers',
    preloadedState: {
      club: makeClubState(),
      players: makePlayersState([makePlayer()]),
    },
  });
}

describe('EtransfersPage', () => {
  beforeEach(() => {
    resetFirebaseTestState();
    setCurrentUser({ uid: 'admin-1', displayName: 'Admin', email: 'admin@example.com' });
    jest.mocked(searchEtransferEmails).mockReset();
    jest.mocked(labelEtransferEmailProcessed).mockReset().mockResolvedValue(undefined);
  });

  it('finds new e-Transfer emails via search, matches by name, and lists them for review', async () => {
    const user = userEvent.setup();
    seedClubDoc('players', 'p1', makePlayer());
    jest.mocked(searchEtransferEmails).mockResolvedValue([
      {
        gmailMessageId: 'msg-1',
        gmailThreadId: 'thread-1',
        subject: "Interac e-Transfer: You've received $200.00 from CAI FANG WU and it has been automatically deposited.",
        senderName: 'CAI FANG WU',
        senderEmail: 'caifang1966@gmail.com',
        amount: 200,
        memo: 'cash for shoppers',
        referenceNumber: 'C1AYd8eJYUcY',
        emailDate: new Date('2026-08-26T14:47:00.000Z'),
      },
    ]);

    renderPage();
    expect(await screen.findByText('Nothing to review — search Gmail to find new e-Transfers.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /connect gmail & search/i }));

    expect(await screen.findByText('CAI FANG WU')).toBeInTheDocument();
    expect(screen.getByText('cash for shoppers')).toBeInTheDocument();
    expect(await screen.findByText(/found 1 email\(s\) — 1 new/i)).toBeInTheDocument();
    // Single-candidate name lookup ("Cai" matches the seeded player "Cai Wu") pre-selects the player.
    expect(screen.getByRole('combobox')).toHaveValue('p1');
  });

  it('approves a pending import: credits the player balance, moves it to history, and labels the Gmail message', async () => {
    const user = userEvent.setup();
    seedClubDoc('players', 'p1', makePlayer());
    seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      gmailThreadId: 'thread-1',
      subject: 'subject',
      senderName: 'CAI FANG WU',
      senderEmail: 'caifang1966@gmail.com',
      amount: 200,
      memo: 'cash for shoppers',
      referenceNumber: 'C1AYd8eJYUcY',
      emailDate: ts('2026-08-26'),
      status: 'pending',
      matchedPlayerId: 'p1',
      matchSource: 'name-lookup',
      createdAt: ts('2026-08-26'),
    });

    renderPage();
    expect(await screen.findByText('CAI FANG WU')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 210 }));
    expect(labelEtransferEmailProcessed).toHaveBeenCalledWith('msg-1');
    expect(await screen.findByText('Nothing to review — search Gmail to find new e-Transfers.')).toBeInTheDocument();

    const historyCard = screen.getByText('History').closest('.card') as HTMLElement;
    expect(within(historyCard).getByText('Applied')).toBeInTheDocument();
    expect(within(historyCard).getByRole('button', { name: /undo/i })).toBeInTheDocument();
  });

  it('undoes an applied import and reverses the balance', async () => {
    const user = userEvent.setup();
    seedClubDoc('players', 'p1', makePlayer({ balance: 210 })); // already includes the +200 credit
    seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      senderName: 'CAI FANG WU',
      amount: 200,
      appliedAmount: 200,
      emailDate: ts('2026-08-26'),
      status: 'applied',
      matchedPlayerId: 'p1',
      balanceLedgerEntryId: 'entry-1',
    });

    renderPage();
    expect(await screen.findByRole('button', { name: /undo/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /undo/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/reason for undoing this/i), 'wrong match');
    await user.click(within(dialog).getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(getClubDocData('etransferImports', 'msg-1')).toMatchObject({ status: 'undone' }));
    expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 10 });
  });
});
