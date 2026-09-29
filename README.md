# Chess platform

A focused platform for competitive chess and game analysis, with the board first and no distracting animations.

The planned product includes rated and casual games, friend challenges, matchmaking, four Glicko-2 pools, Swiss tournaments, puzzles, and later engine-checked AI explanations. Analysis is central: saved-game replay, engine evaluations with multiple lines, and full game review with accuracy and move labels. Interactive analysis and full review come before Swiss tournaments.

## Current scope

The server creates guest sessions and casual 5+3 challenge links. One guest creates as White; one other accepts as Black. Acceptance creates one standard-start game. Authenticated HTTP endpoints now validate moves through the domain and save each accepted move, position, result, version, and retry receipt in PostgreSQL. The page still only shows the link and seats; there is no board or live transport. **These HTTP moves have no authoritative clock**, so this is not yet a playable 5+3 game. The [result policy](docs/game-rules.md) explains the domain rules and mating-possibility limits. Accounts, ratings, matchmaking, analysis, and tournaments remain future work.

The chosen stack is TypeScript, npm workspaces, React + Vite, Fastify, and PostgreSQL. The first playable flow uses guest sessions and a casual 5+3 challenge. The [adjudication decision](docs/adjudication-design.md) sets the claim and flag-fall procedure; authoritative clock state, a background adjudication worker, live delivery, and server-outage handling still need integration.

## Local setup

Run all commands from the repository root. Use Node.js **22.12+ in the 22.x line, or 24.x LTS**, with npm 10 or newer. The lockfile records the exact dependency versions. The setup was checked with Node.js 22.22.3 and npm 10.9.8 on Windows.

You also need **PostgreSQL 17**, either installed locally or through Docker with Compose v2. Docker is optional; npm scripts do not require a Unix shell.

1. Install the locked dependencies:

   ```sh
   npm ci
   ```

2. Copy the example configuration. In PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   On macOS/Linux, use `cp .env.example .env`. Keep this file at the repository root, not inside an app.

3. Edit `.env`. Choose your own local `POSTGRES_PASSWORD` and set `DATABASE_URL` to match. Its shape is `postgresql://chess:YOUR_PASSWORD@127.0.0.1:5432/chess`; replace the placeholder and percent-encode special characters in the password. The example intentionally leaves both values empty. Keep `HOST=127.0.0.1` and `PORT=3001` unless those addresses are unavailable.

4. Start PostgreSQL. With Docker Desktop running Linux containers:

   ```sh
   docker compose up -d --wait
   ```

   Or use a native PostgreSQL installation. In its SQL Shell (`psql`), log in as your local administrator and create the role and database:

   ```sql
   CREATE ROLE chess LOGIN;
   \password chess
   CREATE DATABASE chess OWNER chess;
   ```

   `\password` prompts for the password instead of putting it into a SQL command. Use that value in `.env`. Ensure the PostgreSQL service is running and accepting local connections on port 5432. Use a dedicated local database, not an existing application's database.

5. Check connectivity and apply migrations:

   ```sh
   npm run db:check
   npm run db:migrate
   ```

6. Start both apps:

   ```sh
   npm run dev
   ```

   Open [the web page](http://127.0.0.1:5173). It starts a guest session and can create a challenge link. Stop with Ctrl+C. You can also run `npm run dev:server` and `npm run dev:web` in separate terminals. If you later change shared package code, run `npm run build:packages` before restarting consumers.

The API listens on port 3001. [GET /health](http://127.0.0.1:3001/health) reports process liveness. [GET /health/ready](http://127.0.0.1:3001/health/ready) queries PostgreSQL and returns 200 when connected or 503 if the database becomes unavailable. It checks connectivity, not migration currency. Migrations must be run explicitly. The server refuses to start without a valid `DATABASE_URL`, an initial database connection, or the guest/challenge/game tables.

Vite forwards `/api/*` to the server during development and preview. Only the server reads database credentials; never put them in a `VITE_*` variable. Changing `.env` requires restarting the development processes.

## Two-browser challenge check

After `npm run db:migrate` and `npm run dev`, create a challenge at [http://127.0.0.1:5173](http://127.0.0.1:5173). Copy its link into a **different browser profile or private window**. The first browser should show White, and the second should be able to accept as Black. Refresh both pages: the seats should remain occupied by the same guests. A third separate session may view the link while it is open, but cannot read the filled challenge or take a seat after acceptance. Opening the link in another tab of the first browser uses the same guest cookie and cannot accept its own challenge.

The guest identity is an opaque, 30-day HttpOnly cookie; writes also require a CSRF token obtained from `GET /api/guest-session`. Challenge responses expose no guest tokens or guest IDs. The link itself lets another guest claim the open seat, so share it only with the intended opponent. Local loopback HTTP omits the cookie's `Secure` flag; production mode or a non-loopback bind sets it and requires HTTPS. Losing the cookie currently loses access to that seat; guest recovery must be designed before the playable milestone.

After acceptance, `GET /api/games/<challenge-id>` returns the saved position, turn, result, version, and ordered history to either seat owner. `POST /api/games/<challenge-id>/moves` requires the guest cookie, `X-CSRF-Token`, a UUID `Idempotency-Key`, and JSON such as `{"expectedVersion":0,"from":"e2","to":"e4"}`. Promotion adds `"promotion":"q"` (or `r`, `b`, `n`). The server derives White or Black from the cookie; do not send a side. A successful response includes the move and new version. Reusing the same request ID and payload returns its original accepted response; a stale version returns 409. Both endpoints report `clocks: null` and `clockStatus: "not_integrated"` because deadlines and increments are not applied by this HTTP path.

## Build and check

```sh
npm run check
```

This runs workspace type checks, domain and configuration/HTTP tests, and all production builds. These checks do **not** require PostgreSQL; the HTTP tests inject a database probe and do not prove a real database is connected.

For real database verification, create a separate disposable database, such as `chess_test` owned by `chess`, then set `TEST_DATABASE_URL` in `.env` and run:

```sh
npm run test:db
```

The integration suite checks real migrations, rollback, HTTP readiness, guest ownership, concurrent seat and move requests, illegal moves, retries, terminal results, and restart reconstruction. It fails clearly when configuration or PostgreSQL is missing; it never silently skips. Use a disposable database because the tests leave guest, challenge, and game rows in it.

The maintainer confirmed on September 29, 2026 that the Windows setup runs with PostgreSQL and the web page is visible. The challenge and game integration suites were run against a disposable PostgreSQL 17 database on Windows.

Individual commands:

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Build shared declarations and check all TypeScript, including tests and tooling. |
| `npm test` | Run domain, configuration, and HTTP tests without a database. |
| `npm test -- packages/domain/test` | Run deterministic move-validation and lifecycle tests. |
| `npm run build` | Build shared packages, server JavaScript, and web assets in dependency order. |
| `npm run start:server` | Run the compiled server after a build, still requiring PostgreSQL. |
| `npm run preview:web` | Preview the built web app at port 4173, proxying to the separately running server. |

Vite preview is a local verification tool, not the production deployment server. To preview a full build, run `npm run build`, then `npm run start:server` and `npm run preview:web` in separate terminals. Production hosting remains a later decision.

## Database migrations

SQL files live in `apps/server/migrations`. `001_initial.sql` creates the `chess` schema; `002_guest_challenges.sql` adds guest sessions and challenges; `003_games.sql` adds games, ordered moves, and move receipts. It also creates standard-start games for challenges accepted before this migration. The runner records filenames, checksums, and application times in `public.schema_migrations`.

Add the next numbered file, such as `004_description.sql`, for each change. Never edit or remove an applied migration. The runner rejects changed history and out-of-order versions, takes a transaction-scoped lock to serialize runners, and applies pending files in one transaction. A failed file rolls back that batch. Files must contain transaction-safe SQL and must not include their own `BEGIN`/`COMMIT`. Use a new forward migration to correct an applied change; no destructive reset or down command is provided.

## Troubleshooting and Windows notes

- **Missing configuration:** copy and fill in the root `.env`. A shell environment variable overrides the file, including an empty variable; clear stale values and restart. No database URL is printed in startup errors.
- **PostgreSQL unavailable:** check the service/container, port, database name, role, and password. Docker users can run `docker compose ps` and `docker compose logs postgres`. Startup checks time out rather than waiting indefinitely.
- **Docker password changes:** the named volume retains the initialized role/password. Changing `.env` does not change an existing database password. Update it through PostgreSQL and make the URL match; do not delete a volume containing data you need.
- **Ports in use:** free ports 5173 and 5432, or adapt the Vite/Compose configuration. To change the API port, set `PORT` in `.env`; the local web proxy reads it too. `HOST` defaults to loopback, so the setup is not exposed to the network.
- **PowerShell blocks `npm.ps1`:** use `npm.cmd` in place of `npm`; no execution-policy change is needed. Native `psql` may be available from PostgreSQL's SQL Shell shortcut or `C:\Program Files\PostgreSQL\17\bin\psql.exe` even when it is not on `PATH`.
- **Docker on Windows:** Docker Desktop must be running with Linux containers (normally using WSL 2). If it is unavailable, use native PostgreSQL instead. `docker compose stop` stops the database without deleting the named volume.
- **Watcher after an error:** the server watcher displays the startup error and waits for a source change. Restart it after changing environment variables or starting PostgreSQL.

## Project guide

- [Product specification](docs/product-spec.md): agreed scope, acceptance criteria, and unresolved rules.
- [Roadmap](docs/roadmap.md): the development setup and later feature order.
- [Architecture](docs/architecture.md): chosen foundation and proposed game/analysis design.

`apps/web` owns the interface; `apps/server` owns HTTP and database access. `packages/contracts` shares readiness, challenge, and game response types. `packages/domain` wraps chess.js for move validation, replay history, game results, and the in-memory clock, with no browser, server, or database dependency. Its [API guide](packages/domain/README.md) documents position and game APIs, snapshots, and rejection results. Runtime packages build to their own `dist` directories. Migrations stay alongside the server source and must accompany a server deployment.

**Use English for all repository content**, including documentation, code comments, tests, commit messages, and UI copy. Keep requirements separate from proposals, update affected documents together, and check `git diff --check` before committing. Commit the lockfile and sanitized examples; never commit `.env` or credentials.
