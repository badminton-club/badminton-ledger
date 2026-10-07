import React, { useState } from 'react';
import { Accordion, Alert, Button, Container, Form, Spinner } from 'react-bootstrap';
import { auth } from '../services/firebase/client';
import { submitSuggestion } from '../services/firebase';
import { useAppSelector } from '../hooks';
import { selectCurrentClubId } from '../features/club/clubSlice';

// A plain-language, one-pager explanation of the terms and concepts used
// throughout the ledger (sessions, balances, settlement methods, etc.) for
// members who aren't familiar with how the club's bookkeeping works.
const FAQ_SECTIONS: { question: string; answer: React.ReactNode }[] = [
  {
    question: 'What is a "session"?',
    answer: (
      <p className="mb-0">
        A session is one day of play. It records who showed up, how the court and birdie
        costs are split between them, and how each person settled (or still owes) their
        share.
      </p>
    ),
  },
  {
    question: 'What does "Balance" mean?',
    answer: (
      <p className="mb-0">
        Your balance is money you've prepaid to the club that's held on account, like a
        gift-card balance. A <strong>positive</strong> balance is prepaid credit you can
        draw from to cover future sessions. A <strong>negative</strong> balance ("overdrawn")
        means you owe the club money from your balance going below zero — it's still
        tracked the same way and gets settled the same way a positive balance would.
      </p>
    ),
  },
  {
    question: 'What does "Owed" mean, and how is it different from a negative balance?',
    answer: (
      <p className="mb-0">
        "Owed" is the total cost of sessions you haven't settled yet (shown as <strong>Unpaid</strong> on
        that session). It's separate from your balance — your balance only changes when you
        actually pay in, or when a session cost is drawn from it. Owed just adds up until you
        settle those sessions by one of the methods below.
      </p>
    ),
  },
  {
    question: 'What are the different ways a session can be "paid"?',
    answer: (
      <div>
        <p>Every player's share of a session settles one of these ways:</p>
        <ul className="mb-0">
          <li><strong>e-Transfer</strong> — you paid the club directly (by e-Transfer, cash, etc.). This counts toward what the club owner is owed in the next payout.</li>
          <li><strong>Balance</strong> — the cost was drawn from your own prepaid balance instead of a separate payment.</li>
          <li><strong>Paid by (Transfer)</strong> — another player covered your cost from <em>their</em> balance (see "Default payer" below). It's drawn from their balance, not yours.</li>
          <li><strong>Comp</strong> — the club owner is settling this directly and it's excluded from payout accounting (e.g. the owner is waiving the cost, or handling it outside the ledger). See "What does Comp mean?" below.</li>
          <li><strong>Unpaid</strong> — none of the above yet; the cost still shows up in your "Owed" total.</li>
        </ul>
      </div>
    ),
  },
  {
    question: 'One player actually sent an e-Transfer covering someone else\'s cost too — how do I record that?',
    answer: (
      <div>
        <p>
          <strong>Paid by (Transfer)</strong> only ever moves cost between two players'
          balances — it's <em>not</em> a record of a real payment coming into the club. If
          player A actually sends real money (e.g. by e-Transfer) that covers both their own
          cost and player B's cost, there are two ways to record it:
        </p>
        <ul className="mb-0">
          <li>
            Mark <strong>both</strong> A's and B's session cost as <strong>e-Transfer</strong>
            {' '}individually. This is the simplest option and has no balance side-effects —
            it just records that both costs were settled by an incoming payment.
          </li>
          <li>
            Mark B's cost as <strong>Paid by</strong> A instead. This draws B's cost out of
            A's balance, which will leave A with a <strong>negative (overdrawn) balance</strong>
            {' '}for that amount, since A hasn't actually banked that money yet. To fix that, go
            to A's player page and add a <strong>manual e-Transfer</strong> entry for the
            amount A really sent — that settles the negative balance it just created.
          </li>
        </ul>
      </div>
    ),
  },
  {
    question: 'What does "Comp" mean?',
    answer: (
      <p className="mb-0">
        "Comp" is short for <strong>complimentary</strong> — the club owner has settled this
        player's cost directly (for example, waiving a guest's fee, or handling payment
        outside the app). A comped cost doesn't draw from anyone's balance and is excluded
        from the owner payout totals, since the owner already accounted for it another way.
      </p>
    ),
  },
  {
    question: 'What is a "Guest" / "non-regular player"?',
    answer: (
      <p className="mb-0">
        A guest is someone who's attended a session but isn't a regular club member. Their
        balance and session history are tracked exactly like everyone else's, but they're
        hidden from the main Players list (shown instead in a separate "Guests" section) and
        can't be picked as anyone's default payer. An admin can mark/unmark anyone as a guest
        at any time from the Players tab.
      </p>
    ),
  },
  {
    question: 'What is "Default payer"?',
    answer: (
      <p className="mb-0">
        A player can be configured so that, every time they're added to a <em>new</em> session,
        their cost automatically starts out as covered ("Paid by") from another specific
        player's balance — useful for a couple or parent/child who always pay together. It
        only applies to brand-new sessions and can always be changed afterward for that
        particular session.
      </p>
    ),
  },
  {
    question: 'What is "Default comped"?',
    answer: (
      <p className="mb-0">
        Similar to Default payer, but instead the player automatically starts each new
        session marked as <strong>Comp</strong> (settled directly with the club owner). A
        player can have a default payer <em>or</em> default comped, not both.
      </p>
    ),
  },
  {
    question: 'What are "Birdies" and "Court Credits"?',
    answer: (
      <p className="mb-0">
        These are the club's shared inventory. A <strong>Birdie batch</strong> is a purchase
        of shuttlecocks (tubes), and a <strong>Court Credit batch</strong> is a block of
        prepaid court hours. Every session draws from these batches to cover its birdie and
        court costs — the cost is split among that session's players rather than billed
        separately. Admins can see purchase/usage history and delete a batch (and its
        history) from the Birdies/Credits tabs.
      </p>
    ),
  },
  {
    question: 'What\'s the little 💳 badge on the calendar?',
    answer: (
      <p className="mb-0">
        It marks a day a Court Credit batch was purchased/added, along with how many hours
        were added, so you can see at a glance when the club topped up its court hours
        without having to open the Credits tab.
      </p>
    ),
  },
  {
    question: 'What is the "Payout" page?',
    answer: (
      <p className="mb-0">
        It's a summary of how much is owed to the club from e-Transfer/unpaid settlements
        (excluding anything settled via Balance, Transfer, or Comp, since those don't involve
        new money coming in), so whoever is collecting those funds can track what they're
        still owed and record when they've been paid out. This isn't only for the club
        owner — enable the Payout tab (Settings) whenever a manager or anyone else is
        collecting dues on the owner's behalf, so they can track it too.
      </p>
    ),
  },
  {
    question: 'What is "Attendance"?',
    answer: (
      <p className="mb-0">
        A simple view of who showed up to recent sessions — useful for tracking participation
        over time, separate from the financial/settlement details shown elsewhere.
      </p>
    ),
  },
  {
    question: 'What does an "overdrawn" balance mean, and is that allowed?',
    answer: (
      <p className="mb-0">
        Yes — a balance going negative (overdrawn) is allowed. It simply means that player
        (or whoever is covering their dues as a payer) now owes the club money, tracked the
        same way a positive balance is. Admins are warned before an action would cause this,
        but can choose to proceed.
      </p>
    ),
  },
];

export default function FaqPage() {
  const clubId = useAppSelector(selectCurrentClubId);
  const [testerEmail, setTesterEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const validTesterEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testerEmail.trim());
  const testerRequestHref = validTesterEmail
    ? `mailto:wedclub2026@gmail.com?subject=${encodeURIComponent('Badminton Ledger e-Transfer tester access request')}`
      + `&body=${encodeURIComponent(
        `Hello,\n\nPlease add ${testerEmail.trim()} to the Google OAuth tester list for Badminton Ledger e-Transfer imports.\n\n`
        + 'I understand that this feature currently supports Canadian Interac e-Transfer autodeposit notifications.\n\nThank you.'
      )}`
    : undefined;

  const handleSubmit = async () => {
    if (!clubId) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setError('');
    setSubmitting(true);
    try {
      const name = auth.currentUser?.displayName || auth.currentUser?.email || 'A member';
      await submitSuggestion(clubId, uid, name, message);
      setMessage('');
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit suggestion.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container className="py-4" style={{ maxWidth: 820 }}>
      <h2 className="mb-2">Help &amp; FAQ</h2>
      <p className="text-muted mb-4">
        A quick explanation of the terms and concepts used throughout the ledger.
      </p>
      <Accordion alwaysOpen={false}>
        <Accordion.Item eventKey="etransfer-access">
          <Accordion.Header>How do I get access to Gmail e-Transfer imports?</Accordion.Header>
          <Accordion.Body>
            <Alert variant="info">
              Gmail e-Transfer imports are currently supported only for Canadian Interac
              e-Transfer autodeposit notifications.
            </Alert>
            <p>Before using the e-Transfers tab for the first time:</p>
            <ol>
              <li>
                Choose the Google/Gmail account that receives your e-Transfer notification emails.
              </li>
              <li>
                Request tester access for that email address and wait for confirmation that the
                account has been approved.
              </li>
              <li>
                As a club admin, configure the Gmail import options under
                {' '}<strong>Settings → e-Transfer import defaults</strong>.
              </li>
              <li>
                Open the <strong>e-Transfers</strong> tab, select the approved Google account when
                connecting to Gmail, and review the imported payments.
              </li>
            </ol>
            <div className="bg-light rounded p-3">
              <Form.Group controlId="etransfer-tester-email">
                <Form.Label>Google/Gmail email to approve</Form.Label>
                <Form.Control
                  type="email"
                  value={testerEmail}
                  placeholder="your-email@gmail.com"
                  onChange={(e) => setTesterEmail(e.target.value)}
                  isInvalid={testerEmail.length > 0 && !validTesterEmail}
                />
                <Form.Control.Feedback type="invalid">
                  Enter a valid email address.
                </Form.Control.Feedback>
                <Form.Text>
                  This opens a prefilled message to wedclub2026@gmail.com in your email app.
                  Review and send it to request approval.
                </Form.Text>
              </Form.Group>
              <Button
                as="a"
                className={`mt-2${validTesterEmail ? '' : ' disabled'}`}
                href={testerRequestHref ?? '#'}
                aria-disabled={!validTesterEmail}
                tabIndex={validTesterEmail ? 0 : -1}
                onClick={(e) => {
                  if (!validTesterEmail) e.preventDefault();
                }}
              >
                Open access request email
              </Button>
            </div>
          </Accordion.Body>
        </Accordion.Item>
        {FAQ_SECTIONS.map((section, i) => (
          <Accordion.Item eventKey={String(i)} key={section.question}>
            <Accordion.Header>{section.question}</Accordion.Header>
            <Accordion.Body>{section.answer}</Accordion.Body>
          </Accordion.Item>
        ))}
      </Accordion>

      <h3 className="mt-5 mb-2">Have a suggestion?</h3>
      <p className="text-muted mb-3">
        Missing something, found something confusing, or have an idea for the club's ledger?
        Let us know below — only club admins can see what's submitted here.
      </p>
      <Form.Group controlId="faq-suggestion-message" className="mb-2">
        <Form.Control
          as="textarea"
          rows={3}
          placeholder="What would you like to suggest?"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setSent(false);
            setError('');
          }}
          disabled={submitting}
        />
      </Form.Group>
      <Button onClick={handleSubmit} disabled={submitting || !message.trim()}>
        {submitting ? <Spinner size="sm" animation="border" /> : 'Submit suggestion'}
      </Button>
      {sent && <Alert variant="success" className="mt-2 mb-0 py-2">Thanks — your suggestion was submitted.</Alert>}
      {error && <Alert variant="danger" className="mt-2 mb-0 py-2">{error}</Alert>}
    </Container>
  );
}
