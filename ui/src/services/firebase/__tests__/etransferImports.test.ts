export {}; // marks this file as a module for `isolatedModules` (only `require()`/type-only imports below)

type EtransferModule = typeof import('../etransferImports');
type GmailModule = typeof import('../gmail');
type HelpersModule = typeof import('../../../test-utils/firebaseTestHelpers');
type FakeFirestoreModule = typeof import('../../../test-utils/fakeFirestore');
type ParsedEtransferEmail = import('../gmail').ParsedEtransferEmail;

let etransfer: EtransferModule;
let gmailMock: jest.Mocked<GmailModule>;
let helpers: HelpersModule;
let fakeFirestore: FakeFirestoreModule;

jest.mock('../gmail', () => ({
  searchEtransferEmails: jest.fn(),
  DEFAULT_ETRANSFER_SENDER_ADDRESS: 'notify@payments.interac.ca',
  getDefaultEtransferSearchAfterDate: jest.fn(() => '2026-08-27'),
}));

function makeParsedEmail(overrides: Partial<ParsedEtransferEmail> = {}): ParsedEtransferEmail {
  return {
    gmailMessageId: 'msg-1',
    gmailThreadId: 'thread-1',
    subject: "Interac e-Transfer: You've received $200.00 from CAI FANG WU and it has been automatically deposited.",
    senderName: 'CAI FANG WU',
    senderEmail: 'caifang1966@gmail.com',
    amount: 200,
    memo: 'cash for shoppers',
    referenceNumber: 'C1AYd8eJYUcY',
    emailDate: new Date('2026-08-26T14:47:00.000Z'),
    ...overrides,
  };
}

function seedPlayer(id: string, overrides: Record<string, unknown> = {}) {
  helpers.seedClubDoc('players', id, {
    firstName: 'Cai',
    firstNameLower: 'cai',
    lastName: 'Wu',
    lastNameLower: 'wu',
    email: null,
    balance: 10,
    owed: 0,
    description: '',
    sessionCount: 0,
    createdAt: helpers.ts('2026-01-01'),
    ...overrides,
  });
}

beforeEach(() => {
  jest.resetModules();
  etransfer = require('../etransferImports');
  gmailMock = require('../gmail');
  helpers = require('../../../test-utils/firebaseTestHelpers');
  fakeFirestore = require('../../../test-utils/fakeFirestore');
  helpers.resetFirebaseTestState();
  helpers.setCurrentUser({ uid: 'admin-1', displayName: 'Admin', email: 'admin@example.com' });
  jest.mocked(gmailMock.searchEtransferEmails).mockReset();
});

describe('importEtransferEmails', () => {
  it('creates a pending import for each new email, matching by remembered mapping first then by name', async () => {
    seedPlayer('p1');
    seedPlayer('p2', { firstName: 'Jordan', firstNameLower: 'jordan', lastName: 'Lee', lastNameLower: 'lee' });
    // A previously-remembered mapping for a sender whose e-Transfer name doesn't
    // match their app name — should be preferred over the name lookup.
    helpers.seedClubDoc('etransferSenderMappings', 'jordan1966@gmail.com', {
      senderName: 'J LEE PAYMENTS INC',
      senderEmail: 'jordan1966@gmail.com',
      playerId: 'p2',
      updatedAt: helpers.ts('2026-01-01'),
    });

    jest.mocked(gmailMock.searchEtransferEmails).mockResolvedValue([
      makeParsedEmail({ senderName: 'CAI FANG WU', senderEmail: 'someone-else@example.com' }), // single name-match candidate (p1: first name "cai")
      makeParsedEmail({
        gmailMessageId: 'msg-2',
        senderName: 'J LEE PAYMENTS INC',
        senderEmail: 'jordan1966@gmail.com',
        amount: 40,
      }),
      makeParsedEmail({ gmailMessageId: 'msg-3', senderName: 'TOTALLY UNKNOWN SENDER', senderEmail: null }),
    ]);

    const result = await etransfer.importEtransferEmails();

    expect(gmailMock.searchEtransferEmails).toHaveBeenCalledWith('notify@payments.interac.ca', '2026-08-27');
    expect(result).toEqual({ found: 3, created: 3 });

    const mapped = helpers.getClubDocData('etransferImports', 'msg-2');
    expect(mapped).toMatchObject({
      status: 'pending',
      matchedPlayerId: 'p2',
      matchSource: 'mapping',
      amount: 40,
    });

    const nameMatched = helpers.getClubDocData('etransferImports', 'msg-1');
    expect(nameMatched).toMatchObject({ status: 'pending', matchedPlayerId: 'p1', matchSource: 'name-lookup' });

    const unmatched = helpers.getClubDocData('etransferImports', 'msg-3');
    expect(unmatched).toMatchObject({ status: 'pending', matchedPlayerId: null, matchSource: null });
  });

  it('is idempotent — re-running a search never re-creates or touches an already-recorded import', async () => {
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      status: 'applied',
      matchedPlayerId: 'p1',
      appliedAmount: 200,
    });
    jest.mocked(gmailMock.searchEtransferEmails).mockResolvedValue([makeParsedEmail()]);

    const result = await etransfer.importEtransferEmails('custom@bank.example');

    expect(result).toEqual({ found: 1, created: 0 });
    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toMatchObject({ status: 'applied' });
  });

  it('passes a custom sender address through to the Gmail search', async () => {
    jest.mocked(gmailMock.searchEtransferEmails).mockResolvedValue([]);
    await etransfer.importEtransferEmails('custom@bank.example');
    expect(gmailMock.searchEtransferEmails).toHaveBeenCalledWith('custom@bank.example', '2026-08-27');
  });

  it('auto-matches the uniquely strongest player despite middle or reordered sender names', async () => {
    seedPlayer('p1');
    seedPlayer('p2', {
      firstName: 'Cai',
      firstNameLower: 'cai',
      lastName: 'Lee',
      lastNameLower: 'lee',
    });
    jest.mocked(gmailMock.searchEtransferEmails).mockResolvedValue([
      makeParsedEmail({ gmailMessageId: 'middle-name', senderName: 'CAI FANG WU' }),
      makeParsedEmail({ gmailMessageId: 'reordered-name', senderName: 'WU, CAI' }),
    ]);

    await etransfer.importEtransferEmails();

    expect(helpers.getClubDocData('etransferImports', 'middle-name')).toMatchObject({
      matchedPlayerId: 'p1',
      matchSource: 'name-lookup',
    });
    expect(helpers.getClubDocData('etransferImports', 'reordered-name')).toMatchObject({
      matchedPlayerId: 'p1',
      matchSource: 'name-lookup',
    });
  });

  it('leaves equally strong name matches unselected for human review', async () => {
    seedPlayer('p1');
    seedPlayer('p2');
    jest.mocked(gmailMock.searchEtransferEmails).mockResolvedValue([
      makeParsedEmail({ senderName: 'CAI FANG WU' }),
    ]);

    await etransfer.importEtransferEmails();

    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toMatchObject({
      matchedPlayerId: null,
      matchSource: null,
    });
  });
});

describe('applyEtransferImport', () => {
  function seedPendingImport(overrides: Record<string, unknown> = {}) {
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      gmailThreadId: 'thread-1',
      subject: 'subject',
      senderName: 'CAI FANG WU',
      senderEmail: 'caifang1966@gmail.com',
      amount: 200,
      memo: 'cash for shoppers',
      referenceNumber: 'C1AYd8eJYUcY',
      emailDate: helpers.ts('2026-08-26'),
      status: 'pending',
      matchedPlayerId: null,
      matchSource: null,
      createdAt: helpers.ts('2026-08-26'),
      ...overrides,
    });
  }

  it('credits the selected player, logs a balanceLedger entry, and marks the import applied', async () => {
    seedPendingImport();
    seedPlayer('p1', { balance: 10 });

    await etransfer.applyEtransferImport('msg-1', { playerId: 'p1', amount: 200, rememberMapping: true });

    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 210 });

    const importDoc = helpers.getClubDocData('etransferImports', 'msg-1');
    expect(importDoc).toMatchObject({
      status: 'applied',
      matchedPlayerId: 'p1',
      appliedAmount: 200,
      reviewedByUid: 'admin-1',
    });
    expect(importDoc?.balanceLedgerEntryId).toEqual(expect.any(String));

    const ledgerEntry = helpers.getClubDocData('balanceLedger', importDoc!.balanceLedgerEntryId as string);
    expect(ledgerEntry).toMatchObject({
      playerId: 'p1',
      delta: 200,
      balanceBefore: 10,
      balanceAfter: 210,
      reason: 'etransfer-import',
      walletAdjustment: true,
    });

    const mapping = helpers.getClubDocData('etransferSenderMappings', 'caifang1966@gmail.com');
    expect(mapping).toMatchObject({ playerId: 'p1', senderName: 'CAI FANG WU' });
  });

  it('does not save a sender mapping when rememberMapping is false', async () => {
    seedPendingImport();
    seedPlayer('p1');

    await etransfer.applyEtransferImport('msg-1', { playerId: 'p1', amount: 200, rememberMapping: false });

    expect(helpers.getClubDocData('etransferSenderMappings', 'caifang1966@gmail.com')).toBeUndefined();
  });

  it('uses the admin-edited amount rather than the originally parsed amount', async () => {
    seedPendingImport({ amount: 200 });
    seedPlayer('p1', { balance: 0 });

    await etransfer.applyEtransferImport('msg-1', { playerId: 'p1', amount: 150, rememberMapping: false });

    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 150 });
    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toMatchObject({ appliedAmount: 150 });
  });

  it('rejects re-applying an already-reviewed import', async () => {
    seedPendingImport({ status: 'applied' });
    seedPlayer('p1');

    await expect(
      etransfer.applyEtransferImport('msg-1', { playerId: 'p1', amount: 200, rememberMapping: false })
    ).rejects.toThrow('already been reviewed');
  });

  it('rejects a non-positive amount', async () => {
    seedPendingImport();
    seedPlayer('p1');

    await expect(
      etransfer.applyEtransferImport('msg-1', { playerId: 'p1', amount: 0, rememberMapping: false })
    ).rejects.toThrow('valid positive amount');
  });

  it('rounds a sub-cent amount so the recorded appliedAmount always matches the actual balance credit', async () => {
    seedPendingImport({ amount: 200 });
    seedPlayer('p1', { balance: 0 });

    await etransfer.applyEtransferImport('msg-1', { playerId: 'p1', amount: 10.005, rememberMapping: false });

    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 10.01 });
    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toMatchObject({ appliedAmount: 10.01 });
  });
});

describe('rejectEtransferImport', () => {
  it('marks the import rejected without touching any balance', async () => {
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1', status: 'pending', amount: 200, matchedPlayerId: null,
    });
    seedPlayer('p1', { balance: 10 });

    await etransfer.rejectEtransferImport('msg-1', 'not a club payment');

    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toMatchObject({
      status: 'rejected',
      rejectionReason: 'not a club payment',
      reviewedByUid: 'admin-1',
    });
    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 10 });
  });

  it('requires a reason', async () => {
    helpers.seedClubDoc('etransferImports', 'msg-1', { gmailMessageId: 'msg-1', status: 'pending' });
    await expect(etransfer.rejectEtransferImport('msg-1', '  ')).rejects.toThrow('reason is required');
  });
});

describe('dismissEtransferImport', () => {
  it('deletes the pending import doc entirely so the next search re-adds it fresh', async () => {
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1', status: 'pending', amount: 200, senderName: 'CAI FANG WU',
    });

    await etransfer.dismissEtransferImport('msg-1');

    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toBeUndefined();

    // Re-running a search for the same Gmail message id now creates a fresh pending import.
    jest.mocked(gmailMock.searchEtransferEmails).mockResolvedValue([makeParsedEmail({
      gmailMessageId: 'msg-1', senderName: 'CAI FANG WU',
    })]);
    const result = await etransfer.importEtransferEmails();
    expect(result).toEqual({ found: 1, created: 1 });
    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toMatchObject({ status: 'pending' });
  });

  it('rejects dismissing an import that has already been reviewed', async () => {
    helpers.seedClubDoc('etransferImports', 'msg-1', { gmailMessageId: 'msg-1', status: 'applied' });
    await expect(etransfer.dismissEtransferImport('msg-1')).rejects.toThrow('already been reviewed');
    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toBeDefined();
  });

  it('rejects dismissing an import that does not exist', async () => {
    await expect(etransfer.dismissEtransferImport('missing')).rejects.toThrow('not found');
  });
});

describe('undoEtransferImport', () => {
  it('reverses an applied balance and reopens the import for review', async () => {
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      status: 'applied',
      matchedPlayerId: 'p1',
      appliedAmount: 200,
      balanceLedgerEntryId: 'original-entry',
    });
    seedPlayer('p1', { balance: 210 }); // already includes the +200 credit

    await etransfer.undoEtransferImport('msg-1', 'wrong player matched');

    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 10 });

    const importDoc = helpers.getClubDocData('etransferImports', 'msg-1');
    expect(importDoc).toMatchObject({
      status: 'pending',
      undoneByUid: 'admin-1',
      undoneReason: 'wrong player matched',
    });

    // The original ledger entry is untouched — a new reversing entry is added instead.
    const allPaths = fakeFirestore.__getAllPaths();
    const reversalPath = allPaths.find(
      (p: string) => p.includes('/balanceLedger/') && !p.endsWith('/original-entry')
    );
    expect(reversalPath).toBeDefined();
    const reversal = fakeFirestore.__getDocData(reversalPath!);
    expect(reversal).toMatchObject({
      playerId: 'p1',
      delta: -200,
      balanceBefore: 210,
      balanceAfter: 10,
      reason: 'etransfer-import-undo',
      walletAdjustment: true,
    });
  });

  it('reopens a rejected import without changing balances', async () => {
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      status: 'rejected',
      senderName: 'CAI FANG WU',
      senderEmail: 'sender@example.com',
      matchedPlayerId: 'p2',
      rejectionReason: 'not a payment',
    });
    seedPlayer('p1', { balance: 10 });
    seedPlayer('p2', {
      firstName: 'Jordan',
      firstNameLower: 'jordan',
      lastName: 'Lee',
      lastNameLower: 'lee',
      balance: 20,
    });

    await etransfer.undoEtransferImport('msg-1', 'reconsidering');

    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toMatchObject({
      status: 'pending',
      matchedPlayerId: 'p1',
      matchSource: 'name-lookup',
      rejectionReason: 'not a payment',
      undoneReason: 'reconsidering',
    });
    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 10 });
    expect(helpers.getClubDocData('players', 'p2')).toMatchObject({ balance: 20 });
  });

  it('only allows undoing a reviewed import', async () => {
    helpers.seedClubDoc('etransferImports', 'msg-1', { gmailMessageId: 'msg-1', status: 'pending' });
    await expect(etransfer.undoEtransferImport('msg-1', 'reason')).rejects.toThrow('Only a reviewed import');
  });

  it('requires a reason', async () => {
    helpers.seedClubDoc('etransferImports', 'msg-1', { gmailMessageId: 'msg-1', status: 'applied', matchedPlayerId: 'p1', appliedAmount: 5 });
    await expect(etransfer.undoEtransferImport('msg-1', '')).rejects.toThrow('reason for undoing this is required');
  });
});

describe('e-Transfer approval batches', () => {
  function seedOwedSession(id: string, date: string, cost: number): void {
    helpers.seedClubDoc('sessions', id, {
      date: helpers.ts(date),
      players: [{
        id: 'p1',
        percentage: 100,
        cost,
        paid: false,
        paidVia: null,
        comped: false,
        highlighted: false,
      }],
    });
  }

  it('normalizes a sub-cent amount so appliedAmount and the credited balance always agree', async () => {
    seedPlayer('p1', { balance: 0, owed: 0 });
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      status: 'pending',
      senderName: 'CAI FANG WU',
      amount: 10.005,
    });

    const preview = await etransfer.previewEtransferApprovalBatch([{
      importId: 'msg-1',
      playerId: 'p1',
      amount: 10.005,
      rememberMapping: false,
    }]);

    expect(preview.approvals[0].amount).toBe(10.01);
    expect(preview.endingBalances).toEqual({ p1: 10.01 });

    await etransfer.applyEtransferApprovalBatch(preview);

    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 10.01 });
    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toMatchObject({ appliedAmount: 10.01 });
  });

  it('settles a one-cent oldest session and stops before the newer $10 session when credited $9 (does not skip ahead)', async () => {
    seedPlayer('p1', { balance: 0, owed: 10.01 });
    seedOwedSession('oldest', '2026-08-01', 0.01);
    seedOwedSession('newest', '2026-08-08', 10);
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      status: 'pending',
      senderName: 'CAI FANG WU',
      senderEmail: 'sender@example.com',
      amount: 9,
    });

    const preview = await etransfer.previewEtransferApprovalBatch([{
      importId: 'msg-1',
      playerId: 'p1',
      amount: 9,
      rememberMapping: false,
    }]);

    expect(preview.settlements.map((item) => item.sessionId)).toEqual(['oldest']);
    expect(preview.endingBalances).toEqual({ p1: 8.99 });
    expect(preview.blockingSessions).toEqual([{
      playerId: 'p1',
      sessionId: 'newest',
      sessionDate: new Date('2026-08-08T00:00:00.000Z'),
      cost: 10,
      availableBalance: 8.99,
    }]);

    await etransfer.applyEtransferApprovalBatch(preview);

    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 8.99, owed: 10 });
    expect(helpers.getClubDocData('sessions', 'oldest')?.players).toEqual([
      expect.objectContaining({ paid: true, paidVia: 'balance' }),
    ]);
    expect(helpers.getClubDocData('sessions', 'newest')?.players).toEqual([
      expect.objectContaining({ paid: false, paidVia: null }),
    ]);
  });

  it('does not skip an unaffordable older unpaid session to settle a cheaper, newer one — reports it as a blocking session instead', async () => {
    // Mirrors a real reported case: an older $13.03 unpaid session and a newer,
    // smaller $0.01 unpaid one. A $0.01 credit covers the small session by amount,
    // but oldest-first means the bigger, older debt must clear first.
    seedPlayer('p1', { balance: 0, owed: 13.04 });
    seedOwedSession('older-big', '2026-08-19', 13.03);
    seedOwedSession('newer-small', '2026-08-21', 0.01);
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      status: 'pending',
      senderName: 'CAI FANG WU',
      senderEmail: 'sender@example.com',
      amount: 0.01,
    });

    const preview = await etransfer.previewEtransferApprovalBatch([{
      importId: 'msg-1',
      playerId: 'p1',
      amount: 0.01,
      rememberMapping: false,
    }]);

    expect(preview.settlements).toEqual([]);
    expect(preview.blockingSessions).toEqual([{
      playerId: 'p1',
      sessionId: 'older-big',
      sessionDate: new Date('2026-08-19T00:00:00.000Z'),
      cost: 13.03,
      availableBalance: 0.01,
    }]);
  });

  it('pools credit across two selected imports and still settles the covered oldest session, stopping before the unaffordable newer one', async () => {
    seedPlayer('p1', { balance: 0, owed: 10.01 });
    seedOwedSession('oldest', '2026-08-01', 0.01);
    seedOwedSession('newest', '2026-08-08', 10);
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1', status: 'pending', senderName: 'CAI FANG WU', amount: 4,
    });
    helpers.seedClubDoc('etransferImports', 'msg-2', {
      gmailMessageId: 'msg-2', status: 'pending', senderName: 'CAI FANG WU', amount: 5,
    });

    const preview = await etransfer.previewEtransferApprovalBatch([
      { importId: 'msg-1', playerId: 'p1', amount: 4, rememberMapping: false },
      { importId: 'msg-2', playerId: 'p1', amount: 5, rememberMapping: false },
    ]);

    expect(preview.settlements.map((item) => item.sessionId)).toEqual(['oldest']);
    expect(preview.endingBalances).toEqual({ p1: 8.99 });
  });

  it('previews and settles only fully covered sessions from oldest to newest', async () => {
    seedPlayer('p1', { balance: 0, owed: 35 });
    seedOwedSession('oldest', '2026-08-01', 10);
    seedOwedSession('next', '2026-08-08', 20);
    seedOwedSession('newest', '2026-08-15', 5);
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      status: 'pending',
      senderName: 'CAI FANG WU',
      senderEmail: 'sender@example.com',
      amount: 25,
    });

    const preview = await etransfer.previewEtransferApprovalBatch([{
      importId: 'msg-1',
      playerId: 'p1',
      amount: 25,
      rememberMapping: false,
    }]);

    expect(preview.settlements.map((item) => item.sessionId)).toEqual(['oldest']);
    expect(preview.endingBalances).toEqual({ p1: 15 });

    await expect(etransfer.applyEtransferApprovalBatch(preview)).resolves.toEqual({
      approved: 1,
      settled: 1,
    });

    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 15, owed: 25 });
    expect(helpers.getClubDocData('sessions', 'oldest')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: true, paidVia: 'balance' }),
    ]);
    expect(helpers.getClubDocData('sessions', 'next')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: false, paidVia: null }),
    ]);
    expect(helpers.getClubDocData('sessions', 'newest')?.players).toEqual([
      expect.objectContaining({ id: 'p1', paid: false, paidVia: null }),
    ]);
    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toMatchObject({
      autoSettledSessionIds: ['oldest'],
    });

    await etransfer.undoEtransferImport('msg-1', 'batch was incorrect');

    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 0, owed: 35 });
    expect(helpers.getClubDocData('sessions', 'oldest')?.players).toEqual([
      expect.objectContaining({
        id: 'p1',
        paid: false,
        paidVia: null,
        settledByEtransferImportId: null,
      }),
    ]);
  });

  it('settles an exact one-cent oldest session when the credited amount is also one cent', async () => {
    seedPlayer('p1', { balance: 0, owed: 20.01 });
    seedOwedSession('oldest', '2026-08-01', 0.01);
    seedOwedSession('newest', '2026-08-08', 20);
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      status: 'pending',
      senderName: 'CAI FANG WU',
      senderEmail: 'sender@example.com',
      amount: 0.01,
    });

    const preview = await etransfer.previewEtransferApprovalBatch([{
      importId: 'msg-1',
      playerId: 'p1',
      amount: 0.01,
      rememberMapping: false,
    }]);

    expect(preview.settlements.map((item) => item.sessionId)).toEqual(['oldest']);
    expect(preview.endingBalances).toEqual({ p1: 0 });

    await etransfer.applyEtransferApprovalBatch(preview);

    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 0, owed: 20 });
    expect(helpers.getClubDocData('sessions', 'oldest')?.players).toEqual([
      expect.objectContaining({ paid: true, paidVia: 'balance' }),
    ]);
  });

  it('settles an owed session even when a starting balance plus credit is only exactly reachable through floating-point-prone cents (e.g. $0.01 + $0.06 covering a $0.07 debt)', async () => {
    // 0.01 + 0.06 === 0.06999999999999999 in IEEE754 doubles — a naive dollar-float
    // comparison (`cost > available`) would incorrectly treat this as unaffordable
    // and skip a session that is, in whole cents, exactly covered.
    seedPlayer('p1', { balance: 0.01, owed: 0.07 });
    seedOwedSession('oldest', '2026-08-01', 0.07);
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      status: 'pending',
      senderName: 'CAI FANG WU',
      senderEmail: 'sender@example.com',
      amount: 0.06,
    });

    const preview = await etransfer.previewEtransferApprovalBatch([{
      importId: 'msg-1',
      playerId: 'p1',
      amount: 0.06,
      rememberMapping: false,
    }]);

    expect(preview.settlements.map((item) => item.sessionId)).toEqual(['oldest']);
    expect(preview.endingBalances).toEqual({ p1: 0 });

    await etransfer.applyEtransferApprovalBatch(preview);

    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 0, owed: 0 });
    expect(helpers.getClubDocData('sessions', 'oldest')?.players).toEqual([
      expect.objectContaining({ paid: true, paidVia: 'balance' }),
    ]);
  });

  it('rejects a stale reviewed batch before applying any import or settlement', async () => {
    seedPlayer('p1', { balance: 0, owed: 10 });
    seedOwedSession('oldest', '2026-08-01', 10);
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      status: 'pending',
      senderName: 'CAI FANG WU',
      amount: 20,
    });
    const preview = await etransfer.previewEtransferApprovalBatch([{
      importId: 'msg-1',
      playerId: 'p1',
      amount: 20,
      rememberMapping: false,
    }]);
    seedPlayer('p1', { balance: 5, owed: 10 });

    await expect(etransfer.applyEtransferApprovalBatch(preview)).rejects.toThrow(
      'batch changed since it was reviewed'
    );

    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toMatchObject({ status: 'pending' });
    expect(helpers.getClubDocData('sessions', 'oldest')?.players).toEqual([
      expect.objectContaining({ paid: false, paidVia: null }),
    ]);
  });

  it('reopens a pooled settlement when undoing an earlier contributing transfer', async () => {
    seedPlayer('p1', { balance: 0, owed: 15 });
    seedOwedSession('oldest', '2026-08-01', 15);
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1', status: 'pending', senderName: 'CAI FANG WU', amount: 10,
    });
    helpers.seedClubDoc('etransferImports', 'msg-2', {
      gmailMessageId: 'msg-2', status: 'pending', senderName: 'CAI FANG WU', amount: 10,
    });
    const preview = await etransfer.previewEtransferApprovalBatch([
      { importId: 'msg-1', playerId: 'p1', amount: 10, rememberMapping: false },
      { importId: 'msg-2', playerId: 'p1', amount: 10, rememberMapping: false },
    ]);
    await etransfer.applyEtransferApprovalBatch(preview);
    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 5, owed: 0 });

    await etransfer.undoEtransferImport('msg-1', 'first transfer was incorrect');

    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 10, owed: 15 });
    expect(helpers.getClubDocData('sessions', 'oldest')?.players).toEqual([
      expect.objectContaining({ paid: false, paidVia: null }),
    ]);
    expect(helpers.getClubDocData('etransferImports', 'msg-2')).toMatchObject({ status: 'applied' });
  });

  it('keeps an automatic settlement when the remaining balance still covers it after undo', async () => {
    seedPlayer('p1', { balance: 100, owed: 20 });
    seedOwedSession('oldest', '2026-08-01', 20);
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1', status: 'pending', senderName: 'CAI FANG WU', amount: 10,
    });
    const preview = await etransfer.previewEtransferApprovalBatch([
      { importId: 'msg-1', playerId: 'p1', amount: 10, rememberMapping: false },
    ]);
    await etransfer.applyEtransferApprovalBatch(preview);
    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 90, owed: 0 });

    await etransfer.undoEtransferImport('msg-1', 'transfer was incorrect');

    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 80, owed: 0 });
    expect(helpers.getClubDocData('sessions', 'oldest')?.players).toEqual([
      expect.objectContaining({ paid: true, paidVia: 'balance' }),
    ]);
  });

  it('stamps every import applied together with the same batchId, and a different batchId on a later approval', async () => {
    seedPlayer('p1', { balance: 0, owed: 0 });
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1', status: 'pending', senderName: 'CAI FANG WU', amount: 10,
    });
    helpers.seedClubDoc('etransferImports', 'msg-2', {
      gmailMessageId: 'msg-2', status: 'pending', senderName: 'PAT SMITH', amount: 5,
    });
    const firstPreview = await etransfer.previewEtransferApprovalBatch([
      { importId: 'msg-1', playerId: 'p1', amount: 10, rememberMapping: false },
      { importId: 'msg-2', playerId: 'p1', amount: 5, rememberMapping: false },
    ]);
    await etransfer.applyEtransferApprovalBatch(firstPreview);

    const msg1 = helpers.getClubDocData('etransferImports', 'msg-1');
    const msg2 = helpers.getClubDocData('etransferImports', 'msg-2');
    expect(msg1?.batchId).toEqual(expect.any(String));
    expect(msg1?.batchId).toBe(msg2?.batchId);

    helpers.seedClubDoc('etransferImports', 'msg-3', {
      gmailMessageId: 'msg-3', status: 'pending', senderName: 'ALEX LEE', amount: 3,
    });
    const secondPreview = await etransfer.previewEtransferApprovalBatch([
      { importId: 'msg-3', playerId: 'p1', amount: 3, rememberMapping: false },
    ]);
    await etransfer.applyEtransferApprovalBatch(secondPreview);

    const msg3 = helpers.getClubDocData('etransferImports', 'msg-3');
    expect(msg3?.batchId).toEqual(expect.any(String));
    expect(msg3?.batchId).not.toBe(msg1?.batchId);
  });
});

describe('sender mappings', () => {
  it('saves and fetches a mapping keyed by sender email', async () => {
    await etransfer.saveEtransferSenderMapping('caifang1966@gmail.com', 'CAI FANG WU', 'p1');
    const mappings = await etransfer.fetchEtransferSenderMappings();
    expect(mappings).toEqual([
      expect.objectContaining({ id: 'caifang1966@gmail.com', senderName: 'CAI FANG WU', playerId: 'p1' }),
    ]);
  });

  it('falls back to a name-based key when no sender email is available', async () => {
    await etransfer.saveEtransferSenderMapping(null, 'Cash Payer', 'p2');
    const mappings = await etransfer.fetchEtransferSenderMappings();
    expect(mappings).toEqual([
      expect.objectContaining({ id: 'name:cash payer', playerId: 'p2' }),
    ]);
  });

  it('deletes a mapping', async () => {
    await etransfer.saveEtransferSenderMapping('caifang1966@gmail.com', 'CAI FANG WU', 'p1');
    await etransfer.deleteEtransferSenderMapping('caifang1966@gmail.com');
    expect(await etransfer.fetchEtransferSenderMappings()).toEqual([]);
  });
});
