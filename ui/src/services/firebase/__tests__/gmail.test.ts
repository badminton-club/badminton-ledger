export {}; // marks this file as a module for `isolatedModules` (only `require()`/type-only imports below)

type GmailModule = typeof import('../gmail');
type HelpersModule = typeof import('../../../test-utils/firebaseTestHelpers');
type FakeAuthModule = typeof import('../../../test-utils/fakeAuth');

const originalFetch = global.fetch;

let gmail: GmailModule;
let helpers: HelpersModule;
let fakeAuth: FakeAuthModule;

const userOne = { uid: 'user-1', displayName: 'User One', email: 'user1@example.com' };

const jsonResponse = (body: unknown, init: Partial<{ ok: boolean; status: number; statusText: string }> = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  statusText: init.statusText ?? 'OK',
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

function fetchMock(): jest.Mock {
  return global.fetch as unknown as jest.Mock;
}

function expectBearerToken(callIndex: number, token: string): void {
  const init = fetchMock().mock.calls[callIndex][1] as RequestInit;
  const headers = init.headers as Record<string, string>;
  expect(headers.Authorization).toBe(`Bearer ${token}`);
}

/** base64url-encodes a string the way Gmail message body parts are encoded. */
function b64url(text: string): string {
  return Buffer.from(text, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// The plain-text body Gmail returns for a real Interac autodeposit notification
// (extracted from a saved sample email), reformatted here as it appears once
// base64url-decoded — this is the shape parseEtransferMessage is built against.
const SAMPLE_PLAIN_BODY = `Hi WENDY WU,
Funds Deposited!
$200.00
Your funds have been automatically deposited into your
account at TD Canada Trust.
TD Canada Trust
Account ending in 8048
Transfer Details
Message:
cash for shoppers
Date:
Aug 26, 2026
Reference Number:
C1AYd8eJYUcY
Sent From:
CAI FANG WU
Amount:
$200.00 (CAD)`;

const SAMPLE_HTML_BODY = `<html><body>
<p>Hi WENDY WU,</p>
<p>Funds Deposited! <b>$200.00</b></p>
<table>
<tr><td>Message:</td><td>cash for shoppers</td></tr>
<tr><td>Date:</td><td>Aug 26, 2026</td></tr>
<tr><td>Reference Number:</td><td>C1AYd8eJYUcY</td></tr>
<tr><td>Sent From:</td><td>CAI FANG WU</td></tr>
<tr><td>Amount:</td><td>$200.00 (CAD)</td></tr>
</table>
</body></html>`;

function sampleMessage(overrides: {
  id?: string;
  threadId?: string;
  subject?: string;
  from?: string;
  replyTo?: string | null;
  date?: string;
  bodyData?: string;
  mimeType?: 'text/plain' | 'text/html';
} = {}) {
  const {
    id = 'msg-1',
    threadId = 'thread-1',
    subject = "Interac e-Transfer: You've received $200.00 from CAI FANG WU and it has been automatically deposited.",
    from = 'CAI FANG WU <notify@payments.interac.ca>',
    replyTo = 'CAI FANG WU <caifang1966@gmail.com>',
    date = 'Wed, 26 Aug 2026 10:47:00 -0400',
    bodyData = b64url(SAMPLE_PLAIN_BODY),
    mimeType = 'text/plain',
  } = overrides;

  return {
    id,
    threadId,
    payload: {
      headers: [
        { name: 'Subject', value: subject },
        { name: 'From', value: from },
        ...(replyTo ? [{ name: 'Reply-To', value: replyTo }] : []),
        { name: 'Date', value: date },
      ],
      mimeType,
      body: { data: bodyData },
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  gmail = require('../gmail');
  helpers = require('../../../test-utils/firebaseTestHelpers');
  fakeAuth = require('../../../test-utils/fakeAuth');
  helpers.resetFirebaseTestState();
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch as typeof fetch;
  jest.restoreAllMocks();
});

describe('parseEtransferMessage', () => {
  it('parses sender, amount, memo, and reference number from a real autodeposit email (plain-text body)', () => {
    const parsed = gmail.parseEtransferMessage(sampleMessage());

    expect(parsed).toEqual({
      gmailMessageId: 'msg-1',
      gmailThreadId: 'thread-1',
      subject: "Interac e-Transfer: You've received $200.00 from CAI FANG WU and it has been automatically deposited.",
      senderName: 'CAI FANG WU',
      senderEmail: 'caifang1966@gmail.com',
      amount: 200,
      memo: 'cash for shoppers',
      referenceNumber: 'C1AYd8eJYUcY',
      emailDate: new Date('Wed, 26 Aug 2026 10:47:00 -0400'),
    });
  });

  it('falls back to stripping HTML tags when only an HTML body part is present', () => {
    const parsed = gmail.parseEtransferMessage(
      sampleMessage({ mimeType: 'text/html', bodyData: b64url(SAMPLE_HTML_BODY) })
    );

    expect(parsed?.senderName).toBe('CAI FANG WU');
    expect(parsed?.memo).toBe('cash for shoppers');
    expect(parsed?.referenceNumber).toBe('C1AYd8eJYUcY');
    expect(parsed?.amount).toBe(200);
  });

  it('prefers the plain-text part over an accompanying HTML part in a multipart message', () => {
    const message = sampleMessage();
    // Turn the single-part sample into a multipart/alternative message with both
    // an HTML part (first) and a plain-text part (second) — the parser must pick
    // the plain-text one regardless of order.
    (message.payload as { parts?: unknown[] }).parts = [
      { mimeType: 'text/html', body: { data: b64url('<p>irrelevant html noise</p>') } },
      { mimeType: 'text/plain', body: { data: b64url(SAMPLE_PLAIN_BODY) } },
    ];
    delete (message.payload as { body?: unknown }).body;

    const parsed = gmail.parseEtransferMessage(message);
    expect(parsed?.memo).toBe('cash for shoppers');
  });

  it('returns null for an email whose subject does not match the autodeposit format', () => {
    const parsed = gmail.parseEtransferMessage(
      sampleMessage({ subject: 'Interac e-Transfer: CAI FANG WU sent you money' })
    );
    expect(parsed).toBeNull();
  });

  it('falls back to the From header display name when Reply-To is missing', () => {
    const message = sampleMessage({ replyTo: null });
    const parsed = gmail.parseEtransferMessage(message);
    expect(parsed?.senderEmail).toBeNull();
    expect(parsed?.senderName).toBe('CAI FANG WU');
  });
});

describe('getDefaultEtransferSearchAfterDate', () => {
  it('returns exactly one UTC calendar week before the given reference date', () => {
    expect(gmail.getDefaultEtransferSearchAfterDate(new Date('2026-08-27T14:47:00.000Z'))).toBe('2026-08-20');
  });

  it('crosses a month/year boundary correctly', () => {
    expect(gmail.getDefaultEtransferSearchAfterDate(new Date('2026-01-03T00:00:00.000Z'))).toBe('2025-12-27');
  });

  it('defaults to one week before the real current date when no reference is given', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-27T08:45:55.172Z'));
    expect(gmail.getDefaultEtransferSearchAfterDate()).toBe('2026-08-20');
    jest.useRealTimers();
  });
});

describe('searchEtransferEmails', () => {
  it('re-authenticates with the read-only Gmail scope and parses full messages', async () => {
    helpers.setCurrentUser(userOne);
    const reauth = jest.fn(async (user, provider) => {
      expect(provider.getScopes()).toEqual(['https://www.googleapis.com/auth/gmail.readonly']);
      expect(provider.getCustomParameters()).toEqual({});
      return { user, __credential: { accessToken: 'gmail-token' } };
    });
    fakeAuth.__setReauthImplementation(reauth);

    const message = sampleMessage();
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'msg-1', threadId: 'thread-1' }] }))
      .mockResolvedValueOnce(jsonResponse(message));

    const results = await gmail.searchEtransferEmails('notify@payments.interac.ca', '2026-08-27');

    expect(results).toHaveLength(1);
    expect(results[0].senderName).toBe('CAI FANG WU');
    expect(results[0].amount).toBe(200);

    const searchUrl = fetchMock().mock.calls[0][0] as string;
    expect(searchUrl).toContain(encodeURIComponent('from:notify@payments.interac.ca'));
    expect(searchUrl).toContain(encodeURIComponent(`after:${Date.UTC(2026, 7, 27) / 1000}`));
    expectBearerToken(0, 'gmail-token');
    expectBearerToken(1, 'gmail-token');
  });

  it('returns an empty array when no messages are found, without fetching any message detail', async () => {
    helpers.setCurrentUser(userOne);
    fakeAuth.__setReauthImplementation(async (user) => ({ user, __credential: { accessToken: 'gmail-token' } }));
    fetchMock().mockResolvedValueOnce(jsonResponse({}));

    const results = await gmail.searchEtransferEmails('notify@payments.interac.ca');
    expect(results).toEqual([]);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('filters out emails that do not match the autodeposit subject format', async () => {
    helpers.setCurrentUser(userOne);
    fakeAuth.__setReauthImplementation(async (user) => ({ user, __credential: { accessToken: 'gmail-token' } }));

    const nonAutodeposit = sampleMessage({ id: 'msg-2', subject: 'Interac e-Transfer: CAI FANG WU sent you money' });
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'msg-2', threadId: 'thread-1' }] }))
      .mockResolvedValueOnce(jsonResponse(nonAutodeposit));

    const results = await gmail.searchEtransferEmails('notify@payments.interac.ca');
    expect(results).toEqual([]);
  });
});

describe('Gmail authorization reuse', () => {
  it('shares one authorization popup across concurrent Gmail operations', async () => {
    helpers.setCurrentUser(userOne);
    type AuthorizationResult = {
      user: typeof userOne;
      __credential: { accessToken: string };
    };
    let finishAuthorization: ((value: AuthorizationResult) => void) | undefined;
    const authorization = new Promise<AuthorizationResult>((resolve) => {
      finishAuthorization = resolve;
    });
    const reauth = jest.fn(() => authorization);
    fakeAuth.__setReauthImplementation(reauth);

    const first = gmail.searchEtransferEmails('notify@payments.interac.ca');
    const second = gmail.searchEtransferEmails('other@example.com');
    expect(reauth).toHaveBeenCalledTimes(1);

    fetchMock()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}));
    finishAuthorization?.({ user: userOne, __credential: { accessToken: 'gmail-token' } });

    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
    expect(reauth).toHaveBeenCalledTimes(1);
  });
});
