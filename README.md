# Badminton Ledger

A web app for running a casual badminton club: schedule sessions, track who showed up, split
court/shuttlecock costs, and keep everyone's balance straight — without a spreadsheet.

Built for a real weekly club, running on Firebase (Auth + Firestore + Hosting).

## Features

- **Sessions & attendance** — a calendar for scheduling sessions, marking who attended, and
  splitting costs across players (including waitlist/paste-from-text roster entry).
  The session detail view remembers your Compact/Comfy choice in the same browser across
  session reopenings and future visits.
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
- **Gmail e-Transfer import** — admins can search Gmail for Interac e-Transfer autodeposit
  notifications, review the suggested player match and amount, then apply to credit a
  player's balance. Every import is recorded and undoable; processed Gmail message IDs
  are deduplicated in Firestore without changing the mailbox.
  This feature is currently supported only for Canadian Interac e-Transfer autodeposit
  notifications. Before first use, submit the Google account email that receives these
  notifications to the Badminton Ledger administrator; it must be approved on the Google
  OAuth tester list before it can connect to Gmail. Help & FAQ includes a field that opens
  a prefilled tester-access request addressed to `wedclub2026@gmail.com`.
  Forward/reply subject prefixes (`FW:`, `RE:`, `FWD:`, case-insensitive) are supported.
  Admins manage allowed sender addresses in Settings (default:
  `notify@payments.interac.ca`), adding trusted forwarding addresses as needed.
  Forwarding addresses are only used for the From allowlist, never as payer identities.
  Forwarded/replied messages (or messages from a nonstandard From address) ignore outer
  Reply-To headers and use the payer name from the subject. Name-only suggestions and
  ambiguous matches wait for admin review, even when the amount equals the player's debt.
  Select the player and use Remember to save a name mapping; future transfers with that
  confirmed mapping can auto-settle exact unpaid debt when session records reconcile.
  Original Interac messages retain distinct payer Reply-To matching and existing email mappings.
  The e-Transfer page initializes its search window and ignore-amount limit from Settings,
  then lets admins adjust either value for the current visit without changing the saved defaults.
  Auto-settlement of confidently matched exact amounts has a saved club default in Settings
  (enabled when unset) and can still be changed per visit so all newly imported payments remain
  pending for review when desired.
  Gmail search options and saved defaults are configured in Settings.
  A custom Gmail query configured in Settings such as `subject:"automatically deposited"` replaces only
  default subject and date filters; include `after:YYYY/MM/DD` to limit dates,
  or clear the query to restore the default search. Allowed From mailboxes are
  always checked, even with custom queries; this is not cryptographic sender verification. See
  [Gmail search syntax](https://support.google.com/mail/answer/7190).
  Gmail authorization is server-backed: complete Google consent in the browser,
  sign into the same app account there if needed, and explicitly confirm the connection.
  Then return to the Home Screen app and explicitly search. No Safari cookies, browser storage,
  or credentials need to be copied into the installed app. Connections belong to the
  signed-in administrator and club, so another administrator connects their own inbox.
  Authorization and connection-status checks never import or apply payments.
  See [Gmail backend setup](#gmail-backend-setup) before deploying this feature.

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

Two GitHub Actions workflows deploy Hosting and the matching Firestore rules:

- `firebase-hosting-pr.yml` — validates and deploys rules to the development project, then
  builds and deploys a preview channel for every pull request
- `firebase-hosting-live.yml` — deploys rules and the live site on every push to `main`

### Gmail backend setup

Gmail now requires the `gmailApi` Cloud Function (Node.js 22) and a Blaze-enabled
Firebase project. The production workflow deploys Functions before Hosting;
development Functions deploy automatically after trusted PR previews, or through
a separate explicit deployment workflow. Neither creates
Gmail secrets. Complete the backend setup below before deploying the UI/preview;
otherwise `/api/gmail/*` requests will not work. Repeat setup separately for
`badminton-ledger` (development) and `badminton-ledger-prod` (production).

1. In the matching Google Cloud project, enable the **Gmail API**. Configure the
   Google OAuth consent screen with the read-only scope
   `https://www.googleapis.com/auth/gmail.readonly` and add the inbox account as a
   test user if the app is in Testing. Gmail is a restricted scope: production use
   may require Google verification and, when server-side access is involved, a
   security assessment depending on Google's applicable exemptions. Testing-mode
   refresh tokens may expire after seven days; reconnecting is then expected.
2. Create a **Web application** OAuth client dedicated to Gmail. Keep existing
   Firebase sign-in clients and redirect URIs unchanged. Add these **Authorized
   redirect URIs** to the respective clients:
   - Development: `https://badminton-ledger.web.app/api/gmail/callback`
   - Production: `https://badminton-ledger-prod.web.app/api/gmail/callback`

   These stable callbacks are independent of temporary preview URLs. The app's
   Firebase login still needs its normal authorized domains; changing
   `REACT_APP_FIREBASE_AUTH_DOMAIN` to a PR hostname is no longer necessary for
   Gmail. Restore the normal project login domain if it was temporarily changed.
3. From the repository root, install the backend's locked dependencies with
   `npm --prefix functions ci`. Using your Firebase CLI, set the following
   secrets interactively for each project (never put their values in frontend
   environment variables, GitHub comments, or committed files):

   ```bash
   firebase functions:secrets:set GMAIL_OAUTH_CLIENT_ID --project badminton-ledger
   firebase functions:secrets:set GMAIL_OAUTH_CLIENT_SECRET --project badminton-ledger
   firebase functions:secrets:set GMAIL_TOKEN_ENCRYPTION_KEY --project badminton-ledger
   ```

   Supply the dedicated OAuth client's ID and secret. For the encryption secret,
   generate a random 32-byte base64 key, for example with `openssl rand -base64 32`,
   and store it securely. Use a separate key for production. Changing this key
   makes previously stored credentials unreadable; disconnect/reconnect those
   accounts as part of a deliberate rotation.
4. Before deploying, create the ignored local configuration file
   `functions/.env.badminton-ledger`:

   ```dotenv
   GMAIL_OAUTH_REDIRECT_URI=https://badminton-ledger.web.app/api/gmail/callback
   GMAIL_ALLOWED_ORIGINS=https://badminton-ledger.web.app,https://badminton-ledger--pr35-copilot-fix-e-transf-0vydcc9e.web.app
   ```

   Check the current preview origin in the PR deployment comment and replace it
   above if different. These values are not secrets. For production create
   `functions/.env.badminton-ledger-prod` with the production callback and only
   trusted production origins. The Function defaults to the project's stable
   `web.app` origin/callback when overrides are absent; preview origins must be
   added explicitly. Then deploy:

   ```bash
   firebase deploy --only functions:gmail --project badminton-ledger
   ```

   Allowed origins are exact HTTPS origins without trailing slashes. Include
   PR #35's origin only while it is in use; update the allowlist and redeploy
   for later previews. Keep `functions/.env.<project>` as local deployment
   configuration, not something to commit. Restrict origins to trusted deployments.
   Allow Firebase to provision the required Functions/Secret Manager services and
   permissions; do not grant the deployment account access to unrelated projects.
   In Firestore's **Time-to-live** settings, enable TTL on the `expiresAt` field
   for collection group `gmailOAuthStates` to clean up abandoned authorization
   requests. The backend enforces expiration itself; TTL is only cleanup.
5. Deploy the stable callback route and private Firestore rules:

   ```bash
   firebase deploy --only hosting,firestore:rules --project badminton-ledger
   ```

   This command publishes the current `ui/build` to the development **live** site.
   Build the intended UI first with development Firebase configuration, and confirm
   that publishing to that site is appropriate. The stable live site's Hosting
   configuration must include `/api/gmail/**` and the new account-confirmation UI
   even when you test a PR preview.
   Then rerun the PR preview deployment. Repeat the setup with the production
   client, secrets, callback, and origins using `--project badminton-ledger-prod`
      before releasing to production.

   #### Deploying the Gmail backend with GitHub Actions

   Use Actions if local dependency installation is unavailable. Once configured,
   [the production workflow](.github/workflows/firebase-hosting-live.yml) tests and
   deploys Gmail before publishing Hosting on every push to `main`.
   [Deploy Gmail backend (development)](.github/workflows/firebase-functions-dev.yml)
   also supports explicit deployments of the shared development backend. Trusted,
   same-repository PR previews automatically register their exact deployed origin
   and deploy the Gmail backend after preview Hosting succeeds. They then publish
   the same development UI build to the stable `badminton-ledger.web.app` site so
   the OAuth callback has the current confirmation page and API rewrite. Fork PRs
   remain excluded. Production Hosting is not changed by this workflow.

   1. Create the three Gmail secrets from step 3 in **each project's** Google Cloud
      Secret Manager. The console's **Create secret** action is an alternative to the
      CLI. Use separate OAuth clients and encryption keys for development and production.
      Keep the secrets out of GitHub and frontend configuration.
   2. In GitHub, open **Settings > Secrets and variables > Actions > Variables**
      and create these **repository variables**:

      | Variable | Value |
      | --- | --- |
      | `GMAIL_OAUTH_REDIRECT_URI` | `https://badminton-ledger.web.app/api/gmail/callback` |
      | `GMAIL_ALLOWED_ORIGINS` | `https://badminton-ledger.web.app` |
      | `PROD_GMAIL_OAUTH_REDIRECT_URI` | `https://badminton-ledger-prod.web.app/api/gmail/callback` |
      | `PROD_GMAIL_ALLOWED_ORIGINS` | `https://badminton-ledger-prod.web.app` |

      Keep the development variable as the trusted base-origin list; PR preview
      URLs are registered automatically, without wildcards or GitHub variable writes.
      Append trusted custom-domain origins as needed, comma-separated, with no
      trailing slashes. Changes take effect on the next backend deployment.
      The workflows create the ignored backend environment files on the runner; local
      environment files are not uploaded to GitHub.
      Before each development deployment, the configuration script reads the current
      function configuration and Hosting channels. It retains previously registered
      previews only while their channels exist and have not expired, then adds the
      current preview's exact URL returned by the Hosting action. Other channels are
      not automatically trusted. Base origins remain explicitly trusted. Expired
      previews are pruned on the next deployment, not by a scheduled job.
   3. The workflows reuse the existing `FIREBASE_SERVICE_ACCOUNT` and
      `PROD_FIREBASE_SERVICE_ACCOUNT` GitHub secrets. In each matching Google Cloud
      project, an administrator must prepare the deployment identity:
      - Enable Cloud Functions, Cloud Build, Artifact Registry, Cloud Run Admin, and
        Secret Manager APIs, and ensure Firebase's Blaze billing is enabled.
      - Retain the existing Hosting/Firestore deployment permissions. Grant the
        deployment service account **Cloud Functions Admin**, **Cloud Run Admin**,
        and **Service Usage Consumer** in that project.
      - Grant it **Service Account User** on the function's runtime and build service
        accounts, not unrelated service accounts. The default Gen 2 runtime account
        is usually `PROJECT_NUMBER-compute@developer.gserviceaccount.com`; confirm
        the build identity in Cloud Build settings.
      - On each of the three Gmail secrets, grant the deployment identity
        **Secret Manager Viewer** and the runtime identity **Secret Manager Secret
        Accessor**. Pre-grant runtime access so CI does not need to change secret IAM.
      - Ensure the runtime identity has **Cloud Datastore User** and **Firebase
        Authentication Viewer** for Firestore access and revoked-token checks.
        Ensure the configured build identity has the permissions required by
        [Cloud Run functions builds](https://cloud.google.com/functions/docs/building).
      - If deployment reports a missing permission, use the named identity and
        resource in the error to resolve it; do not grant Owner or Editor as a shortcut.
   4. Push a trusted same-repository PR containing the workflows to build its preview,
      register the preview URL, and deploy the development Gmail backend automatically.
      These deployments replace the shared development backend for all previews;
      they also replace the stable development website with the trusted PR's build.
      The build rejects non-development Firebase project/auth-domain settings to
      prevent the stable callback from attempting production sign-in.
      Deployments are serialized with manual development deployments to avoid conflicting
      allowlist updates. Preview, backend, and stable callback website deployments
      must all finish successfully before testing Gmail.
      For a backend-only redeployment before merging, apply the `deploy-gmail-dev`
      repository label to the trusted PR. Remove and reapply it to deploy again,
      or rerun the desired workflow run.
      Once the workflow reaches the default branch, you can also use **Actions >
      Deploy Gmail backend (development) > Run workflow**, selecting the trusted
      branch containing the intended version. Explicit deployments preserve active,
      previously registered preview origins. Production deployment runs automatically
      when changes reach `main`, so prepare both projects and all four variables
      before merging.

   The manual workflow does **not** publish the development live website or Firestore
   rules. Run the full PR workflow (or complete step 5 above) for the stable callback
   and confirmation page, and enable the OAuth-state TTL described in step 4.
   If first deployment requests an Artifact Registry cleanup policy, a project
   administrator can configure it with
   `firebase functions:artifacts:setpolicy --location us-central1 --project PROJECT_ID`
   from an approved CLI environment before rerunning the workflow.

To test, launch the installed preview, connect Gmail, open its authorization link
in the browser, select the desired inbox, and finish consent. The callback opens
the stable site's account page. Sign into the **same Badminton Ledger account**
that started the connection (not necessarily the selected Gmail account), check
the destination club, and explicitly confirm the connection. This one-time app
sign-in in Safari prevents someone forwarding their link to attach your Gmail to
their app account. Only the callback browser receives the completion ticket;
the original app cannot discover it through connection status. Complete this step
promptly before the short-lived authorization expires, and do not share these links.
Then return to the Home Screen app. Check the connection or reopen the page and
explicitly search. Do not expect iOS to automatically reopen the installed app.
Closing/reopening it should retain the server connection when signed into the same
account and club, without repeating Google consent on each login. This does not
make iOS share the app's own login session with Safari. **Disconnect Gmail** removes
the stored credentials and attempts
Google revocation; reconnect if consent is revoked or expires.
Revoking a Google grant can also affect other connections using that same Google
account and OAuth client; those connections may need to reconnect.
Very large searches fail rather than importing partial results: narrow the search
window if it exceeds 20 Gmail result pages, the response-size limit, or the
48-second server search budget.

Access and refresh tokens are encrypted server-side and never returned to the UI.
Client Firestore rules deny access to `gmailConnections` and `gmailOAuthStates`;
keep Firestore backups and service-account access private too. Gmail endpoints
verify Firebase identity and current club-admin membership, independently enforce
saved sender restrictions, and cannot be used as an arbitrary Gmail proxy.
Disconnect retains a credential-free generation record in `gmailConnections`;
do not delete these records or enable TTL on that collection, because they block
older in-flight callbacks from restoring a disconnected connection.
Granting consent in Safari cannot sign the Home Screen app into a different club
account or automatically apply payments.

## License

[MIT](LICENSE)
