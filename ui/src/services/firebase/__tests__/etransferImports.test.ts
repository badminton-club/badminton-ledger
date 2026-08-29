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
  labelEtransferEmailProcessed: jest.fn(),
  labelEtransferEmailRejected: jest.fn(),
  removeEtransferEmailProcessedLabel: jest.fn(),
  removeEtransferEmailRejectedLabel: jest.fn(),
  DEFAULT_ETRANSFER_SENDER_ADDRESS: 'notify@payments.interac.ca',
  DEFAULT_ETRANSFER_SEARCH_AFTER_DATE: '2026-08-27',
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
  jest.mocked(gmailMock.labelEtransferEmailProcessed).mockReset().mockResolvedValue(undefined);
  jest.mocked(gmailMock.labelEtransferEmailRejected).mockReset().mockResolvedValue(undefined);
  jest.mocked(gmailMock.removeEtransferEmailProcessedLabel).mockReset().mockResolvedValue(undefined);
  jest.mocked(gmailMock.removeEtransferEmailRejectedLabel).mockReset().mockResolvedValue(undefined);
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

  it('credits the selected player, logs a balanceLedger entry, marks the import applied, and labels the Gmail message', async () => {
    seedPendingImport();
    seedPlayer('p1', { balance: 10 });

    const result = await etransfer.applyEtransferImport('msg-1', { playerId: 'p1', amount: 200, rememberMapping: true });

    expect(result).toEqual({ labelFailed: false });
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

    expect(gmailMock.labelEtransferEmailProcessed).toHaveBeenCalledWith('msg-1');
  });

  it('does not save a sender mapping when rememberMapping is false', async () => {
    seedPendingImport();
    seedPlayer('p1');

    await etransfer.applyEtransferImport('msg-1', { playerId: 'p1', amount: 200, rememberMapping: false });

    expect(helpers.getClubDocData('etransferSenderMappings', 'caifang1966@gmail.com')).toBeUndefined();
  });

  it('reports labelFailed but keeps the applied balance change when Gmail labelling fails', async () => {
    seedPendingImport();
    seedPlayer('p1');
    jest.mocked(gmailMock.labelEtransferEmailProcessed).mockRejectedValue(new Error('token expired'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await etransfer.applyEtransferImport('msg-1', { playerId: 'p1', amount: 200, rememberMapping: false });

    expect(result).toEqual({ labelFailed: true });
    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 210 });
    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toMatchObject({ status: 'applied' });
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
});

describe('rejectEtransferImport', () => {
  it('marks the import rejected without touching any balance, and labels the Gmail message "Rejected" (distinct from "Processed")', async () => {
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1', status: 'pending', amount: 200, matchedPlayerId: null,
    });
    seedPlayer('p1', { balance: 10 });

    const result = await etransfer.rejectEtransferImport('msg-1', 'not a club payment');

    expect(result).toEqual({ labelFailed: false });
    expect(helpers.getClubDocData('etransferImports', 'msg-1')).toMatchObject({
      status: 'rejected',
      rejectionReason: 'not a club payment',
      reviewedByUid: 'admin-1',
    });
    expect(helpers.getClubDocData('players', 'p1')).toMatchObject({ balance: 10 });
    expect(gmailMock.labelEtransferEmailRejected).toHaveBeenCalledWith('msg-1');
    expect(gmailMock.labelEtransferEmailProcessed).not.toHaveBeenCalled();
  });

  it('requires a reason', async () => {
    helpers.seedClubDoc('etransferImports', 'msg-1', { gmailMessageId: 'msg-1', status: 'pending' });
    await expect(etransfer.rejectEtransferImport('msg-1', '  ')).rejects.toThrow('reason is required');
  });
});

describe('undoEtransferImport', () => {
  it('reverses an applied balance, reopens the import, and removes the Processed label', async () => {
    helpers.seedClubDoc('etransferImports', 'msg-1', {
      gmailMessageId: 'msg-1',
      status: 'applied',
      matchedPlayerId: 'p1',
      appliedAmount: 200,
      balanceLedgerEntryId: 'original-entry',
    });
    seedPlayer('p1', { balance: 210 }); // already includes the +200 credit

    await expect(etransfer.undoEtransferImport('msg-1', 'wrong player matched')).resolves.toEqual({
      labelFailed: false,
    });

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
    expect(gmailMock.removeEtransferEmailProcessedLabel).toHaveBeenCalledWith('msg-1');
  });

  it('reopens a rejected import without changing balances and removes the Rejected label', async () => {
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
    expect(gmailMock.removeEtransferEmailRejectedLabel).toHaveBeenCalledWith('msg-1');
    expect(gmailMock.removeEtransferEmailProcessedLabel).not.toHaveBeenCalled();
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
