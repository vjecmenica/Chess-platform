# Accounts and guest game access

This milestone adds username/password registration, login, logout, and explicit
guest-to-account linking. It does not add ratings, public game access, profiles,
email collection, email verification, or password recovery.

## Ownership

Existing challenge seats, commands, receipts, and chat remain owned by their
original guest IDs. Migration `018_accounts.sql` adds accounts, expiring account
sessions, a nullable account owner on guest records, and durable authentication
rate counters. Earlier migrations and game records are unchanged.

Registration and login **do not link guest games automatically**. The signed-in
player chooses **Link this browser's guest games**, proving possession of the
current unexpired guest cookie and CSRF token. The request accepts no guest ID,
game ID, or seat. Linking attaches that guest identity and its existing/future
games to the account; it does not transfer seats. A guest cannot be relinked to
another account. An account cannot link opposing seats in the same challenge;
account locks serialize links and acceptance across browsers and server processes.

A fresh browser first receives its own guest session, then logs in normally.
Account navigation lists at most 20 linked challenges per page. The server resolves
linked access back to the original guest seat for challenge reads, game commands,
SSE, and private participant chat. Receipt IDs and game versions are unchanged.
Knowing a link, logging in, or supplying another participant's identifiers grants
no access. There are no public account/game/chat endpoints.

Unlinked guest games remain available through the existing guest flow. Only link
a guest session on a browser you control. Losing an unlinked guest cookie still
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
- All mutations, including login, registration, linking and logout, require the
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

## Email and recovery: required before public launch

Accounts in this milestone have **no recovery method**. A forgotten password cannot
be reset, and a username does not prove identity. The UI says so. Do not deploy this
as a recoverable public-account service or promise manual password resets.

Before public launch, implement a verified-email recovery channel using a selected
transactional email provider and HTTPS public origin, one-use expiring verification
and reset tokens stored as digests, generic/rate-limited responses, and session
revocation after password reset. Verify ownership before enabling recovery; never
accept an unverified email address or a game link as proof. Provider configuration,
delivery monitoring and abuse controls are launch prerequisites. No provider or
email credentials are needed to test this limited milestone locally.

## Validation

`npm run check` covers UI rendering/type checks/builds. `npm run test:db` uses only
the configured disposable `TEST_DATABASE_URL` and tests registration, password
hashing, cookie rotation, CSRF, explicit linking, another browser/server, receipt
retries, private chat, logout, expiration, throttling, and concurrent seat-link
conflicts. Tests use synthetic accounts and games, never real credentials.
