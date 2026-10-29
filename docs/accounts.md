# Accounts and guest game access

This milestone adds username/password registration, login, logout, optional verified email, and password recovery. It does not
add ratings, public game access, or public profiles.

## Ownership

Existing challenge seats, commands, receipts, and chat remain owned by their
original guest IDs. Migration `018_accounts.sql` adds accounts, expiring account
sessions, a nullable account owner on guest records, and durable authentication
rate counters. Earlier migrations and game records are unchanged.

Registration and login never claim guest games. The retroactive guest-linking action
and `POST /account/link-guest` have been removed. Games begun as a guest remain guest
owned even if that browser signs in mid-game; they do not enter its account archive.
The original browser guest cookie still permits guest play.

Historical guest-to-account relationships created before this change are preserved.
They continue to grant private game/chat access and archive visibility through the
existing ownership join. No historical records are rewritten. The `account_play_seat`
marker distinguishes authenticated play seats from these older linked browser seats;
a future rating system must establish eligibility from that distinction, not merely
from a non-null account owner. No ratings are implemented here.

### New authenticated games

Migration `020_account_play_seats.sql` adds a boolean marker and a partial unique
index for one internal play-seat identity per account. Creating or accepting a
new challenge while authenticated uses that identity as the original guest seat.
It has the same `account_id` relationship as explicitly linked browser guests, so
participant authorization, player names, chat, and chronological archive queries
share the existing ownership join. No historical challenges or receipts are rewritten.
The archive still lists games only after challenge acceptance creates a game.

The internal identity is allocated lazily under the account lock. Its random bearer
values are never issued as cookies, and guest authentication excludes these rows.
An authenticated account session, bound to a real browser guest session, is required
to use it. Login, logout and account switching do not change a browser's unlinked
guest games; those remain accessible only through that guest or historical linking.
An expired account session cannot access the account play seat. Never delete internal
play-seat identities as expired browser sessions: like explicitly linked guest rows,
they are durable game/receipt identities, not expiring ownership records.

Challenge creation retries are scoped to the account's play seat (and therefore work
across its browsers). Retrying an earlier creation with the same browser guest and
request ID returns the original guest challenge without linking it. Retrying acceptance
of an already occupied guest seat also leaves it unchanged. Account locks serialize
new seat allocation and acceptance; a single account cannot own both
seats, including historically linked seats. Session/CSRF state is rechecked after acquiring
locks so an already rotated request cannot occupy a new seat.

A fresh browser first receives its own guest session, then logs in normally.
The signed-in navigation opens the private **Account** page at `/account`. The server resolves
linked access back to the original guest seat for challenge reads, game commands,
SSE, and private participant chat. Receipt IDs and game versions are unchanged.
Knowing a link, logging in, or supplying another participant's identifiers grants
no access. There are no public account/game/chat endpoints.

Authorized game reads include each seat's account username, or null for
an unlinked seat. Player strips and private chat use this shared seat data rather
than the viewer's current account. Unlinked players appear as Guest, with their
side retained where needed. Username changes send a metadata refresh through the existing
game stream without incrementing the move version. Names are not stored in move
receipts or duplicated on chat messages. Imported PGN identities are unchanged.
The account dialog closes with its Close button or Escape, never a backdrop click.

Unlinked guest games remain available through the existing guest flow. Losing an unlinked guest cookie still
loses access; an expired guest session cannot be claimed later merely from a URL.
Linked guest records remain durable even after their bearer expires.

## Passwords and sessions

- Usernames are case-insensitive ASCII letters, digits and underscores, 3–24
  characters, stored in lowercase. Passwords are 15–128 characters, never trimmed.
- [`@node-rs/argon2`](https://github.com/napi-rs/node-rs/tree/main/packages/argon2)
  generates salted Argon2id hashes with 19 MiB memory, two passes and one lane,
  following the [OWASP minimum](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
  Unknown usernames use a dummy verification hash. Login errors are generic.
- Server-generated opaque 256-bit account tokens are stored only as SHA-256
  digests in PostgreSQL. They expire after 30 days and are bound to the current
  guest ID. Authentication uses no browser local-storage credentials or JWTs.
- Maintained `@fastify/cookie` serializes HttpOnly, SameSite=Lax, Path=/ cookies;
  production/non-loopback deployments use Secure cookies and must serve HTTPS.
  Login/registration rotate the guest token and CSRF token and replace the current
  account session. Account creation and session issuance commit atomically.
- All mutations, including login, registration and logout, require the
  existing synchronizer CSRF header. No cross-origin credentialed access is enabled.
  Switching to another account creates a separate guest bearer rather than carrying
  a previously linked identity into it.
- Logout deletes the current account session, rotates/replaces the guest bearer and
  invalidates a linked guest bearer. Other browsers' account sessions are unaffected.
  An unlinked guest keeps its own games after logout. The client reloads to clear
  previous seat/CSRF state and close streams. SSE rechecks authorization on its
  15-second heartbeat; an in-flight stream can receive version/message-ID notices
  until that check, but fetching any private data always requires current access.
- Login/registration attempts are limited in PostgreSQL to 30 per IP and 10 per
  normalized username in 15 minutes, across processes/restarts. Forwarded IP headers
  are not trusted. Review proxy/IP handling before deployment behind a proxy.
  Request bodies, cookies, authorization/CSRF and Set-Cookie headers are redacted
  in application logs. Do not enable SQL parameter or reverse-proxy body logging.

Use `npm run db:migrate` before deploying the server. Migration readiness checks
include the new session table. Periodically delete expired `account_sessions` and
`account_auth_limits` rows using their expiry indexes; do not delete linked guest
identities, which are referenced by challenges and receipt history. Monitor rate
limits and hash latency on the deployment hardware before raising traffic limits.

## Verified email and password recovery

Apply forward migration `021_account_email_recovery.sql` with `npm run db:migrate`.
Existing accounts start with no email and continue working. Registration remains
username/password only. Account Settings lets an authenticated user add or change
an address with their current password. Addresses are ASCII, normalized to lowercase
without provider-specific dot/alias transformations. One verified address can belong
to one account; pending addresses do not reserve ownership.

Recovery is enabled only after explicit confirmation of the emailed verification
link. Changing an address immediately removes the old verified address, invalidates
outstanding links, and pauses recovery until the replacement is verified. Resend
replaces the earlier verification token. The signed-out Forgot password link accepts
an email, not a username. Pending/absent addresses receive no reset email.

Tokens have 256 random bits; PostgreSQL stores only SHA-256 digests and the intended
address/purpose. Verification expires after 24 hours; reset expires after 30 minutes.
Consumption, password hashing, session revocation and token deletion commit atomically
under the account lock. Concurrent consumers cannot reuse a token. A reset uses the
existing Argon2id/password policy, requires matching confirmation, invalidates all
reset links and account sessions, and rotates associated guest bearer credentials.
Original seat IDs, linked ownership, games and chat remain intact. Normal login is
required afterward. As with a normal password change, browser-only games that were
never historically linked are not recoverable through an account.

Links use only configured PUBLIC_ORIGIN and a URL fragment, never a Host header or
query parameter. The browser removes the fragment from history before rendering and
sends the token only in a CSRF-protected POST. The page uses no-referrer metadata;
API responses are no-store. Serve the recovery HTML with Cache-Control: no-store and
Referrer-Policy: no-referrer in production too. Do not install analytics, third-party
scripts or request-body logging on recovery pages. Request URLs/bodies and credential
headers are redacted; mail failures log only their purpose, never transport exceptions,
recipients, passwords, tokens or links. Never enable SQL parameter logging.

All reset-request responses are identical for valid-form requests, including unknown,
pending, throttled and unconfigured addresses. SMTP delivery runs independently of
the response; its latency does not hold up the response. The durable limits are
3 requests/address and 20/IP per 15 minutes. Address keys are hashed. Address settings
and resend share 5/account and 20/IP attempts per 15 minutes; token consumption allows
20/IP. Settings/consumption return 429 on throttling; public reset requests retain their
generic response. No forwarded IP header is trusted without deployment review.

### Delivery configuration

The default MAIL_TRANSPORT=disabled leaves registration/login working and visibly
marks delivery unavailable in Settings. No recovery is promised for unverified accounts.

For local tests, set MAIL_TRANSPORT=local, HOST=127.0.0.1 and PUBLIC_ORIGIN to your
actual browser origin (for example http://127.0.0.1:5173), then restart npm run dev.
Private JSON test emails appear in the Git-ignored repository .local/account-mail/
folder. Open them locally in an editor and follow the link; do not paste links into
chat or logs. The Vite development server explicitly denies access to `.local`, including
through its filesystem route; production must serve only the built web assets. Files/directories
use restrictive POSIX modes where supported; on Windows keep the workspace under a
private user ACL. Delete test emails after testing. Local delivery is rejected in
production, on non-loopback binding, or with a non-local public origin.

For real delivery configure MAIL_TRANSPORT=smtp, PUBLIC_ORIGIN=https://your-domain,
SMTP_HOST, SMTP_PORT (587 STARTTLS or 465 TLS), SMTP_USER, SMTP_PASSWORD and MAIL_FROM
in server-only environment variables or a secret manager. No mail configuration is
shipped to Vite. [Nodemailer SMTP](https://nodemailer.com/smtp) requires TLS here, validates
certificates, disables protocol/debug logging, and cannot load attachments from URLs
or files. Use a transactional email provider, verify the sender/domain, configure its
SPF/DKIM/DMARC records, and test actual receipt and spam handling before public launch.
No particular provider is required. SMTP delivery has bounded connection/socket waits.

Delivery is attempted once; there is no durable mail queue in this milestone. Graceful
shutdown waits for pending sends, but a process crash may lose a queued message. Users
can request/resend a new link after the rate window. Verification delivery failures are
shown to the signed-in owner; reset failures keep the generic response and emit a
sanitized operational error. Monitor these errors and provider delivery/bounce reports.
Do not promise recovery during an email-service outage or for unverified accounts.
Periodically delete expired account_email_tokens and account_auth_limits rows; no raw
email corpus or token is retained beyond the small local test-mail folder.


## Validation

`npm run check` covers UI rendering/type checks/builds. `npm run test:db` uses only
the configured disposable `TEST_DATABASE_URL` and tests registration, password
hashing, cookie rotation, CSRF, historical link compatibility, another browser/server, receipt
retries, private chat, logout, expiration, throttling, and concurrent seat-ownership
conflicts. Recovery tests inject a fake transport and cover verification, expiry,
reuse, replacement, CSRF, throttling, reset/session revocation and restored game access.
Tests use synthetic accounts and games, never real credentials.

## Private game archive

The Account page lists accepted site games owned through account play seats or explicitly linked guest seats,
not unaccepted challenges, imported PGNs, or someone else's unlinked games. Rows
show White above Black, using the current account username and the opposing seat's
linked username (otherwise Guest). Em dashes indicate unavailable site ratings;
they are not imported or FIDE ratings. Rows show challenge creation time in the
browser's local timezone, the saved site time control, and White-perspective final
scores or explicit unfinished/aborted statuses. Legacy untimed games display
Unavailable rather than a default. Each complete row is a native link opening the
private game in a new tab, in both the Overview preview and Games archive.

`GET /account/games` requires a current bound account session. It returns at most
20 games and an opaque `before` cursor. Ordering is descending creation timestamp
then UUID; the UUID only breaks equal-time ties. Cursors retain PostgreSQL's six
fractional digits. Load more appends older rows; newly created games appear on
refresh rather than shifting page boundaries. The response is not cached. Returning
to the browser tab revalidates the account and reloads the first page.

Wins, draws, and losses cover all completed linked games, independently of the
current page. They come from saved result JSON relative to the original seat;
aborts and unfinished/pending games are excluded. These are private result counts,
not a rating or performance estimate. Page and summary share a database snapshot.

Apply forward migration `019_account_game_order.sql` with `npm run db:migrate`.
It adds chronological indexes for each original guest seat without changing
ownership or existing data. Totals still scan the account's linked games; there is
no global leaderboard, public archive, or new per-message identity lookup.

## Account settings

The private /account page combines username, creation date, this browser's explicit
account session/logout controls, settings, result totals, and the existing
chronological archive. Old /my-games bookmarks redirect to /account. Signed-out
visitors use the header Account button to open the login/register dialog.

The profile-style header shows only the stored username and joined date, with a
generated initials placeholder. Overview previews the five most recent linked
games and the existing result totals; Games keeps the full paginated archive.
Stats uses those same all-game totals, never extrapolating from a loaded page.
Settings contains logout and the existing secure username
and password forms. Edit profile opens Settings; no personal details or uploads
are offered. Ordinary links to `#overview`, `#games`, `#stats`, and `#settings`
preserve the selected section on refresh and browser Back/Forward. Switching
sections does not refetch or discard loaded archive pages. This is an owner-only
frontend presentation, with no new endpoint, stored data, or migration.

POST /account/username requires the current password and the existing username
validation/uniqueness policy. It rotates the current guest/CSRF and account bearer.
Linked seats resolve the updated username on reads; transactional game-update
notifications refresh connected participants without rewriting moves or messages.

POST /account/password requires the current password, a 15–128 character new
password, and matching confirmation. Argon2id settings match registration. The
transaction revokes all account sessions, invalidates other associated guest
bearers (including linked original seats), then rotates the current guest and
issues a fresh bound account session. Ownership records remain intact. Other
browsers must log in again; forgotten passwords require a verified recovery address. Login
rechecks the verified hash under the account lock to prevent a concurrent old
password login from surviving a password change. Both settings routes use CSRF
and durable per-account/per-IP 15-minute limits (10/30 attempts). Credentials
and hashes are never returned. No schema migration is required.
