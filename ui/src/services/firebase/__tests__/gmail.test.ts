import * as gmail from '../gmail';
import { auth, setCurrentClubId } from '../client';
import { resetFirebaseTestState, setCurrentUser } from '../../../test-utils/firebaseTestHelpers';

const originalFetch = global.fetch;
const getIdToken = jest.fn();
const userOne = { uid: 'user-1', displayName: 'User One', email: 'user1@example.com', getIdToken };
const fetchMock = () => global.fetch as jest.Mock;
const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});
const authorizationUrl = 'https://accounts.google.com/o/oauth2/v2/auth?state=example';
const b64url = (text: string) => Buffer.from(text, 'utf-8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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
  id?: string; threadId?: string; subject?: string; from?: string;
  replyTo?: string | null; bodyData?: string; mimeType?: string;
} = {}) {
  const {
    id = 'msg-1', threadId = 'thread-1',
    subject = "Interac e-Transfer: You've received $200.00 from CAI FANG WU and it has been automatically deposited.",
    from = 'CAI FANG WU <notify@payments.interac.ca>',
    replyTo = 'CAI FANG WU <caifang1966@gmail.com>',
    bodyData = b64url(SAMPLE_PLAIN_BODY), mimeType = 'text/plain',
  } = overrides;
  return {
    id, threadId,
    payload: {
      headers: [
        { name: 'Subject', value: subject }, { name: 'From', value: from },
        ...(replyTo ? [{ name: 'Reply-To', value: replyTo }] : []),
        { name: 'Date', value: 'Wed, 26 Aug 2026 10:47:00 -0400' },
      ],
      mimeType, body: { data: bodyData },
    },
  };
}

beforeEach(() => {
  resetFirebaseTestState();
  getIdToken.mockReset().mockResolvedValue('firebase-id-token');
  setCurrentUser(userOne);
  global.fetch = jest.fn() as unknown as typeof fetch;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('parseEtransferMessage', () => {
  it.each(['FW:', 'RE:', 'FWD:', 'Fwd:', 'Re:', 'fw:', 'rE:', 'FW: Re: Fwd:', ''])(
    'parses an autodeposit subject with the %s prefix', (prefix) => {
      const subject = `${prefix} Interac e-Transfer: You've received $10.71 from XXX and it has been automatically deposited.`;
      expect(gmail.parseEtransferMessage(sampleMessage({ subject })))
        .toMatchObject({ subject, senderName: 'XXX', senderEmail: prefix ? null : 'caifang1966@gmail.com', amount: 10.71 });
    }
  );
  it('parses a subject without the Interac introduction', () => {
    expect(gmail.parseEtransferMessage(sampleMessage({
      subject: 'Received $1,234.56 from XXX and it has been automatically deposited.',
    }))).toMatchObject({ senderName: 'XXX', amount: 1234.56 });
  });
  it.each(['Interac e-Transfer: CAI FANG WU sent you money', 'Fwd: Interac e-Transfer: XXX sent you money'])(
    'rejects manual-deposit subject %s', (subject) => {
      expect(gmail.parseEtransferMessage(sampleMessage({ subject }))).toBeNull();
    }
  );
  it('parses the full real autodeposit sample', () => {
    expect(gmail.parseEtransferMessage(sampleMessage())).toEqual({
      gmailMessageId: 'msg-1', gmailThreadId: 'thread-1',
      subject: "Interac e-Transfer: You've received $200.00 from CAI FANG WU and it has been automatically deposited.",
      senderName: 'CAI FANG WU', senderEmail: 'caifang1966@gmail.com', amount: 200,
      memo: 'cash for shoppers', referenceNumber: 'C1AYd8eJYUcY',
      emailDate: new Date('Wed, 26 Aug 2026 10:47:00 -0400'),
    });
  });
  it('strips HTML when only an HTML part exists', () => {
    expect(gmail.parseEtransferMessage(sampleMessage({ mimeType: 'text/html', bodyData: b64url(SAMPLE_HTML_BODY) })))
      .toMatchObject({ senderName: 'CAI FANG WU', memo: 'cash for shoppers', referenceNumber: 'C1AYd8eJYUcY', amount: 200 });
  });
  it('prefers plain text in a multipart email', () => {
    const message = sampleMessage();
    const payload: Parameters<typeof gmail.parseEtransferMessage>[0]['payload'] = {
      headers: message.payload.headers, mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/html', body: { data: b64url('<p>irrelevant html noise</p>') } },
        { mimeType: 'text/plain', body: { data: b64url(SAMPLE_PLAIN_BODY) } },
      ],
    };
    expect(gmail.parseEtransferMessage({ ...message, payload })?.memo).toBe('cash for shoppers');
  });
  it('keeps the subject payer without Reply-To or body email recovery', () => {
    expect(gmail.parseEtransferMessage(sampleMessage({ replyTo: null })))
      .toMatchObject({ senderName: 'CAI FANG WU', senderEmail: null });
    expect(gmail.parseEtransferMessage(sampleMessage({
      subject: "Fwd: RE: Interac e-Transfer: You've received $15.00 from PAT SMITH and it has been automatically deposited.",
      from: 'Club Treasurer <forwarder@example.com>', replyTo: null,
      bodyData: b64url('From: Another Person <arbitrary@example.com> Sent From: WRONG NAME Amount: $15.00'),
    }))).toMatchObject({ senderName: 'PAT SMITH', senderEmail: null, amount: 15 });
  });
  it.each([
    ['Club Treasurer <Forwarder@Example.com>', '"Different Display" <FORWARDER@example.com>'],
    ['FORWARDER@example.com', 'Club Treasurer <forwarder@example.com>'],
    ['Club Treasurer <forwarder@example.com>', 'FORWARDER@example.com'],
    ['FORWARDER@example.com', 'forwarder@example.com'],
    ['forwarder@example.com', 'Another forwarder <another@example.com>'],
  ])('does not treat a forwarding From %s / Reply-To %s as payer', (from, replyTo) => {
    const message = sampleMessage({ from, replyTo });
    message.payload.headers.forEach((header) => { header.name = header.name.toUpperCase(); });
    expect(gmail.parseEtransferMessage(message)).toMatchObject({ senderName: 'CAI FANG WU', senderEmail: null });
  });
  it.each([
    ['INTERAC <NOTIFY@PAYMENTS.INTERAC.CA>', 'Payer <PAYER@example.com>'],
    ['notify@payments.interac.ca', 'payer@example.com'],
  ])('preserves the distinct payer Reply-To on original mail from %s', (from, replyTo) => {
    expect(gmail.parseEtransferMessage(sampleMessage({ from, replyTo })))
      .toMatchObject({ senderName: 'CAI FANG WU', senderEmail: 'payer@example.com' });
  });
  it('does not treat an Interac Reply-To as payer', () => {
    expect(gmail.parseEtransferMessage(sampleMessage({
      from: 'notify@payments.interac.ca', replyTo: 'Interac <NOTIFY@PAYMENTS.INTERAC.CA>',
    }))?.senderEmail).toBeNull();
  });
  it('trusts the subject over memo text imitating body labels', () => {
    const bodyData = b64url(SAMPLE_PLAIN_BODY.replace(
      'cash for shoppers', 'cash for shoppers Sent From: FAKE ATTACKER Amount: $999.99'
    ));
    expect(gmail.parseEtransferMessage(sampleMessage({ bodyData })))
      .toMatchObject({ senderName: 'CAI FANG WU', amount: 200 });
  });
});

describe('search defaults', () => {
  const reference = new Date('2026-08-27T14:47:00.000Z');
  it('resolves the default UTC week and year boundary', () => {
    expect(gmail.getDefaultEtransferSearchAfterDate(reference)).toBe('2026-08-20');
    expect(gmail.getDefaultEtransferSearchAfterDate(new Date('2026-01-03T00:00:00.000Z'))).toBe('2025-12-27');
    jest.useFakeTimers().setSystemTime(reference);
    expect(gmail.getDefaultEtransferSearchAfterDate()).toBe('2026-08-20');
  });
  it('computes arbitrary UTC windows', () => {
    expect(gmail.dateDaysBeforeUtc(14, reference)).toBe('2026-08-13');
    expect(gmail.dateDaysBeforeUtc(30, reference)).toBe('2026-07-28');
    expect(gmail.dateDaysBeforeUtc(90, reference)).toBe('2026-05-29');
  });
  it('prefers rolling over absolute dates, then falls back to the default week', () => {
    expect(gmail.resolveEtransferSearchAfterDate({ etransferSearchWindowDays: 30, etransferSearchAfterDate: '2026-01-01' }, reference)).toBe('2026-07-28');
    expect(gmail.resolveEtransferSearchAfterDate({ etransferSearchWindowDays: null, etransferSearchAfterDate: '2026-01-01' }, reference)).toBe('2026-01-01');
    expect(gmail.resolveEtransferSearchAfterDate(null, reference)).toBe('2026-08-20');
    expect(gmail.resolveEtransferSearchAfterDate({}, reference)).toBe('2026-08-20');
  });
  it('resolves legacy/default senders but fails closed for an empty saved list', () => {
    expect(gmail.resolveEtransferSenderAddresses(null)).toEqual(['notify@payments.interac.ca']);
    expect(gmail.resolveEtransferSenderAddresses({})).toEqual(['notify@payments.interac.ca']);
    expect(gmail.resolveEtransferSenderAddresses({ etransferSenderAddress: ' Bank@Example.com ' })).toEqual(['bank@example.com']);
    expect(gmail.resolveEtransferSenderAddresses({
      etransferSenderAddress: 'bank@example.com', etransferSenderAddresses: ['forwarder@example.com'],
    })).toEqual(['forwarder@example.com']);
    expect(() => gmail.resolveEtransferSenderAddresses({
      etransferSenderAddress: 'bank@example.com', etransferSenderAddresses: [],
    })).toThrow('Enter at least one valid allowed sender');
  });
});

describe('backend Gmail handoff', () => {
  it('sends a current Firebase ID token and club with explicit private POST settings', async () => {
    fetchMock().mockResolvedValue(jsonResponse({ connected: true }));
    expect(await gmail.getGmailConnectionStatus()).toEqual({ connected: true });
    expect(getIdToken).toHaveBeenCalledTimes(1);
    expect(fetchMock()).toHaveBeenCalledWith('/api/gmail/status', {
      method: 'POST', cache: 'no-store', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Authorization: ['Bearer', 'firebase-id-token'].join(' ') },
      body: JSON.stringify({ clubId: 'test-club' }),
    });
  });
  it('refuses requests without an app user, club or usable ID token', async () => {
    setCurrentUser(null);
    await expect(gmail.getGmailConnectionStatus()).rejects.toThrow('signed in');
    setCurrentUser(userOne);
    setCurrentClubId(null);
    await expect(gmail.startGmailConnection()).rejects.toThrow('Select a club');
    setCurrentClubId('test-club');
    getIdToken.mockRejectedValue(new Error('token expired'));
    await expect(gmail.getGmailConnectionStatus()).rejects.toThrow('token expired');
    getIdToken.mockResolvedValue('');
    await expect(gmail.getGmailConnectionStatus()).rejects.toThrow('Sign in again');
    expect(fetchMock()).not.toHaveBeenCalled();
  });
  it.each(['uid', 'club'])('does not send a request if %s changes while obtaining an ID token', async (scope) => {
    getIdToken.mockImplementation(async () => {
      if (scope === 'uid') setCurrentUser(null);
      else setCurrentClubId('other-club');
      return 'old-id-token';
    });
    await expect(gmail.getGmailConnectionStatus()).rejects.toThrow('account or club changed');
    expect(fetchMock()).not.toHaveBeenCalled();
  });
  it.each(['uid', 'club'])('rejects a response if %s changes while reading it', async (scope) => {
    fetchMock().mockResolvedValue({
      ok: true, json: async () => {
        if (scope === 'uid') setCurrentUser(null);
        else setCurrentClubId('other-club');
        return { connected: true };
      },
    });
    await expect(gmail.getGmailConnectionStatus()).rejects.toThrow('account or club changed');
  });
  it('starts authorization without altering the app user or using storage', async () => {
    const storage = jest.spyOn(Storage.prototype, 'setItem');
    fetchMock().mockResolvedValue(jsonResponse({ authorizationUrl }));
    expect(await gmail.startGmailConnection()).toEqual({ authorizationUrl });
    expect(fetchMock().mock.calls[0][0]).toBe('/api/gmail/connect');
    expect(auth.currentUser?.uid).toBe(userOne.uid);
    expect(storage).not.toHaveBeenCalled();
  });
  it.each([
    'http://accounts.google.com/o/oauth2/v2/auth',
    'https://accounts.google.com.evil.example/o/oauth2/v2/auth',
    'https://accounts.google.com/o/oauth2/auth',
    'https://accounts.google.com:8443/o/oauth2/v2/auth',
    'https://user@accounts.google.com/o/oauth2/v2/auth',
    'javascript:alert(1)', '/o/oauth2/v2/auth', '',
  ])('refuses unsafe authorization URL %s', async (url) => {
    fetchMock().mockResolvedValue(jsonResponse({ authorizationUrl: url }));
    await expect(gmail.startGmailConnection()).rejects.toThrow('invalid authorization link');
  });
  it('disconnects the current club through the backend', async () => {
    fetchMock().mockResolvedValue(jsonResponse({ connected: false }));
    await gmail.disconnectGmail();
    expect(fetchMock()).toHaveBeenCalledWith('/api/gmail/disconnect', expect.objectContaining({
      body: JSON.stringify({ clubId: 'test-club' }),
    }));
  });
  it('confirms a browser-only ticket for the explicit destination club without needing a selected club', async () => {
    setCurrentClubId(null);
    fetchMock().mockResolvedValue(jsonResponse({ connected: true }));
    await gmail.confirmGmailConnection('browser-only-ticket', 'destination-club');
    expect(fetchMock()).toHaveBeenCalledWith('/api/gmail/confirm', {
      method: 'POST', cache: 'no-store', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Authorization: ['Bearer', 'firebase-id-token'].join(' ') },
      body: JSON.stringify({ clubId: 'destination-club', ticket: 'browser-only-ticket' }),
    });
  });
  it('keeps confirmation scoped to its destination even if another club is selected while awaiting the response', async () => {
    fetchMock().mockResolvedValue({
      ok: true, json: async () => {
        setCurrentClubId('other-club');
        return { connected: true };
      },
    });
    await expect(gmail.confirmGmailConnection('browser-only-ticket', 'destination-club')).resolves.toBeUndefined();
  });
  it('does not send confirmation if the signed-in account changes while obtaining its ID token', async () => {
    getIdToken.mockImplementation(async () => {
      setCurrentUser({ uid: 'victim', email: 'victim@example.com', displayName: null });
      return 'old-id-token';
    });
    await expect(gmail.confirmGmailConnection('browser-only-ticket', 'destination-club'))
      .rejects.toThrow('account or club changed');
    expect(fetchMock()).not.toHaveBeenCalled();
  });
  it('rejects a stale confirmation response after an account change', async () => {
    fetchMock().mockResolvedValue({
      ok: true, json: async () => {
        setCurrentUser(null);
        return { connected: true };
      },
    });
    await expect(gmail.confirmGmailConnection('browser-only-ticket', 'destination-club'))
      .rejects.toThrow('account or club changed');
  });
  it('explains that forwarded tickets cannot be confirmed by another app account', async () => {
    fetchMock().mockResolvedValue(jsonResponse({ error: { code: 'gmail/wrong-owner', message: 'untrusted' } }, 403));
    await expect(gmail.confirmGmailConnection('forwarded-ticket', 'attacker-club'))
      .rejects.toThrow('same app account that started');
  });
  it.each(['status', 'confirm'])('explains an allowed-origin configuration failure before generic %s authorization errors', async (action) => {
    fetchMock().mockResolvedValue(jsonResponse({ error: { code: 'gmail/origin-denied' } }, 403));
    const request = action === 'status'
      ? gmail.getGmailConnectionStatus()
      : gmail.confirmGmailConnection('browser-only-ticket', 'destination-club');
    await expect(request).rejects.toThrow(
      'Gmail is not configured for this website. Ask an administrator to update the backend allowed origins.'
    );
  });
  it.each([400, 409, 410])('explains expired or already-used confirmation tickets (%s)', async (status) => {
    fetchMock().mockResolvedValue(jsonResponse({ error: { code: 'gmail/invalid-state' } }, status));
    await expect(gmail.confirmGmailConnection('old-ticket', 'destination-club'))
      .rejects.toThrow('invalid, expired, or already used');
  });
  it('does not send incomplete confirmation handoffs', async () => {
    await expect(gmail.confirmGmailConnection('', 'destination-club')).rejects.toThrow('incomplete');
    await expect(gmail.confirmGmailConnection('ticket', '')).rejects.toThrow('incomplete');
    expect(fetchMock()).not.toHaveBeenCalled();
  });
  it('exposes the typed reconnect error without trusting arbitrary API messages', async () => {
    fetchMock().mockResolvedValue(jsonResponse({ error: { code: 'gmail/not-connected', message: 'revoked' } }, 409));
    await expect(gmail.searchEtransferEmails('notify@payments.interac.ca'))
      .rejects.toMatchObject({ code: 'gmail/not-connected', name: 'GmailConnectionRequiredError' });
  });
  it.each(['gmail/search-too-large', 'gmail/response-too-large', 'gmail/search-timeout'])(
    'explains how to recover from a bounded search failure (%s)', async (code) => {
      fetchMock().mockResolvedValue(jsonResponse({ error: { code, message: 'untrusted upstream detail' } }, 502));
      await expect(gmail.searchEtransferEmails('notify@payments.interac.ca'))
        .rejects.toThrow('Narrow the search window or custom query and try again');
    }
  );
  it('does not expose unknown upstream search errors', async () => {
    fetchMock().mockResolvedValue(jsonResponse({
      error: { code: 'gmail/upstream-error', message: 'private mailbox detail' },
    }, 502));
    await expect(gmail.searchEtransferEmails('notify@payments.interac.ca'))
      .rejects.toThrow('Gmail service is unavailable');
  });
  it.each([200, 404, 502])('handles non-JSON deployment responses safely (%s)', async (status) => {
    fetchMock().mockResolvedValue({ ok: status === 200, status, json: async () => { throw new Error('<html>'); } });
    await expect(gmail.getGmailConnectionStatus()).rejects.toThrow('backend is deployed');
  });
  it.each([{ connected: 'true' }, {}, null])('rejects malformed status %j', async (body) => {
    fetchMock().mockResolvedValue(jsonResponse(body));
    await expect(gmail.getGmailConnectionStatus()).rejects.toThrow('service is unavailable');
  });
  it.each([401, 403])('explains app-auth errors (%s)', async (status) => {
    fetchMock().mockResolvedValue(jsonResponse({ error: { message: '<script>secret</script>' } }, status));
    await expect(gmail.getGmailConnectionStatus()).rejects.toThrow(status === 401 ? 'Sign in again' : 'administrator');
  });
});

describe('searchEtransferEmails', () => {
  it('sends only search options and club, never senders or Gmail tokens, and parses returned full messages', async () => {
    fetchMock().mockResolvedValue(jsonResponse({ messages: [sampleMessage()] }));
    const result = await gmail.searchEtransferEmails('notify@payments.interac.ca', '2026-08-01', ' label:club ');
    expect(result[0]).toMatchObject({ senderName: 'CAI FANG WU', amount: 200 });
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(fetchMock().mock.calls[0][0]).toBe('/api/gmail/search');
    expect(JSON.parse(fetchMock().mock.calls[0][1].body)).toEqual({
      clubId: 'test-club', searchAfterDate: '2026-08-01', customGmailQuery: 'label:club',
    });
  });
  it('normalizes and deduplicates multiple allowed senders, including forwarded messages', async () => {
    fetchMock().mockResolvedValue(jsonResponse({ messages: [
      sampleMessage(),
      sampleMessage({ id: 'forward', from: 'Treasurer <Forwarder@Example.com>', subject: "Fwd: Interac e-Transfer: You've received $15.00 from PAT SMITH and it has been automatically deposited." }),
    ] }));
    const result = await gmail.searchEtransferEmails(
      [' NOTIFY@payments.interac.ca ', 'forwarder@example.com', 'FORWARDER@example.com'], '2026-08-01', 'label:forwarded OR from:other@example.com'
    );
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ senderName: 'PAT SMITH', senderEmail: null });
  });
  it.each([
    'notify@payments.interac.ca.evil.example', 'Other <attacker@example.com>',
    'notify@payments.interac.ca <attacker@example.com>', 'notify@payments.interac.ca,attacker@example.com',
    'notify@payments.interac.ca attacker@example.com', 'Group: notify@payments.interac.ca;',
  ])('checks actual From against the allowlist even with an OR query: %s', async (from) => {
    fetchMock().mockResolvedValue(jsonResponse({ messages: [sampleMessage({ from })] }));
    expect(await gmail.searchEtransferEmails('notify@payments.interac.ca', '2026-08-01', 'from:attacker@example.com OR label:club')).toEqual([]);
  });
  it('rejects missing or duplicate From headers, not just a matching Reply-To', async () => {
    const missing = sampleMessage();
    missing.payload.headers = missing.payload.headers.filter((header) => header.name !== 'From');
    const duplicate = sampleMessage();
    duplicate.payload.headers.push({ name: 'FROM', value: 'notify@payments.interac.ca' });
    fetchMock().mockResolvedValue(jsonResponse({ messages: [missing, duplicate] }));
    expect(await gmail.searchEtransferEmails('notify@payments.interac.ca')).toEqual([]);
  });
  it('returns an empty array for no results and filters manual deposit messages', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockResolvedValueOnce(jsonResponse({ messages: [sampleMessage({ subject: 'Someone sent you money' })] }));
    expect(await gmail.searchEtransferEmails('notify@payments.interac.ca')).toEqual([]);
    expect(await gmail.searchEtransferEmails('notify@payments.interac.ca')).toEqual([]);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });
  it.each(['', 'from:someone@example.com', 'valid@example.com, invalid'])('rejects invalid sender setting %s before fetching', async (sender) => {
    await expect(gmail.searchEtransferEmails(sender)).rejects.toThrow('valid allowed sender');
    expect(fetchMock()).not.toHaveBeenCalled();
  });
  it.each(['2026-02-30', '2026/08/01', ''])('rejects invalid date %s without a custom query', async (date) => {
    await expect(gmail.searchEtransferEmails('notify@payments.interac.ca', date)).rejects.toThrow('valid e-Transfer search date');
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});
