import React from 'react';
import { Accordion, Container } from 'react-bootstrap';

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
        It's an owner-facing summary of how much is owed to the club from e-Transfer/unpaid
        settlements (excluding anything settled via Balance, Transfer, or Comp, since those
        don't involve new money coming in), so the owner can track what they're still owed
        and record when they've been paid out.
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
  return (
    <Container className="py-4" style={{ maxWidth: 820 }}>
      <h2 className="mb-2">Help &amp; FAQ</h2>
      <p className="text-muted mb-4">
        A quick explanation of the terms and concepts used throughout the ledger.
      </p>
      <Accordion alwaysOpen={false}>
        {FAQ_SECTIONS.map((section, i) => (
          <Accordion.Item eventKey={String(i)} key={section.question}>
            <Accordion.Header>{section.question}</Accordion.Header>
            <Accordion.Body>{section.answer}</Accordion.Body>
          </Accordion.Item>
        ))}
      </Accordion>
    </Container>
  );
}
