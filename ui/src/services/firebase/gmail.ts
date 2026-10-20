import { auth, getCurrentClubId } from './client';
import { serviceCall } from './utils';

/** The default sender address for Interac e-Transfer autodeposit notifications. */
export const DEFAULT_ETRANSFER_SENDER_ADDRESS = 'notify@payments.interac.ca';

const SENDER_EMAIL_PATTERN = /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

export function normalizeEtransferSenderAddresses(value: string | string[]): string[] {
  const entries = typeof value === 'string' ? value.split(/[,\n]/) : value;
  const addresses = entries.map((entry) => entry.trim().toLowerCase());
  if (!addresses.length || addresses.some((address) => !SENDER_EMAIL_PATTERN.test(address))) {
    throw new Error('Enter at least one valid allowed sender email address, separated by commas or newlines.');
  }
  return Array.from(new Set(addresses));
}

export function resolveEtransferSenderAddresses(
  club: { etransferSenderAddresses?: string[]; etransferSenderAddress?: string } | null | undefined
): string[] {
  return normalizeEtransferSenderAddresses(
    club?.etransferSenderAddresses ?? club?.etransferSenderAddress ?? DEFAULT_ETRANSFER_SENDER_ADDRESS
  );
}

/** The default rolling search window: one calendar week back. */
export const DEFAULT_ETRANSFER_SEARCH_WINDOW_DAYS = 7;

/** Preset rolling-window choices offered in the e-Transfer search UI. */
export const ETRANSFER_SEARCH_WINDOW_PRESETS: { days: number; label: string }[] = [
  { days: 1, label: '1 day' },
  { days: 2, label: '2 days' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
];

/**
 * Formats the UTC calendar date `daysBack` days before `reference` (today,
 * unless overridden — mainly for tests) as an ISO `YYYY-MM-DD` string.
 */
export function dateDaysBeforeUtc(daysBack: number, reference: Date = new Date()): string {
  const todayUtcMs = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  const target = new Date(todayUtcMs - daysBack * 24 * 60 * 60 * 1000);
  const year = target.getUTCFullYear();
  const month = String(target.getUTCMonth() + 1).padStart(2, '0');
  const day = String(target.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The default lower bound for Gmail e-Transfer searches: one calendar week
 * (UTC) before `reference` (today, unless overridden — mainly for tests).
 * Computed at call time rather than a fixed constant so it stays useful as
 * time passes, rather than needing to be manually bumped forward.
 */
export function getDefaultEtransferSearchAfterDate(reference: Date = new Date()): string {
  return dateDaysBeforeUtc(DEFAULT_ETRANSFER_SEARCH_WINDOW_DAYS, reference);
}

/**
 * Resolves the actual search-after date to use for a club: a rolling window
 * (in days, recomputed fresh every call so it never goes stale) takes
 * priority once set; otherwise falls back to a previously saved one-off
 * absolute date, then finally the default rolling window.
 */
export function resolveEtransferSearchAfterDate(
  club: { etransferSearchWindowDays?: number | null; etransferSearchAfterDate?: string | null } | null | undefined,
  reference: Date = new Date()
): string {
  if (club?.etransferSearchWindowDays != null) {
    return dateDaysBeforeUtc(club.etransferSearchWindowDays, reference);
  }
  if (club?.etransferSearchAfterDate) return club.etransferSearchAfterDate;
  return getDefaultEtransferSearchAfterDate(reference);
}

export interface ParsedEtransferEmail {
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string;
  senderName: string;
  senderEmail: string | null;
  amount: number;
  memo: string | null;
  referenceNumber: string | null;
  emailDate: Date;
}

export class GmailConnectionRequiredError extends Error {
  readonly code = 'gmail/not-connected';

  constructor() {
    super('Gmail is not connected or its authorization has expired. Connect Gmail again.');
    this.name = 'GmailConnectionRequiredError';
  }
}

const API_UNAVAILABLE = 'Gmail service is unavailable. Check that the Gmail backend is deployed, then try again.';

async function gmailRequest(
  action: 'status' | 'connect' | 'disconnect' | 'search' | 'confirm',
  fields: Record<string, unknown> = {},
  destinationClubId?: string
): Promise<Record<string, unknown>> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to connect Gmail.');
  const uid = user.uid;
  const clubId = destinationClubId ?? getCurrentClubId();
  if (!clubId) throw new Error('Select a club before connecting Gmail.');
  const assertScope = () => {
    if (auth.currentUser?.uid !== uid || (destinationClubId === undefined && getCurrentClubId() !== clubId)) {
      throw new Error('Your signed-in account or club changed. Try again for the current club.');
    }
  };
  const idToken = await user.getIdToken();
  assertScope();
  if (!idToken) throw new Error('Your app sign-in has expired. Sign in again, then check Gmail connection.');
  const response = await fetch(`/api/gmail/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: ['Bearer', idToken].join(' ') },
    body: JSON.stringify({ clubId, ...fields }),
    cache: 'no-store',
    credentials: 'omit',
  });
  const body = await response.json().catch(() => null);
  assertScope();
  if (!response.ok) {
    if (body?.error?.code === 'gmail/not-connected') throw new GmailConnectionRequiredError();
    if (response.status === 403 && body?.error?.code === 'gmail/origin-denied') {
      throw new Error('Gmail is not configured for this website. Ask an administrator to update the backend allowed origins.');
    }
    if (action === 'search' && response.status === 502
      && ['gmail/search-too-large', 'gmail/response-too-large', 'gmail/search-timeout'].includes(body?.error?.code)) {
      throw new Error('Gmail search could not finish. Narrow the search window or custom query and try again.');
    }
    if (response.status === 401) throw new Error('Your app sign-in has expired. Sign in again, then check Gmail connection.');
    if (action === 'confirm' && response.status === 403) {
      throw new Error('Sign in with the same app account that started this Gmail connection. You must still be an administrator of the destination club.');
    }
    if (action === 'confirm' && (response.status === 400 || response.status === 409 || response.status === 410)) {
      throw new Error('This Gmail confirmation link is invalid, expired, or already used. Start a new connection from the app.');
    }
    if (response.status === 403) throw new Error('Only a club administrator can manage this Gmail connection.');
    throw new Error(API_UNAVAILABLE);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(API_UNAVAILABLE);
  return body;
}

export async function getGmailConnectionStatus(): Promise<{ connected: boolean; emailAddress?: string }> {
  const body = await gmailRequest('status');
  if (typeof body.connected !== 'boolean') throw new Error(API_UNAVAILABLE);
  if (body.emailAddress !== undefined && (typeof body.emailAddress !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.emailAddress))) throw new Error(API_UNAVAILABLE);
  return { connected: body.connected,
    ...(body.connected && typeof body.emailAddress === 'string' ? { emailAddress: body.emailAddress } : {}) };
}

export async function startGmailConnection(): Promise<{ authorizationUrl: string }> {
  const body = await gmailRequest('connect');
  let url: URL;
  try {
    if (typeof body.authorizationUrl !== 'string') throw new Error();
    url = new URL(body.authorizationUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || url.port
      || url.username || url.password || url.pathname !== '/o/oauth2/v2/auth') throw new Error();
  } catch {
    throw new Error('Gmail service returned an invalid authorization link. Please try connecting again.');
  }
  return { authorizationUrl: url.href };
}

export async function disconnectGmail(): Promise<void> {
  await gmailRequest('disconnect');
}

export async function confirmGmailConnection(ticket: string, clubId: string): Promise<void> {
  if (!ticket || !clubId) throw new Error('This Gmail confirmation link is incomplete. Start a new connection from the app.');
  const body = await gmailRequest('confirm', { ticket }, clubId);
  if (body.connected !== true) throw new Error(API_UNAVAILABLE);
}

/** Base64url-decodes a Gmail message body part into a UTF-8 string. */
function decodeBody(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
  } catch {
    return atob(base64);
  }
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

/** Walks a message's MIME tree, preferring the plain-text part over HTML. */
function extractBodyText(payload: GmailMessagePart | undefined): string {
  if (!payload) return '';

  let plain: string | null = null;
  let html: string | null = null;

  const visit = (part: GmailMessagePart) => {
    if (part.mimeType === 'text/plain' && part.body?.data && plain === null) {
      plain = decodeBody(part.body.data);
    } else if (part.mimeType === 'text/html' && part.body?.data && html === null) {
      html = decodeBody(part.body.data);
    }
    part.parts?.forEach(visit);
  };
  visit(payload);

  if (plain !== null) return plain;
  if (html !== null) {
    // Strip tags and collapse whitespace so label/value pairs that are visually
    // adjacent in the rendered email (e.g. "Sent From:" / "CAI FANG WU") end up
    // adjacent in the extracted text too, the same shape the regexes below expect.
    return (html as string)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ');
  }
  return '';
}

/** Extracts an address from a bare email or `Name <email>` header value. */
function parseAddressHeader(value: string | undefined): { name: string; email: string | null } {
  if (!value) return { name: '', email: null };
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim(), email: match[2].trim().toLowerCase() };
  if (SENDER_EMAIL_PATTERN.test(value.trim())) return { name: '', email: value.trim().toLowerCase() };
  return { name: value.trim(), email: null };
}

/** Parses a `$1,234.56` (or `1234.56`) string into a number. */
function parseAmount(value: string): number {
  return parseFloat(value.replace(/[^0-9.]/g, ''));
}

/**
 * Parses one Interac e-Transfer autodeposit notification email. The subject line
 * is the most reliable source ("Interac e-Transfer: You've received $200.00 from
 * CAI FANG WU and it has been automatically deposited."); the body's "Sent From" /
 * "Amount" fields are used as a fallback/cross-check, along with the memo the
 * sender attached and the transfer's reference number, both display-only. Returns
 * null if this doesn't look like an autodeposit email (e.g. a manual-deposit
 * e-Transfer that still requires answering a security question).
 */
export function parseEtransferMessage(message: {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[]; mimeType?: string; body?: { data?: string }; parts?: GmailMessagePart[] };
}): ParsedEtransferEmail | null {
  const headers = message.payload?.headers ?? [];
  const header = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

  const subject = header('Subject') ?? '';
  const subjectMatch = subject.match(
    /(?:(?:fw|re|fwd):\s*)*(?:Interac e-Transfer:\s*You've\s+)?received\s+\$([\d,]+\.\d{2})\s+from\s+(.+?)\s+and it has been automatically deposited/i
  );
  if (!subjectMatch) return null; // not an autodeposit notification — skip it

  // The rendered email lays these fields out as label/value pairs in a fixed
  // order (Message, Date, Reference Number, Sent From, Amount); after stripping
  // HTML tags that order collapses into plain text with just whitespace between
  // label and value, so each value is captured up to whichever known label comes
  // next rather than a generic delimiter (some memos legitimately contain colons).
  const NEXT_LABEL = '(?=\\s*(?:Date:|Reference Number:|Sent From:|Amount:|Message:))';
  const bodyText = extractBodyText(message.payload as GmailMessagePart | undefined);
  const bodySentFrom = bodyText.match(new RegExp(`Sent From:?\\s*([\\s\\S]+?)${NEXT_LABEL}`, 'i'))?.[1]?.trim();
  const bodyAmount = bodyText.match(/Amount:?\s*\$([\d,]+\.\d{2})/i)?.[1];
  const referenceNumber = bodyText.match(new RegExp(`Reference Number:?\\s*([\\s\\S]+?)${NEXT_LABEL}`, 'i'))?.[1]?.trim() ?? null;
  const memo = bodyText.match(new RegExp(`Message:?\\s*([\\s\\S]+?)${NEXT_LABEL}`, 'i'))?.[1]?.trim() || null;

  const fromHeader = parseAddressHeader(header('From'));
  const replyTo = parseAddressHeader(header('Reply-To'));
  const isForwarded = /^\s*(?:fw|fwd|re):/i.test(subject)
    || fromHeader.email !== DEFAULT_ETRANSFER_SENDER_ADDRESS;
  // Outer headers on a forwarded message identify the forwarder, not the payer.
  // Even a distinct Reply-To could belong to another forwarder in the chain.
  const senderEmail = !isForwarded && replyTo.email !== fromHeader.email
    ? replyTo.email
    : null;

  // Subject wins over the body's "Sent From"/"Amount" fields — the body is
  // scanned for those labels anywhere in the decoded text, and the sender's own
  // free-text "Message" memo appears earlier in the body than the real labels,
  // so a memo containing literal text like "Sent From: X" or "Amount: $9.99"
  // would otherwise be mistaken for the real field and silently override the
  // subject line's authoritative (Interac-generated, not sender-controlled)
  // amount/name. The body values are kept only as a fallback for the — under
  // the current subject regex, unreachable — case where the subject somehow
  // didn't capture them.
  const senderName = (subjectMatch[2] || bodySentFrom || fromHeader.name).trim();
  const amount = parseAmount(subjectMatch[1] || bodyAmount || '');
  const emailDate = header('Date') ? new Date(header('Date') as string)
    : message.internalDate ? new Date(Number(message.internalDate))
    : new Date();

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    subject,
    senderName,
    senderEmail,
    amount,
    memo,
    referenceNumber,
    emailDate,
  };
}

function gmailAfterEpochSeconds(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error('Enter a valid e-Transfer search date.');
  const [, year, month, day] = match.map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error('Enter a valid e-Transfer search date.');
  }
  return Math.floor(timestamp / 1000);
}

/** The backend applies the saved club sender allowlist; recheck From here as defense in depth. */
export async function searchEtransferEmails(
  senderAddress: string | string[],
  searchAfterDate: string = getDefaultEtransferSearchAfterDate(),
  customGmailQuery?: string | null
): Promise<ParsedEtransferEmail[]> {
  return serviceCall('searchEtransferEmails', async () => {
    const addresses = normalizeEtransferSenderAddresses(senderAddress);
    if (!customGmailQuery?.trim()) gmailAfterEpochSeconds(searchAfterDate);
    const body = await gmailRequest('search', { searchAfterDate, customGmailQuery: customGmailQuery?.trim() || '' });
    if (!Array.isArray(body.messages)) throw new Error(API_UNAVAILABLE);
    const fullMessages = body.messages as Parameters<typeof parseEtransferMessage>[0][];

    return fullMessages
      .filter((message) => {
        // Gmail search syntax is not a trust boundary. Check the actual From
        // mailbox too; Reply-To identifies the payer, not the notification sender.
        const headers = message.payload?.headers?.filter((h) => h.name.toLowerCase() === 'from') ?? [];
        if (headers.length !== 1) return false;
        const value = headers[0].value.trim();
        const namedMailbox = value.match(/^(?:"[^"\r\n]*"|[^"<>,@\r\n]*)\s*<([^<>\r\n]+)>$/)?.[1]?.trim().toLowerCase();
        const mailbox = SENDER_EMAIL_PATTERN.test(value)
          ? value.toLowerCase()
          : namedMailbox;
        return !!mailbox && SENDER_EMAIL_PATTERN.test(mailbox) && addresses.includes(mailbox);
      })
      .map(parseEtransferMessage)
      .filter((e): e is ParsedEtransferEmail => e !== null);
  });
}
