# Architecture

The initial stack was chosen on September 28, 2026: TypeScript, npm workspaces, React + Vite, Fastify on Node.js, PostgreSQL, and the domain/contracts package boundaries. The first playable scope is a casual 5+3 challenge with guest sessions. The server now persists guests, seats, standard-start games, accepted moves, and move receipts. The domain also has an in-memory clock, but the HTTP game route does not use it. Live delivery, durable clocks, analysis, and scaling designs below remain proposals for later steps. See the [specification](product-spec.md) and [roadmap](roadmap.md) for scope and order.

## Start with one game server

The proposed starting point is a modular monolith: one long-running process for the API and active games, a web client, and PostgreSQL. One process owns each game's move order and clock, which makes conflicting decisions easier to prevent. Keep clear module boundaries so expensive analysis can run separately and other services can be extracted when measurements justify it.

### Chosen foundation and later proposals

- **TypeScript throughout.** Shared types help the client and server agree on messages. They do not validate network input, so message schemas must also run at the server boundary.
- **React, Vite, and plain CSS for the client.** The board, clocks, replay, and analysis controls fit a small interactive application. Choose the board component for promotion handling, accessibility, and licensing. Server rendering is not needed for the first playable milestone.
- **A supported Node.js LTS release with Fastify.** This keeps the server in the same language and gives API schemas and modules a clear home. CPU-heavy engine work must run outside the process that controls game clocks, because it can block the event loop.
- **Proposed later: Socket.IO for live messages, HTTP for challenges and the archive.** Connection handling, rooms, and acknowledgments are useful building blocks. Ordered delivery does not guarantee receipt; the application still needs durable requests and recovery.
- **chess.js 1.4.0 behind the domain API.** Move validation, notation, history, and explicit board-rule queries use this adapter. Callers use project-owned types rather than chess.js types. The library is not an AI engine or a complete competition rulebook; its aggregate `isGameOver()` and `isDraw()` helpers are not used. The [result policy](game-rules.md) defines implemented draws and claims, online adaptations, and the limits of mating-possibility detection.
- **PostgreSQL with versioned SQL migrations.** Transactions, row locks, and uniqueness constraints protect moves and results, then ratings and tournament pairings. The setup uses `pg` for connection checks and SQL migrations. Revisit an ORM only if later queries justify it and critical transactions stay explicit.
- **npm workspaces, a committed lockfile, and Vitest; Playwright later.** Keep one repository, test domain logic with controlled time, exercise persistence against a real test database, and verify the complete flow in two browser contexts.
- **Proposed later: Stockfish for analysis.** A separate server worker or browser Web Worker could provide evaluations and multiple lines. Execution location, resource budgets, distribution, and package licensing need review before integration.

React/Vite suits the initial board-focused application; consider Next.js if server rendering or content pages become a real requirement. Raw WebSocket would reduce dependencies but require more connection-management code, and it would still need request deduplication. SQLite could serve a local prototype, but PostgreSQL avoids changing concurrency behavior later. The selected TypeScript/Fastify server keeps shared tooling simple; switching languages is not part of the initial setup.

The setup supports Node.js 22.12+ in the 22.x line or 24.x LTS, uses PostgreSQL 17 for local development, and pins npm dependencies in the lockfile. See the README for exact setup commands. The stack alone says nothing about capacity: measure concurrent games and move latency before promising a service level.

### What the development setup implements

Vite proxies `/api` calls to Fastify. Fastify exposes `/health` for liveness and `/health/ready` for a fresh `SELECT 1` database probe, returning 503 when that probe fails. Readiness measures connectivity, not migration currency. Startup validates the root `.env`, connects to PostgreSQL, and checks the guest/challenge/game tables before opening the HTTP port. Connection and query timeouts keep failures bounded, errors omit database credentials, and shutdown closes the pool.

`npm run db:migrate` applies numbered SQL files under a transaction-scoped advisory lock. `public.schema_migrations` records each filename, checksum, and application time. Applied files cannot change or disappear, and new versions must follow existing ones. The whole pending batch commits or rolls back together. Migration 001 creates the `chess` schema; 002 adds guest sessions and challenges; 003 adds games, moves, and receipts, and backfills already accepted challenges. Migration files must ship with the server; schema changes are explicit commands, never an automatic side effect of starting an app.

The shared packages build before their consumers. Contracts share readiness, guest-session, challenge, and game response types. The domain package owns move validation, results, and the in-memory clock, and depends only on chess.js at runtime. Vitest exercises domain, configuration, and health behavior without a database; `npm run test:db` uses a disposable PostgreSQL database for migrations, rollback, guest ownership, concurrent acceptance and moves, retries, and reconstruction.

## Responsibilities and dependencies

```text
Web client -- HTTP + Socket.IO --> Game server --> PostgreSQL
                                  | identity and challenges
                                  | active games and clocks
                                  | saved-game access

After saved games: analysis jobs --> separate engine worker
Later: ratings, matchmaking, and Swiss coordination in server modules
Later: AI explanations based on checked engine findings
```

This diagram describes the later application, not features already implemented. The analysis path shows the server-worker option; browser execution is still an alternative for interactive analysis.

- `apps/web` handles the board, move input, pending/confirmed state, clock display, replay, and analysis controls. It does not decide the official position, time, or result.
- `apps/server` authenticates users, authorizes commands, serializes work for each game, manages transactions, and broadcasts confirmed events.
- `packages/domain` contains the chess adapter, position snapshots, ordered move history, game lifecycle, and a transport-free 5+3 clock owner. It has no browser, network, or database dependency. Clock tests inject a monotonic time source.
- `packages/contracts` contains shared response types. It contains no secrets and does not make client input trustworthy; Fastify validates the current HTTP command at runtime.

Both apps use the contracts; the server uses the domain. If the client later uses domain code to highlight possible moves, the server still independently validates every command. The domain API is documented in its [package guide](../packages/domain/README.md). `createPosition()` keeps the chess.js instance private. Move requests identify a side and coordinates; legal candidates are checked before any state change. Missing promotion choices return a specific rejection, and accepted moves record SAN, UCI, and before/after FEN. Returned snapshots and history are detached copies. Side validation is turn checking, not authentication; the HTTP game route derives the side from the guest's persisted seat.

### Current guest and challenge boundary

`GET /guest-session` creates or restores a guest. The browser receives a random 256-bit token in an HttpOnly, SameSite=Lax cookie; PostgreSQL stores only its SHA-256 hash and a 30-day expiry. The endpoint returns a separate CSRF token to same-origin JavaScript. Challenge writes require that token in `X-CSRF-Token`. Local loopback HTTP omits the cookie's `Secure` flag; production mode or a non-loopback bind sets it, so deployment must use HTTPS and keep web/API requests on one origin. The server does not enable cross-origin reads.

`POST /challenges` requires a UUID `Idempotency-Key`. A unique `(creator_guest_id, create_request_id)` constraint returns the same challenge on a retry, even under concurrent requests. The creator owns White. `POST /challenges/:id/accept` atomically fills Black only while it is empty and only for another guest, and creates one standard-start game in that transaction. A same-guest retry returns the accepted summary; a competing guest receives a conflict. The random challenge UUID is the shareable link: any authenticated guest holding an open link can see its limited summary and try to accept. Once filled, only the two seat owners can read it. Responses contain occupancy and the caller's seat, never guest IDs or session tokens. Readiness and live transport do not exist yet. Add invitation expiry/revocation and guest recovery before treating these sessions as durable player accounts.

### Current game boundary

`createGame()` privately owns a position and exposes active, pending-adjudication, or finished snapshots, ordered history, move submission, resignation, draw claims, and draw-offer responses. The adapter supplies checkmate/stalemate checks, normalized repetition keys, reversible half-move counts, isolated move previews, and conservative mating-possibility proofs. The lifecycle counts the initial position and accepted moves; previews never enter its repetition map. The game checks completion or accepted resignation before any player mutation, and terminal results cannot be replaced. Every player command includes an acting side; moves and draw claims require that side to have the turn. Resignation, draw responses, and claims leave board history unchanged, including a successful intended-move claim. A pending offer belongs to its sender and is cleared by the recipient’s accepted move, resignation, or any result.

The [game rules](game-rules.md) document the agreement minimum, offer lifetime, automatic and claimable draws, and the limits of dead-position, resignation, and timeout detection. The mating query returns a negative proof, a verified immediate mate, or an unresolved answer; it does not estimate whether mate can be forced. Closed pawn-position proofs have a fixed search budget and cache their conclusion until the board changes. An unresolved resignation or timeout enters `pending_adjudication` and freezes player actions. `findResignationMateWitness` and `findTimeoutMateWitness` are separate bounded, deterministic searches; they verify candidate lines against the full game history without mutating the game. A future worker can use a found line to resolve the pending result, whose snapshot retains that line. The domain does not accept an evidence string as a negative ruling. A future no-mate resolution needs a validated proof and an authorized persistence path. The [adjudication decision](adjudication-design.md#resolving-a-resignation-online) specifies that work. `createPosition()` remains a separate move/replay API and does not enforce game status. Neither API exposes the underlying chess.js instance. The base `createGame()` API has no clock; `createTimedGame()` owns it when time is needed. Neither API authenticates users or persists state.

The current `GET /games/:id` reads a seat-owned standard-start game and its ordered moves from PostgreSQL. It replays every move through `createGame()` and checks the resulting history, FEN, turn, status, result, and version against the saved snapshot; an inconsistency fails the read rather than publishing it. `POST /games/:id/moves` accepts coordinates, an expected version, and a UUID request ID. The server derives the side from the guest cookie, locks the game row, verifies any prior accepted receipt, replays the game, and asks the domain to validate a new move. It saves the move, snapshot, version, terminal result if any, and receipt in one transaction before replying. A repeated accepted request returns its stored response; a reused ID with different content, stale version, wrong turn, or illegal move is rejected without a state change. Rejected attempts are not stored as receipts. Row locking serializes competing submissions. These routes do not start clocks, check deadlines, broadcast events, or expose resignation and draw commands. Game responses explicitly report no integrated clock, so they cannot be presented as timed play.

## Accepting a move

The later timed-game lifecycle needs `waiting → active → finished`, with `active → pending_adjudication → finished` for resignations or timeouts whose result needs proof, and `aborted` for cancellation before play or an agreed recovery outcome. The current database game starts active on challenge acceptance and only advances through moves. The exact abort rules and their effect on ratings and archives remain open. Store the rules version with the game so later changes do not reinterpret earlier results.

A move command carries `gameId`, `requestId`, `expectedVersion`, `from`, `to`, and an optional `promotion`. Derive the acting player from the authenticated session. Never trust a client-supplied player ID, FEN, clock value, or result as authoritative.

1. Authorize the session, validate the message, and record the server time at entry to the game's serialized command queue. Moves and time-expiry checks will use that same queue so they cannot reach contradictory results.
2. Lock the game row in a short transaction. Look up the request receipt using the game, actor, and request ID. Return the original outcome for an identical retry; reject reuse of the ID with a different payload.
3. For a new request, check game status, expected version, and whose turn it is. Check the deadline under the chosen clock rule, then move legality. An expired clock takes precedence. An illegal move does not reset the start of the turn.
4. Save the move, position, both clocks, side to move, and new version. If the move ends the game, save the result and reason in the same transaction, along with the request receipt. The current HTTP route saves everything here except clocks.
5. Commit before acknowledging success. Then send the confirmed event, including the move, version, clocks, and status, to both players. If the write fails, recover from durable state instead of continuing from an uncommitted position in memory.

Retries can therefore have one effect in the database even when messages are delivered more than once. This is not a promise of exactly-once network delivery. A client keeps a move pending until confirmation. A stale version triggers resynchronization rather than applying the requested move to an unexpected position.

A timestamp for a new turn cannot precede that turn's start, even if a request arrived early. The queue preserves order while a write is committing. The [selected ordering](adjudication-design.md#ordering-with-flag-falls) uses server receipt time, gives flag fall precedence at the deadline, and starts the next turn at durable confirmation. Server processing between move receipt and confirmation is charged to neither side. A client timestamp can never extend its deadline.

## Clocks and recovery

The domain's `createTimedGame` implements the first 5+3 clock boundary in integer milliseconds. Both players confirm readiness before the clock starts; only the side to move loses time. An accepted move charges the mover through its trusted receipt time and adds the increment once. The opponent's turn starts at processing/confirmation time, so server work between receipt and confirmation is charged to neither side. A command received at or after the deadline loses to flag fall. Accepted resignation, a completed game, and pending adjudication stop both clocks. A flag changes the game to a final no-mate draw, a witnessed timeout win, or a frozen pending timeout. Both the game and clock record the flagged side and effective deadline. A mate line may be verified and cached before expiry; otherwise a separate worker must search and resolve the pending case. The live clock path never runs bounded mate search. The [claim procedure](adjudication-design.md#incorrect-claims-online) still needs a clock pause and time bonus after an incorrect claim.

A server timer will call `poll()` even when no messages arrive. The timer itself is not the final decision: the clock checks its stored deadline, and a queued earlier receipt must be processed first. The later handler must lock and recheck durable game state before committing a flag. Persist clocks and their time reference on accepted state transitions rather than writing a countdown every second. The domain clock queue and its duplicate-command receipts are only in memory; the HTTP route's accepted-move receipts are durable, but have no deadline semantics.

Measure elapsed time with a monotonic clock inside the live process so a wall-clock correction does not change a result. Also persist a UTC time reference or deadline for recovery. A monotonic reading cannot be reused after a restart or on another host.

Before implementing outage recovery, choose whether an active game keeps consuming time during a server outage, pauses, or is aborted/voided. Test that policy with crashes before and after a database commit and with changes to system time. Restoring a saved clock number alone cannot guarantee a fair continuation.

The starting proposal has no network-latency compensation. Measure event-loop delay and database write time, and keep engine work out of the game process. The client receives remaining times and a server time reference, interpolates a countdown, and periodically corrects it. Reaching zero locally does not authorize it to declare a winner.

A client disconnect would not pause the clock under the proposal. On reconnect, verify the same identity and return a versioned snapshot plus missing history. The client discards old or duplicate events and requests fresh state when it detects a version gap. A lost acknowledgment is recovered by retrying the same request ID. A committed move whose broadcast was lost is recovered from the database; periodic version checks also catch missing events on a connection that still appears healthy. Socket.IO recovery can help, but it must not be the only recovery path.

## Store enough to reproduce the game

The data model separates game history from the information needed to authorize and recover commands. The first five items below are partly implemented; clocks, command outcomes beyond accepted moves, and later modules remain to be added:

- **Identity and session:** the current guest token hash and expiry, with registered identity and recovery later. A public game ID will not grant permission to play.
- **Challenge:** the current creator and acceptor seats, fixed casual 5+3 terms, and create request ID. Acceptance is atomic. Expiry, revocation, and a separate invitation token remain future choices.
- **Game:** the current row links to the challenge seats and stores standard starting FEN, current FEN, side, status, result, and version. Timed play needs durable clocks, a time reference, and start/end times. Add a rules version and optional tournament reference later.
- **Move:** game ID, half-move number (`ply`), SAN, UCI, and before/after FEN are saved in an ordered record with a unique `(gameId, ply)` pair. Timed play needs trusted server time and clocks after the move.
- **Command receipt:** the current accepted-move receipt stores actor, request ID, submitted payload, and accepted response under a unique key. Other commands and rejected-outcome receipts belong to the later timed flow.
- **Rating and rating event, later:** player and pool, rating/RD/volatility, period and method version, and a record of applied game or period effects that prevents duplicate updates.
- **Tournament, entry, round, and pairing, later:** organizer, configuration and rules version, participants, rounds, pairings/byes, and game references. A player has at most one place in a round.

The starting FEN and ordered moves reconstruct the game. A current FEN is a useful snapshot but cannot replace the history needed for repetition rules. PGN is useful for display or export; it is not the sole durable record for clocks, authorization, and request deduplication. Replay builds the position at a selected half-move without changing the finished game. The server checks archive access under the chosen privacy policy.

Finishing a game locks the row and permits one terminal transition. Later, write a durable outbox event in the same transaction as the result to trigger ratings, reviews, or tournament progress. Consumers must tolerate retries without double-counting a result or opening two rounds. An in-memory broadcast alone cannot guarantee that work will happen after a crash. For the first playable milestone, stored state, request receipts, and resynchronization are enough; add the outbox when reliable background processing is introduced.

## Analysis and full game review

Interactive analysis and full review use saved games, but have different workloads. The board needs responsive evaluations and multiple lines from the selected position. Full review needs a bounded job that can revisit every move, report progress, recover from failure, and retain its results.

Run engine computation outside the process that owns active clocks. A browser worker may suit interactive exploration; a server worker gives more control over budgets and access. Choose between them together with the fair-play policy. Full review needs resource limits, retries, caching, job status, and recorded engine and methodology versions. Its accuracy and move labels must follow the documented method in the specification. Numeric accuracy must never be inferred from AI prose.

The stricter initial access proposal blocks platform engine/AI requests and puzzles with advice while an identity has an active game. Recheck access when returning a background job's result, not only when accepting it. Whether the restriction covers analysis of unrelated finished games still needs a decision. Hiding a button does not enforce the policy. A browser engine already delivered to a device, or an outside tool, cannot reliably be revoked by a server check; address that limitation before selecting browser execution.

Later, AI explanations receive a verified position and engine findings. New lines suggested by the AI must pass legal-move and engine validation before being shown as verified advice. Failures in the explanation service must leave replay and engine analysis usable. Personal-game data requires an agreed privacy policy before it is sent to an external provider.

## Ratings, matchmaking, and tournaments

### Ratings and matchmaking

The Glicko-2 configuration determines parameters and rating periods. Tie calculations to durable game results and give applied effects unique identities. Use reference calculations to verify the method; the product's four pools and fixed time-control assignments come from the specification.

A matchmaking queue is keyed by `(baseSeconds, incrementSeconds, rated)` and uses the corresponding pool's rating. The proposed widening policy uses each candidate's waiting time, and a match must satisfy both players' allowed ranges. Reserve both players atomically, including when one has multiple tabs open. An in-memory queue is a possible starting point if players explicitly rejoin after a restart. Durable queues or multiple matchmakers need a separate concurrency design.

### Swiss tournaments

A tournament coordinates the existing game service. The proposal is to freeze the time control, round count, pairing rules, and rated status at the start, and copy the relevant settings into each game.

When the last result arrives, check that all games and any byes or administrative results in the round are resolved. Persist `nextRoundAt` after the agreed break. On restart, the scheduler reads that deadline from the database. Transactions and unique constraints prevent duplicate pairings or rounds when several handlers run or retry. Rating processing uses the same ordinary pool and duplicate protection as other rated games.

Select and test the Swiss implementation against the rules we choose; do not claim compliance with a named rulebook in advance. Explain the assumed move count and breaks in duration estimates, especially when increment is involved. These modules reuse the game foundations, but the product sequence keeps them after interactive analysis and full review.

## Security and operation

Authorize every command, not just the initial connection. The current challenge and game routes derive guest identity from an HttpOnly cookie, require a CSRF token for writes, reject client-supplied seats, and check stored seat ownership. Production cookies require HTTPS. Later live routes must retain that check on every command, add WebSocket origin checks if that transport is chosen, and limit request size, frequency, and open challenges. Invitation expiry and revocation are still open. Keep secrets and tokens out of logs and Git; `.env` remains local.

The proposed deployment is a static web client, one long-running server behind a WebSocket-capable proxy, and PostgreSQL with backups. Avoid hosting that sleeps the game process or cuts active connections. Drain before deployment by stopping new challenges and letting games finish, or apply the agreed outage policy. Adding replicas is not enough to make game ownership safe.

Monitor move-acknowledgment latency, event-loop lag, transaction duration, rejected/duplicate commands, reconnects, clock corrections, and background-job failures. Correlate logs with game and request IDs without including secrets. Agree on load targets, retention, alert thresholds, region, costs, and backup/restore objectives before public release. Test restoring saved games as part of the first playable milestone.

When measured load requires several game servers, give each active game one owner and add routing, ownership leases, and fencing so an old owner cannot keep writing after a handover. A Redis adapter can distribute notifications; it does not itself establish game ownership, a distributed clock, or durable history. Database constraints remain a final defense against concurrent confirmations. Analysis computation is already isolated for clock safety; further service separation should solve a measured problem.

## How to validate the design

Use domain tests with controlled time, integration tests against a real database, and a complete flow in two browser contexts. Focus on concurrent moves, a move racing expiry, duplicate requests, a commit followed by a lost broadcast, disconnects, restarts, and archive reconstruction. Then test rating and round consumers with repeated events. Measure load before claiming bullet reliability, because short controls expose server delays most clearly.

The [open choices](product-spec.md#choices-still-open) separate decisions needed before implementation from those needed for later features. The initial stack, guest/casual scope, and in-memory 5+3 clock and timeout boundaries are settled; durable claim and adjudication procedures, complete mating-possibility coverage, and outage rules remain open.

## Technical references

These sources explain the tools behind the proposal. They do not prescribe our product rules.

- [Node.js release policy](https://nodejs.org/en/about/previous-releases): supported LTS releases.
- [Vite guide](https://vite.dev/guide/) and [Fastify documentation](https://fastify.dev/docs/latest/): client tooling and API framework.
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/): ordering, delivery limits, and application-level recovery.
- [chess.js documentation](https://jhlywa.github.io/chess.js/): move validation, notation, and game representation.
- [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html): protecting concurrent updates within transactions.
- [The Glicko author's documentation](https://www.glicko.net/glicko.html): methodology and reference calculations.
- [Official Stockfish distribution](https://stockfishchess.org/download/): a starting point for selecting the engine package.
