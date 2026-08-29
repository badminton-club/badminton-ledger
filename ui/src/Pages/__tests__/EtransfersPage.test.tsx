import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EtransfersPage from '../EtransfersPage';
import { renderWithProviders, makeClubState, makePlayersState } from '../../test-utils/renderWithProviders';
import {
  resetFirebaseTestState,
  seedClubDoc,
  seedClubMetaDoc,
  getClubMetaDocData,
  getClubDocData,
  setCurrentUser,
  ts,
} from '../../test-utils/firebaseTestHelpers';
import {
  searchEtransferEmails,
  getDefaultEtransferSearchAfterDate,
} from '../../services/firebase/gmail';
import type { Player } from '../../types';

jest.mock('../../services/firebase/gmail', () => {
  const actual = jest.requireActual('../../services/firebase/gmail');
  return {
    ...actual,
    searchEtransferEmails: jest.fn(),
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
    const defaultSearchDate = getDefaultEtransferSearchAfterDate();
    expect(screen.getByLabelText('Search emails after')).toHaveValue(defaultSearchDate);

    await user.click(screen.getByRole('button', { name: /connect gmail & search/i }));

    expect(searchEtransferEmails).toHaveBeenCalledWith('notify@payments.interac.ca', defaultSearchDate);
    expect(await screen.findByText('CAI FANG WU')).toBeInTheDocument();
    expect(screen.getByText('cash for shoppers')).toBeInTheDocument();
    expect(await screen.findByText(/found 1 email\(s\) — 1 new/i)).toBeInTheDocument();
    // Single-candidate name lookup ("Cai" matches the seeded player "Cai Wu") pre-selects the player.
    expect(screen.getByRole('combobox')).toHaveValue('p1');
  });

  it('loads and persists the club-specific earliest search date', async () => {
    const user = userEvent.setup();
    seedClubMetaDoc('test-club', {
      name: 'Test Club',
      etransferSearchAfterDate: '2026-09-01',
    });

    renderPage();
    const dateInput = await screen.findByLabelText('Search emails after');
    expect(dateInput).toHaveValue('2026-09-01');

    await user.clear(dateInput);
    await user.type(dateInput, '2026-10-15');
    await user.click(screen.getByRole('button', { name: 'Save date' }));

    await waitFor(() => {
      expect(screen.getByText('Search date saved.')).toBeInTheDocument();
    });
    expect(getClubMetaDocData('test-club')).toMatchObject({
      etransferSearchAfterDate: '2026-10-15',
    });
  });

  it('approves a pending import: credits the player balance and moves it to history', async () => {
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
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve batch (1)' }));

    await waitFor(() => expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 210 }));
    expect(await screen.findByText('Nothing to review — search Gmail to find new e-Transfers.')).toBeInTheDocument();

    const historyCard = screen.getByText('History').closest('.card') as HTMLElement;
    expect(within(historyCard).getByText('Applied')).toBeInTheDocument();
    expect(within(historyCard).getByRole('button', { name: /undo/i })).toBeInTheDocument();
  });

  it('previews and approves selected imports as a batch with oldest-first balance settlement', async () => {
    const user = userEvent.setup();
    seedClubDoc('players', 'p1', makePlayer({ balance: 0, owed: 30 }));
    seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      senderName: 'CAI FANG WU',
      senderEmail: 'sender@example.com',
      amount: 25,
      emailDate: ts('2026-08-26'),
      status: 'pending',
      matchedPlayerId: 'p1',
      matchSource: 'name-lookup',
    });
    seedClubDoc('sessions', 'oldest', {
      date: ts('2026-08-01T12:00:00'),
      players: [{
        id: 'p1', percentage: 100, cost: 10, paid: false, paidVia: null,
        comped: false, highlighted: false,
      }],
    });
    seedClubDoc('sessions', 'newer', {
      date: ts('2026-08-08T12:00:00'),
      players: [{
        id: 'p1', percentage: 100, cost: 20, paid: false, paidVia: null,
        comped: false, highlighted: false,
      }],
    });

    renderPage();
    await screen.findByText('CAI FANG WU');
    await user.click(screen.getByRole('button', { name: 'Review batch (1)' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Aug 1, 2026')).toBeInTheDocument();
    expect(within(dialog).queryByText('Aug 8, 2026')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Approve batch (1)' }));

    await waitFor(() => expect(getClubDocData('players', 'p1')).toMatchObject({
      balance: 15,
      owed: 20,
    }));
    expect(getClubDocData('sessions', 'oldest')?.players).toEqual([
      expect.objectContaining({ paid: true, paidVia: 'balance' }),
    ]);
    expect(getClubDocData('sessions', 'newer')?.players).toEqual([
      expect.objectContaining({ paid: false, paidVia: null }),
    ]);
  });

  it('does not skip an older, larger unpaid session to settle a smaller newer one, and explains why in the preview', async () => {
    const user = userEvent.setup();
    seedClubDoc('players', 'p1', makePlayer({ balance: 0, owed: 13.04 }));
    seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      senderName: 'CAI FANG WU',
      senderEmail: 'sender@example.com',
      amount: 0.01,
      emailDate: ts('2026-08-26'),
      status: 'pending',
      matchedPlayerId: 'p1',
      matchSource: 'name-lookup',
    });
    seedClubDoc('sessions', 'older-big', {
      date: ts('2026-08-19T12:00:00'),
      players: [{
        id: 'p1', percentage: 100, cost: 13.03, paid: false, paidVia: null,
        comped: false, highlighted: false,
      }],
    });
    seedClubDoc('sessions', 'newer-small', {
      date: ts('2026-08-21T12:00:00'),
      players: [{
        id: 'p1', percentage: 100, cost: 0.01, paid: false, paidVia: null,
        comped: false, highlighted: false,
      }],
    });

    renderPage();
    await screen.findByText('CAI FANG WU');
    await user.click(screen.getByRole('button', { name: 'Review batch (1)' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/No owed session is fully covered/)).toBeInTheDocument();
    expect(within(dialog).getByText(/oldest remaining unpaid session/)).toBeInTheDocument();
    expect(within(dialog).getByText(/\$13\.03 on Aug 19, 2026/)).toBeInTheDocument();
  });

  it('dismisses a pending import (X) without a permanent decision, and it can be re-found by a later search', async () => {
    const user = userEvent.setup();
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    seedClubDoc('players', 'p1', makePlayer());
    seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      senderName: 'CAI FANG WU',
      amount: 200,
      emailDate: ts('2026-08-26'),
      status: 'pending',
      matchedPlayerId: 'p1',
      matchSource: 'name-lookup',
    });

    renderPage();
    expect(await screen.findByText('CAI FANG WU')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ignore CAI FANG WU for now' }));

    await waitFor(() => expect(getClubDocData('etransferImports', 'msg-1')).toBeUndefined());
    expect(screen.getByText('Nothing to review — search Gmail to find new e-Transfers.')).toBeInTheDocument();
    // Not recorded in history either — it's gone entirely, not a permanent decision.
    expect(screen.queryByText('CAI FANG WU')).not.toBeInTheDocument();

    // A later Gmail search re-finds and re-adds the same message for review.
    jest.mocked(searchEtransferEmails).mockResolvedValue([{
      gmailMessageId: 'msg-1',
      gmailThreadId: 'thread-1',
      subject: 'subject',
      senderName: 'CAI FANG WU',
      senderEmail: null,
      amount: 200,
      memo: null,
      referenceNumber: null,
      emailDate: new Date('2026-08-26T14:47:00.000Z'),
    }]);
    await user.click(screen.getByRole('button', { name: /connect gmail & search/i }));
    expect(await screen.findByText('CAI FANG WU')).toBeInTheDocument();

    confirmSpy.mockRestore();
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

    await waitFor(() => expect(getClubDocData('etransferImports', 'msg-1')).toMatchObject({ status: 'pending' }));
    expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 10 });
  });

  it('rejects a pending import and shows Rejected in history', async () => {
    const user = userEvent.setup();
    seedClubDoc('players', 'p1', makePlayer());
    seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      senderName: 'CAI FANG WU',
      amount: 200,
      emailDate: ts('2026-08-26'),
      status: 'pending',
      matchedPlayerId: 'p1',
      matchSource: 'name-lookup',
    });

    renderPage();
    expect(await screen.findByText('CAI FANG WU')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reject/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/reason/i), 'not a club payment');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(getClubDocData('etransferImports', 'msg-1')).toMatchObject({ status: 'rejected' }));
    // No balance change for a rejected import.
    expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 10 });

    const historyCard = screen.getByText('History').closest('.card') as HTMLElement;
    expect(within(historyCard).getByText('Rejected')).toBeInTheDocument();
    expect(within(historyCard).getByText('not a club payment')).toBeInTheDocument();
  });

  it('fills the reject reason with the "Not badminton" quick button', async () => {
    const user = userEvent.setup();
    seedClubDoc('players', 'p1', makePlayer());
    seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      senderName: 'CAI FANG WU',
      amount: 200,
      emailDate: ts('2026-08-26'),
      status: 'pending',
      matchedPlayerId: 'p1',
      matchSource: 'name-lookup',
    });

    renderPage();
    expect(await screen.findByText('CAI FANG WU')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reject/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Not badminton' }));
    expect(within(dialog).getByLabelText(/reason/i)).toHaveValue('Not badminton');

    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(getClubDocData('etransferImports', 'msg-1')).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Not badminton',
    }));
  });

  it('undoes a rejected import and returns it to review', async () => {
    const user = userEvent.setup();
    seedClubDoc('players', 'p1', makePlayer());
    seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      senderName: 'CAI FANG WU',
      amount: 200,
      emailDate: ts('2026-08-26'),
      status: 'rejected',
      matchedPlayerId: 'p1',
      rejectionReason: 'not a club payment',
    });

    renderPage();
    const historyCard = (await screen.findByText('History')).closest('.card') as HTMLElement;
    await user.click(within(historyCard).getByRole('button', { name: 'Undo' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/reason for undoing this/i), 'review again');
    await user.click(within(dialog).getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(getClubDocData('etransferImports', 'msg-1')).toMatchObject({ status: 'pending' }));
    expect(getClubDocData('players', 'p1')).toMatchObject({ balance: 10 });
    expect(await screen.findByText('CAI FANG WU')).toBeInTheDocument();
  });

  it('shows saved sender mappings and lets an admin re-map the player or remove the mapping', async () => {
    const user = userEvent.setup();
    seedClubDoc('players', 'p1', makePlayer());
    seedClubDoc('players', 'p2', makePlayer({ id: 'p2', firstName: 'Jordan', firstNameLower: 'jordan', lastName: 'Lee', lastNameLower: 'lee' }));
    seedClubDoc('etransferSenderMappings', 'caifang1966@gmail.com', {
      senderName: 'CAI FANG WU',
      senderEmail: 'caifang1966@gmail.com',
      playerId: 'p1',
      updatedAt: ts('2026-08-01'),
    });

    const { store } = renderWithProviders(<EtransfersPage />, {
      route: '/etransfers',
      preloadedState: {
        club: makeClubState(),
        players: makePlayersState([makePlayer(), makePlayer({ id: 'p2', firstName: 'Jordan', firstNameLower: 'jordan', lastName: 'Lee', lastNameLower: 'lee' })]),
      },
    });
    void store;

    const mappingsCard = (await screen.findByText('Saved sender mappings')).closest('.card') as HTMLElement;
    expect(within(mappingsCard).getByText('CAI FANG WU')).toBeInTheDocument();
    expect(within(mappingsCard).getByText('caifang1966@gmail.com')).toBeInTheDocument();

    const playerSelect = within(mappingsCard).getByRole('combobox');
    await user.selectOptions(playerSelect, 'p2');

    await waitFor(() =>
      expect(getClubDocData('etransferSenderMappings', 'caifang1966@gmail.com')).toMatchObject({ playerId: 'p2' })
    );

    await user.click(within(mappingsCard).getByRole('button', { name: /remove/i }));

    await waitFor(() => expect(within(mappingsCard).queryByText('CAI FANG WU')).not.toBeInTheDocument());
    expect(getClubDocData('etransferSenderMappings', 'caifang1966@gmail.com')).toBeUndefined();
  });
});
