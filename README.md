# Badminton Ledger

A web app for running a casual badminton club: schedule sessions, track who showed up, split
court/shuttlecock costs, and keep everyone's balance straight — without a spreadsheet.

Built for a real weekly club, running on Firebase (Auth + Firestore + Hosting).

## Features

- **Sessions & attendance** — a calendar for scheduling sessions, marking who attended, and
  splitting costs across players (including waitlist/paste-from-text roster entry).
- **Player ledger & payouts** — per-player balances, a prepaid wallet, e-Transfer vs.
  balance-only views, custom transactions, and a sortable/filterable/paginated payout ledger
  with running totals and full timestamps.
- **Inventory tracking** — shuttlecock ("birdie") batches and court-time credits, purchased in
  batches and consumed per session, with usage history and charts.
- **Multi-club support** — a user can belong to multiple clubs and switch between them; new
  clubs can be created or joined via a shareable link/id.
- **Roles** — admins manage players, inventory, payouts, and settings; members get a
  self-serve attendance/balance view and can request profile changes or to be linked to a
  player for an admin to approve (no direct write access to sensitive data).
- **Auth** — Google sign-in, or email + password sign-up (with a non-blocking email
  verification reminder).
- **Google Drive backup/restore** — admins can export/import all club data to their own
  Google Drive, reusing the same Google sign-in (no separate credentials to set up).

## Tech stack

- [React 19](https://react.dev/) + TypeScript, bootstrapped with [Create React App](https://github.com/facebook/create-react-app)
- [Redux Toolkit](https://redux-toolkit.js.org/) for client state
- [React Router 7](https://reactrouter.com/) for routing
- [React-Bootstrap](https://react-bootstrap.netlify.app/) for UI components
- [Firebase](https://firebase.google.com/): Authentication, Firestore, Hosting
- [Jest](https://jestjs.io/) + [React Testing Library](https://testing-library.com/react) for
  automated tests, run against an in-repo in-memory fake of Firestore/Auth (see
  [`ui/src/test-utils`](ui/src/test-utils)) rather than a real project or the emulator suite

## Project structure

```
.
├── firestore.rules        # Firestore security rules (deployed separately from Hosting — see below)
├── firebase.json          # Firebase project config (Hosting + Firestore rules paths)
├── .firebaserc            # Firebase project aliases (default / prod)
├── .github/workflows/     # CI: PR preview deploys + live deploy on push to main
└── ui/                    # The React app (everything else lives here)
    └── src/
        ├── Pages/         # Top-level routed pages (Home, Attendance, Players, Payout, ...)
        ├── components/    # Shared/reusable components (calendar, modals, nav bar, ...)
        ├── services/firebase/  # Firestore/Auth access — all reads/writes go through here
        ├── features/      # Redux Toolkit slices (club, players, session modal, ...)
        ├── types/         # Shared TypeScript types
        └── test-utils/    # Fake Firestore/Auth used by the test suite
```

## Getting started

### Prerequisites

- Node.js 20+
- A [Firebase project](https://console.firebase.google.com/) with **Authentication**
  (Google, and optionally Email/Password) and **Firestore** enabled

### Setup

```bash
cd ui
npm install
```

Create `ui/.env` with your Firebase web app config:

```
REACT_APP_FIREBASE_API_KEY=
REACT_APP_FIREBASE_AUTH_DOMAIN=
REACT_APP_FIREBASE_PROJECT_ID=
REACT_APP_FIREBASE_STORAGE_BUCKET=
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=
REACT_APP_FIREBASE_APP_ID=
REACT_APP_FIREBASE_MEASUREMENT_ID=
```

Deploy the Firestore security rules to your project (this is **not** part of the GitHub Actions
deploys below — it has to be run manually whenever `firestore.rules` changes):

```bash
firebase deploy --only firestore:rules
```

### Running locally

```bash
cd ui
npm start        # dev server at http://localhost:3000
npm test         # run the test suite
npm run build    # production build
```

## Deployment

Two GitHub Actions workflows handle Hosting deploys only (Firestore rules are always deployed
manually, as above):

- `firebase-hosting-pr.yml` — builds and deploys a preview channel for every pull request
- `firebase-hosting-live.yml` — builds and deploys to the live site on every push to `main`

## License

[MIT](LICENSE)
