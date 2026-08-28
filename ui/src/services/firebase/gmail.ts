import { FirebaseError } from 'firebase/app';
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { auth } from './client';
import { serviceCall } from './utils';

// This app only supports Google sign-in, so every signed-in user already has a
// Google identity linked to their Firebase account. Re-authenticating with the
// Gmail scope added reuses that same Google OAuth client — same pattern as the
// Google Drive backup feature (see drive.ts) — no separate Google Cloud
// project/credentials need to be configured for this feature.
//
// `gmail.modify` (rather than the narrower `gmail.readonly`) is required because,
// beyond searching/reading messages, this feature also applies a "Processed"
// label so already-imported emails aren't found again on the next search. It
// does not grant permanent deletion or sending mail.
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const TOKEN_TTL_MS = 45 * 60 * 1000;
const PROCESSED_LABEL_NAME = 'Processed';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Scoped to the signed-in uid it was issued for — see the identical comment in
// drive.ts for why this matters in an SPA where the signed-in user can change
// without a page reload.
let cachedToken: { value: string; expiresAt: number; uid: string } | null = null;

/** The default sender address for Interac e-Transfer autodeposit notifications. */
export const DEFAULT_ETRANSFER_SENDER_ADDRESS = 'notify@payments.interac.ca';

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

/**
 * Re-authenticates the current user with the Gmail scope added and returns a
 * fresh OAuth access token, cached briefly so a search followed by several
 * "apply" actions (each of which labels a message) doesn't re-prompt for
 * every single request.
 */
async function getGmailAccessToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to connect Gmail.');

  if (cachedToken && cachedToken.uid === user.uid && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const provider = new GoogleAuthProvider();
  provider.addScope(GMAIL_SCOPE);
  provider.setCustomParameters({ prompt: 'consent' });

  let result;
  try {
    result = await reauthenticateWithPopup(user, provider);
  } catch (err) {
    if (err instanceof FirebaseError) {
      if (err.code === 'auth/user-mismatch') {
        throw new Error("Select the same Google account you're signed in with.");
      }
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        throw new Error('Gmail authorization was cancelled.');
      }
    }
    throw err;
  }

  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Failed to get Gmail access — please try again.');
  }
  cachedToken = { value: credential.accessToken, expiresAt: Date.now() + TOKEN_TTL_MS, uid: user.uid };
  return credential.accessToken;
}

async function gmailFetch<T>(accessToken: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gmail request failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

/** Finds the "Processed" label, creating it if it doesn't exist yet. Returns its id. */
async function getOrCreateProcessedLabelId(accessToken: string): Promise<string> {
  const { labels } = await gmailFetch<{ labels?: { id: string; name: string }[] }>(
    accessToken,
    `${GMAIL_API}/labels`
  );
  const existing = labels?.find((l) => l.name === PROCESSED_LABEL_NAME);
  if (existing) return existing.id;

  const created = await gmailFetch<{ id: string }>(accessToken, `${GMAIL_API}/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: PROCESSED_LABEL_NAME,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }),
  });
  return created.id;
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

/** Extracts the display name and (if present) email address from a `Name <email>` header value. */
function parseAddressHeader(value: string | undefined): { name: string; email: string | null } {
  if (!value) return { name: '', email: null };
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim(), email: match[2].trim().toLowerCase() };
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
    /received\s+\$([\d,]+\.\d{2})\s+from\s+(.+?)\s+and it has been automatically deposited/i
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

  const senderName = (bodySentFrom || subjectMatch[2] || fromHeader.name).trim();
  const amount = parseAmount(bodyAmount || subjectMatch[1]);
  const emailDate = header('Date') ? new Date(header('Date') as string)
    : message.internalDate ? new Date(Number(message.internalDate))
    : new Date();

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    subject,
    senderName,
    // Reply-To carries the e-Transfer sender's own email (distinct from the
    // notify@payments.interac.ca address every autodeposit email is *sent* from),
    // which is the stable identifier used for remembered sender→player mappings.
    senderEmail: replyTo.email,
    amount,
    memo,
    referenceNumber,
    emailDate,
  };
}

/**
 * Searches Gmail for Interac e-Transfer autodeposit notifications from the given
 * sender address that haven't already been labelled "Processed", and returns
 * them parsed. Nothing is written to Gmail by this call — labelling happens only
 * once an admin has reviewed and applied (or rejected) an import.
 */
export async function searchEtransferEmails(senderAddress: string): Promise<ParsedEtransferEmail[]> {
  return serviceCall('searchEtransferEmails', async () => {
    const accessToken = await getGmailAccessToken();
    const q = `from:${senderAddress} subject:"automatically deposited" -label:${PROCESSED_LABEL_NAME}`;
    const { messages } = await gmailFetch<{ messages?: { id: string; threadId: string }[] }>(
      accessToken,
      `${GMAIL_API}/messages?q=${encodeURIComponent(q)}&maxResults=100`
    );
    if (!messages?.length) return [];

    const fullMessages = await Promise.all(
      messages.map((m) => gmailFetch<Parameters<typeof parseEtransferMessage>[0]>(
        accessToken,
        `${GMAIL_API}/messages/${m.id}?format=full`
      ))
    );

    return fullMessages
      .map(parseEtransferMessage)
      .filter((e): e is ParsedEtransferEmail => e !== null);
  });
}

/** Applies the "Processed" label to a Gmail message so it's excluded from future searches. */
export async function labelEtransferEmailProcessed(gmailMessageId: string): Promise<void> {
  return serviceCall('labelEtransferEmailProcessed', async () => {
    const accessToken = await getGmailAccessToken();
    const labelId = await getOrCreateProcessedLabelId(accessToken);
    await gmailFetch(accessToken, `${GMAIL_API}/messages/${gmailMessageId}/modify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addLabelIds: [labelId] }),
    });
  });
}
