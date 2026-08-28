import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPage from '../SettingsPage';
import { clearAllData } from '../../services/firebase/admin';
import { renderWithProviders, makeClubState, makePlayersState } from '../../test-utils/renderWithProviders';
import {
  resetFirebaseTestState,
  seedClubDoc,
  seedClubMetaDoc,
  seedMemberDoc,
  setCurrentUser,
  TEST_CLUB_ID,
  ts,
} from '../../test-utils/firebaseTestHelpers';
import { __getDocData, __seedDoc } from '../../test-utils/fakeFirestore';
import type { Player } from '../../types';

const superAdminUser = {
  uid: 'super-admin-1',
  displayName: 'Super Admin',
  email: 'super@example.com',
};

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    firstName: 'Jamie',
    firstNameLower: 'jamie',
    lastName: 'Lee',
    lastNameLower: 'lee',
    email: 'jamie@example.com',
    balance: 0,
    owed: 0,
    description: '',
    sessionCount: 0,
    createdAt: undefined as never,
    ...overrides,
  };
}

function renderPage(options: {
  role?: 'superAdmin' | 'admin' | 'member' | null;
  disabledTabs?: string[];
  players?: Player[];
} = {}) {
  const {
    role = 'superAdmin',
    disabledTabs = [],
    players = [],
  } = options;

  return renderWithProviders(<SettingsPage />, {
    preloadedState: {
      club: makeClubState({
        role,
        currentClubId: TEST_CLUB_ID,
        disabledTabs,
      }),
      players: makePlayersState(players),
    },
  });
}

beforeEach(() => {
  resetFirebaseTestState();
  setCurrentUser(superAdminUser);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: originalCreateObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: originalRevokeObjectURL,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: originalCreateObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: originalRevokeObjectURL,
  });
});

describe('SettingsPage', () => {
  it('blocks non-admin users from the page', () => {
    renderPage({ role: 'member' });

    expect(screen.getByText('You do not have permission to view this page.')).toBeInTheDocument();
    expect(screen.queryByText('Club settings')).not.toBeInTheDocument();
  });

  it('shows the page to admins but hides super-admin-only controls', async () => {
    seedMemberDoc('member-1', { role: 'member' });
    renderPage({ role: 'admin' });

    expect(screen.getByText('Club settings')).toBeInTheDocument();
    expect(screen.getByText(TEST_CLUB_ID)).toBeInTheDocument();
    expect(await screen.findByText('member-1')).toBeInTheDocument();
    expect(screen.queryByText(/danger zone/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('collapses the danger zone behind a dropdown for super admins until expanded', async () => {
    const user = userEvent.setup();
    renderPage({ role: 'superAdmin' });

    const dangerZoneToggle = await screen.findByRole('button', { name: /danger zone/i });
    expect(dangerZoneToggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(dangerZoneToggle);

    expect(dangerZoneToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Clear all data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete club' })).toBeInTheDocument();
  });

  it('persists tab visibility toggles to Firestore and Redux state', async () => {
    const user = userEvent.setup();
    seedClubMetaDoc(TEST_CLUB_ID, { name: 'Test Club', disabledTabs: ['credits'] });
    const { store } = renderPage({ role: 'admin', disabledTabs: ['credits'] });

    const birdiesToggle = screen.getByRole('checkbox', { name: 'Show the Birdies tab' });
    const creditsToggle = screen.getByRole('checkbox', { name: 'Show the Credits tab' });

    expect(birdiesToggle).toBeChecked();
    expect(creditsToggle).not.toBeChecked();

    await user.click(birdiesToggle);

    await waitFor(() => {
      expect(store.getState().club.disabledTabs).toEqual(['credits', 'birdies']);
      expect(__getDocData(`clubs/${TEST_CLUB_ID}`)).toMatchObject({
        disabledTabs: ['credits', 'birdies'],
      });
    });

    await user.click(creditsToggle);

    await waitFor(() => {
      expect(store.getState().club.disabledTabs).toEqual(['birdies']);
      expect(__getDocData(`clubs/${TEST_CLUB_ID}`)).toMatchObject({
        disabledTabs: ['birdies'],
      });
    });
  });

  it('lets a super admin link members to players and add another admin member', async () => {
    const user = userEvent.setup();
    const players = [
      makePlayer({ id: 'p1', firstName: 'Jamie', firstNameLower: 'jamie', lastName: 'Lee', lastNameLower: 'lee' }),
      makePlayer({ id: 'p2', firstName: 'Chris', firstNameLower: 'chris', lastName: 'Ng', lastNameLower: 'ng', email: 'chris@example.com' }),
    ];
    seedMemberDoc('member-1', { role: 'member', playerId: null });

    renderPage({ role: 'superAdmin', players });

    const memberRow = (await screen.findByText('member-1')).closest('.list-group-item');
    expect(memberRow).not.toBeNull();

    await user.selectOptions(within(memberRow as HTMLElement).getByRole('combobox'), 'p1');

    await waitFor(() => {
      expect(__getDocData(`clubs/${TEST_CLUB_ID}/members/member-1`)).toMatchObject({
        role: 'member',
        playerId: 'p1',
      });
    });

    const userIdInput = screen.getByPlaceholderText('User ID');
    const addMemberControls = userIdInput.parentElement as HTMLElement;
    await user.type(userIdInput, 'new-admin');
    await user.selectOptions(within(addMemberControls).getByRole('combobox'), 'admin');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(__getDocData(`clubs/${TEST_CLUB_ID}/members/new-admin`)).toMatchObject({
        role: 'admin',
      });
    });
    expect(await screen.findByText('new-admin')).toBeInTheDocument();
    // The new admin's own profile is updated too, so the club shows up in
    // their club switcher without them needing a separate join link.
    expect(__getDocData('users/new-admin')).toMatchObject({ clubs: [TEST_CLUB_ID] });
  });

  it('repairs saved club access for an existing member', async () => {
    const user = userEvent.setup();
    seedMemberDoc('member-1', { role: 'member', playerId: null });
    renderPage({ role: 'superAdmin' });

    const memberRow = (await screen.findByText('member-1')).closest('.list-group-item') as HTMLElement;
    await user.click(within(memberRow).getByRole('button', { name: 'Sync access' }));

    await waitFor(() => {
      expect(__getDocData('users/member-1')).toMatchObject({ clubs: [TEST_CLUB_ID] });
    });
    expect(screen.getByText(/club access synced/i)).toBeInTheDocument();
  });

  it('approves pending link requests using the auto-suggested player match', async () => {
    const user = userEvent.setup();
    const players = [
      makePlayer({
        id: 'p1',
        firstName: 'Taylor',
        firstNameLower: 'taylor',
        lastName: 'Swift',
        lastNameLower: 'swift',
        email: 'taylor@example.com',
      }),
    ];
    __seedDoc(`clubs/${TEST_CLUB_ID}/linkRequests/requester-1`, {
      uid: 'requester-1',
      firstName: 'Taylor',
      lastName: 'Swift',
      email: 'taylor@example.com',
      createdAt: ts('2026-04-01T00:00:00.000Z'),
    });

    renderPage({ role: 'admin', players });

    const requestRow = (await screen.findByText('Taylor Swift', { selector: 'strong' })).closest('.list-group-item');
    expect(requestRow).not.toBeNull();

    const approveButton = within(requestRow as HTMLElement).getByRole('button', { name: 'Approve' });
    await waitFor(() => expect(approveButton).toBeEnabled());
    await user.click(approveButton);

    await waitFor(() => {
      expect(__getDocData(`clubs/${TEST_CLUB_ID}/linkRequests/requester-1`)).toBeUndefined();
      expect(__getDocData(`clubs/${TEST_CLUB_ID}/members/requester-1`)).toMatchObject({
        role: 'member',
        playerId: 'p1',
      });
    });
  });

  it('warns and requires confirmation before approving a request into an already-linked player', async () => {
    const user = userEvent.setup();
    const players = [makePlayer({ id: 'p1', firstName: 'Taylor', lastName: 'Swift' })];
    seedMemberDoc('existing-member', { role: 'member', playerId: 'p1' });
    __seedDoc(`clubs/${TEST_CLUB_ID}/linkRequests/requester-2`, {
      uid: 'requester-2',
      firstName: 'Taylor',
      lastName: 'Swift',
      email: 'a-different-email@example.com',
      createdAt: ts('2026-04-02T00:00:00.000Z'),
    });

    renderPage({ role: 'admin', players });

    expect(await screen.findByText('Already linked to another member')).toBeInTheDocument();

    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    const requestRow = (await screen.findByText('Taylor Swift', { selector: 'strong' })).closest('.list-group-item');
    const approveButton = within(requestRow as HTMLElement).getByRole('button', { name: 'Approve' });
    await waitFor(() => expect(approveButton).toBeEnabled());

    // Declining the confirmation must not approve the request.
    await user.click(approveButton);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/linkRequests/requester-2`)).toBeDefined();

    // Accepting it proceeds as normal.
    confirmSpy.mockReturnValue(true);
    await user.click(approveButton);
    await waitFor(() => {
      expect(__getDocData(`clubs/${TEST_CLUB_ID}/linkRequests/requester-2`)).toBeUndefined();
      expect(__getDocData(`clubs/${TEST_CLUB_ID}/members/requester-2`)).toMatchObject({ playerId: 'p1' });
    });

    confirmSpy.mockRestore();
  });

  it('approves a pending profile-edit request, applying the change to the player and clearing the request', async () => {
    const user = userEvent.setup();
    const players = [makePlayer({ id: 'p1', firstName: 'Jamie', lastName: 'Lee', email: 'jamie@example.com' })];
    __seedDoc(`clubs/${TEST_CLUB_ID}/profileEditRequests/requester-3`, {
      uid: 'requester-3',
      playerId: 'p1',
      firstName: 'Jamie',
      lastName: 'Lee-Smith',
      email: 'jamie.new@example.com',
      createdAt: ts('2026-05-01T00:00:00.000Z'),
    });

    renderPage({ role: 'admin', players });

    const requestRow = (await screen.findByText('Lee-Smith', { exact: false })).closest('.list-group-item') as HTMLElement;
    await user.click(within(requestRow).getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(__getDocData(`clubs/${TEST_CLUB_ID}/profileEditRequests/requester-3`)).toBeUndefined();
      expect(__getDocData(`clubs/${TEST_CLUB_ID}/players/p1`)).toMatchObject({
        firstName: 'Jamie',
        lastName: 'Lee-Smith',
        email: 'jamie.new@example.com',
      });
    });
  });

  it('auto-dismisses an edit request whose player was already deleted, with a friendly message instead of a raw Firestore error', async () => {
    const user = userEvent.setup();
    // No matching player in the `players` list — simulates one deleted after the request was submitted.
    __seedDoc(`clubs/${TEST_CLUB_ID}/profileEditRequests/requester-5`, {
      uid: 'requester-5',
      playerId: 'deleted-player',
      firstName: 'Ghost',
      lastName: null,
      email: null,
      createdAt: ts('2026-05-03T00:00:00.000Z'),
    });

    renderPage({ role: 'admin', players: [] });

    const requestRow = (await screen.findByText('Ghost', { selector: 'strong' })).closest('.list-group-item') as HTMLElement;
    await user.click(within(requestRow).getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
    await waitFor(() => {
      expect(__getDocData(`clubs/${TEST_CLUB_ID}/profileEditRequests/requester-5`)).toBeUndefined();
    });
  });

  it('dismisses a pending profile-edit request without changing the player', async () => {
    const user = userEvent.setup();
    const players = [makePlayer({ id: 'p1', firstName: 'Jamie', lastName: 'Lee', email: 'jamie@example.com' })];
    __seedDoc(`clubs/${TEST_CLUB_ID}/profileEditRequests/requester-4`, {
      uid: 'requester-4',
      playerId: 'p1',
      firstName: 'Not Jamie',
      lastName: null,
      email: null,
      createdAt: ts('2026-05-02T00:00:00.000Z'),
    });

    renderPage({ role: 'admin', players });

    const requestRow = (await screen.findByText('Not Jamie', { selector: 'strong' })).closest('.list-group-item') as HTMLElement;
    await user.click(within(requestRow).getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(__getDocData(`clubs/${TEST_CLUB_ID}/profileEditRequests/requester-4`)).toBeUndefined();
    });
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/players/p1`)).toBeUndefined(); // never touched
  });

  it('refreshes the link-request list on demand', async () => {
    const user = userEvent.setup();
    renderPage({ role: 'admin' });

    const linkRequestsCard = (await screen.findByText('Link requests')).closest('.card') as HTMLElement;
    expect(await within(linkRequestsCard).findByText('No pending requests.')).toBeInTheDocument();

    // Simulates a request submitted after the page first loaded — nothing
    // refetches it automatically, so the admin needs a manual way to see it.
    __seedDoc(`clubs/${TEST_CLUB_ID}/linkRequests/late-requester`, {
      uid: 'late-requester',
      firstName: 'Casey',
      lastName: 'Jordan',
      email: '',
      createdAt: ts('2026-04-03T00:00:00.000Z'),
    });
    expect(screen.queryByText('Casey Jordan')).not.toBeInTheDocument();

    await user.click(within(linkRequestsCard).getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('Casey Jordan', { selector: 'strong' })).toBeInTheDocument();
  });

  it('round-trips a downloaded JSON backup through the restore-from-file flow', async () => {
    const user = userEvent.setup();
    let capturedBlob: Blob | null = null;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn((blob: Blob) => {
        capturedBlob = blob;
        return 'blob:backup';
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    seedClubDoc('players', 'p1', makePlayer());
    seedClubDoc('sessions', 's1', {
      id: 's1',
      date: ts('2026-05-02T19:00:00.000Z'),
      durationHours: 2,
      courtCount: 2,
      totalCost: 30,
      totalCourtCost: 20,
      totalBirdieCost: 10,
      totalSessionCost: 30,
      birdieUsage: [{ id: 'b1', quantity: 3 }],
      courtCreditUsage: [],
      players: [{ id: 'p1', percentage: 100, cost: 30, paid: false, highlighted: false }],
      createdAt: ts('2026-05-02T19:05:00.000Z'),
    });

    renderPage({ role: 'superAdmin', players: [makePlayer()] });

    await user.click(screen.getByRole('button', { name: 'Download backup' }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    expect(capturedBlob).not.toBeNull();
    const backupJson = await new Response(capturedBlob as Blob).text();
    expect(JSON.parse(backupJson)).toMatchObject({ version: 1 });

    await clearAllData();
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/players/p1`)).toBeUndefined();
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/sessions/s1`)).toBeUndefined();

    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: {
        files: [
          {
            name: 'backup.json',
            text: async () => backupJson,
          },
        ],
      },
    });

    expect(await screen.findByText('Restore complete.')).toBeInTheDocument();
    expect(screen.getByText('sessions: 1 document written')).toBeInTheDocument();
    expect(screen.getByText('players: 1 document written')).toBeInTheDocument();
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/players/p1`)).toBeDefined();
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/sessions/s1`)).toBeDefined();
  });

  it('requires the confirmation phrase before clearing data and then deletes every club collection document', async () => {
    const user = userEvent.setup();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    seedClubDoc('sessions', 's1', { note: 'session to delete' });
    seedClubDoc('players', 'p1', makePlayer());
    seedClubDoc('birdieInventory', 'b1', {
      name: 'Tube',
      costPerTube: 24,
      birdsPerTube: 12,
      tubesPurchased: 1,
      unopenedTubesRemaining: 1,
      birdsInOpenTube: 0,
      purchaserName: 'Owner',
      purchaseDate: ts('2026-01-01T00:00:00.000Z'),
      createdAt: ts('2026-01-01T00:00:00.000Z'),
    });

    renderPage({ role: 'superAdmin' });

    await user.click(screen.getByRole('button', { name: /danger zone/i }));

    const clearButton = screen.getByRole('button', { name: 'Clear all data' });
    expect(clearButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('CLEAR ALL DATA'), 'CLEAR ALL DATA');
    expect(clearButton).toBeEnabled();

    await user.click(clearButton);

    expect(await screen.findByText('Data cleared successfully.')).toBeInTheDocument();
    expect(screen.getByText('sessions: 1 document deleted')).toBeInTheDocument();
    expect(screen.getByText('players: 1 document deleted')).toBeInTheDocument();
    expect(screen.getByText('birdieInventory: 1 document deleted')).toBeInTheDocument();
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/sessions/s1`)).toBeUndefined();
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/players/p1`)).toBeUndefined();
    expect(__getDocData(`clubs/${TEST_CLUB_ID}/birdieInventory/b1`)).toBeUndefined();
  });

  it('renders the Google Drive controls and opens the Drive backup modal', async () => {
    const user = userEvent.setup();
    renderPage({ role: 'admin' });

    expect(screen.getByRole('button', { name: 'Backup to Google Drive' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Restore from Google Drive' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Backup to Google Drive' }));

    expect(await screen.findByRole('button', { name: 'Backup' })).toBeInTheDocument();
  });
});
