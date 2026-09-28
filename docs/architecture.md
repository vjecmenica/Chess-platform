# Architecture proposal

This is a design for review, not an approved stack. It supports the [product specification](product-spec.md) and the small delivery steps in the [roadmap](roadmap.md). The repository currently contains no application code or installed dependencies.

## Start with one game server

The proposed starting point is a modular monolith: one long-running process for the API and active games, a web client, and PostgreSQL. One process owns each game's move order and clock, which makes conflicting decisions easier to prevent. Keep clear module boundaries so expensive analysis can run separately and other services can be extracted when measurements justify it.

### Proposed stack

- **TypeScript throughout.** Shared types help the client and server agree on messages. They do not validate network input, so message schemas must also run at the server boundary.
- **React, Vite, and plain CSS for the client.** The board, clocks, replay, and analysis controls fit a small interactive application. Choose the board component for promotion handling, accessibility, and licensing. Server rendering is not needed for the first playable milestone.
- **A supported Node.js LTS release with Fastify.** This keeps the server in the same language and gives API schemas and modules a clear home. CPU-heavy engine work must run outside the process that controls game clocks, because it can block the event loop.
- **Socket.IO for live messages, HTTP for challenges and the archive.** Connection handling, rooms, and acknowledgments are useful building blocks. Ordered delivery does not guarantee receipt; the application still needs durable requests and recovery.
- **chess.js behind a domain adapter.** Reuse move validation, notation, and history rather than writing a move generator. The library is not an AI engine or a complete competition rulebook. Verify its draw behavior and implement the chosen timeout and claim rules explicitly.
- **PostgreSQL with versioned SQL migrations.** Transactions, row locks, and uniqueness constraints protect moves and results, then ratings and tournament pairings. Direct SQL through `pg` is the initial suggestion. An ORM remains an option if it keeps those transactions explicit.
- **npm workspaces, a committed lockfile, Vitest, and Playwright.** Keep one repository, test domain logic with controlled time, exercise persistence against a real test database, and verify the complete flow in two browser contexts.
- **Stockfish for analysis.** A separate server worker or browser Web Worker could provide evaluations and multiple lines. Execution location, resource budgets, distribution, and package licensing need review before integration.

React/Vite suits the initial board-focused application; consider Next.js if server rendering or content pages become a real requirement. Raw WebSocket would reduce dependencies but require more connection-management code, and it would still need request deduplication. SQLite could serve a local prototype, but PostgreSQL avoids changing concurrency behavior later. Go is a reasonable server alternative if the team prefers it, at the cost of separate language tooling and contracts.

Choose compatible versions when the development setup is built, pin them, and document how to run them. Use a supported LTS runtime. The stack alone says nothing about capacity: measure concurrent games and move latency before promising a service level.

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

The analysis path above shows the server-worker option; browser execution is still an alternative for interactive analysis.

- `apps/web` handles the board, move input, pending/confirmed state, clock display, replay, and analysis controls. It does not decide the official position, time, or result.
- `apps/server` authenticates users, authorizes commands, serializes work for each game, manages transactions, and broadcasts confirmed events.
- `packages/domain` contains the chess adapter, game transitions, and clock calculations, with rating and tournament rules added later. It has no browser, network, or direct database dependency. Time is passed in so tests can control it.
- `packages/contracts` contains versioned command/event schemas and shared types. It contains no secrets and does not make client input trustworthy.

Both apps use the contracts; the server uses the domain. If the client later uses domain code to highlight possible moves, the server still independently validates every command. The existing directories are placeholders for these proposed boundaries.

## Accepting a move

The proposed game lifecycle is `waiting → active → finished`, with `aborted` for cancellation before play or an agreed recovery outcome. The exact abort rules and their effect on ratings and archives remain open. Store the rules version with the game so later changes do not reinterpret earlier results.

A move command carries `gameId`, `requestId`, `expectedVersion`, `from`, `to`, and an optional `promotion`. Derive the acting player from the authenticated session. Never trust a client-supplied player ID, FEN, clock value, or result as authoritative.

1. Authorize the session, validate the message, and record the server time at entry to the game's serialized command queue. Moves and time-expiry checks use that same queue so they cannot reach contradictory results.
2. Lock the game row in a short transaction. Look up the request receipt using the game, actor, and request ID. Return the original outcome for an identical retry; reject reuse of the ID with a different payload.
3. For a new request, check game status, expected version, and whose turn it is. Check the deadline under the chosen clock rule, then move legality. An expired clock takes precedence. An illegal move does not reset the start of the turn.
4. Save the move, position, both clocks, side to move, and new version. If the move ends the game, save the result and reason in the same transaction, along with the request receipt.
5. Commit before acknowledging success. Then send the confirmed event, including the move, version, clocks, and status, to both players. If the write fails, recover from durable state instead of continuing from an uncommitted position in memory.

Retries can therefore have one effect in the database even when messages are delivered more than once. This is not a promise of exactly-once network delivery. A client keeps a move pending until confirmation. A stale version triggers resynchronization rather than applying the requested move to an unexpected position.

A timestamp for a new turn cannot precede that turn's start, even if a request arrived early. The queue preserves order while a write is committing. The precise treatment of server processing time and deadline boundaries must be settled and tested before implementing the clock; a client timestamp can never extend its deadline.

## Clocks and recovery

The initial proposal stores time and increment as integer milliseconds. Both players confirm readiness before the clock starts; only the side to move loses time. The server remembers the remaining time and start of each turn, subtracts elapsed time for an accepted legal move, then adds the increment once. The proposed boundary is that `remaining <= 0` means expiry before accepting the move. Whether expiry is a win or a draw when mate is impossible depends on the chosen game rules.

A server timer triggers an expiry check even when no messages arrive. The timer itself is not the final decision: the handler must lock and recheck the game because a move may already have changed it. Persist clocks and their time reference on accepted state transitions rather than writing a countdown every second.

Measure elapsed time with a monotonic clock inside the live process so a wall-clock correction does not change a result. Also persist a UTC time reference or deadline for recovery. A monotonic reading cannot be reused after a restart or on another host.

Before implementing outage recovery, choose whether an active game keeps consuming time during a server outage, pauses, or is aborted/voided. Test that policy with crashes before and after a database commit and with changes to system time. Restoring a saved clock number alone cannot guarantee a fair continuation.

The starting proposal has no network-latency compensation. Measure event-loop delay and database write time, and keep engine work out of the game process. The client receives remaining times and a server time reference, interpolates a countdown, and periodically corrects it. Reaching zero locally does not authorize it to declare a winner.

A client disconnect would not pause the clock under the proposal. On reconnect, verify the same identity and return a versioned snapshot plus missing history. The client discards old or duplicate events and requests fresh state when it detects a version gap. A lost acknowledgment is recovered by retrying the same request ID. A committed move whose broadcast was lost is recovered from the database; periodic version checks also catch missing events on a connection that still appears healthy. Socket.IO recovery can help, but it must not be the only recovery path.

## Store enough to reproduce the game

The proposed data model separates the game history from the information needed to authorize and recover commands:

- **Identity and session:** guest or registered identity, expiry, and access rights. A public game ID does not grant permission to play.
- **Challenge:** creator, time control, rated status, state, expiry, and invitation token. Acceptance is atomic and one-time.
- **Game:** both players and colors, status, starting FEN, time control and explicit rating pool, rated status, rules/state versions, clocks and time reference, result/reason, and start/end times. Add an optional tournament reference later.
- **Move:** game ID, half-move number (`ply`), UCI move including promotion, SAN, server time, clocks after the move, and optionally FEN. Enforce a unique `(gameId, ply)` pair.
- **Command receipt:** actor, request ID, payload fingerprint, outcome, and resulting version. A uniqueness constraint makes retry handling durable.
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

Authorize every command, not just the initial connection. Bind a session to its seat, use unpredictable invitation tokens with limited lifetimes, and accept each invitation atomically. The proposed session mechanism is HttpOnly/Secure/SameSite cookies over HTTPS/WSS, with WebSocket origin checks and CSRF protection for HTTP commands. Limit message size and frequency and the number of open challenges. Keep secrets and tokens out of logs and Git; `.env` remains local.

The proposed deployment is a static web client, one long-running server behind a WebSocket-capable proxy, and PostgreSQL with backups. Avoid hosting that sleeps the game process or cuts active connections. Drain before deployment by stopping new challenges and letting games finish, or apply the agreed outage policy. Adding replicas is not enough to make game ownership safe.

Monitor move-acknowledgment latency, event-loop lag, transaction duration, rejected/duplicate commands, reconnects, clock corrections, and background-job failures. Correlate logs with game and request IDs without including secrets. Agree on load targets, retention, alert thresholds, region, costs, and backup/restore objectives before public release. Test restoring saved games as part of the first playable milestone.

When measured load requires several game servers, give each active game one owner and add routing, ownership leases, and fencing so an old owner cannot keep writing after a handover. A Redis adapter can distribute notifications; it does not itself establish game ownership, a distributed clock, or durable history. Database constraints remain a final defense against concurrent confirmations. Analysis computation is already isolated for clock safety; further service separation should solve a measured problem.

## How to validate the design

Use domain tests with controlled time, integration tests against a real database, and a complete flow in two browser contexts. Focus on concurrent moves, a move racing expiry, duplicate requests, a commit followed by a lost broadcast, disconnects, restarts, and archive reconstruction. Then test rating and round consumers with repeated events. Measure load before claiming bullet reliability, because short controls expose server delays most clearly.

The [open choices](product-spec.md#choices-still-open) separate decisions needed before implementation from those needed for later features. Record the initial choices before adding dependencies; this proposal does not settle them.

## Technical references

These sources explain the tools behind the proposal. They do not prescribe our product rules.

- [Node.js release policy](https://nodejs.org/en/about/previous-releases): supported LTS releases.
- [Vite guide](https://vite.dev/guide/) and [Fastify documentation](https://fastify.dev/docs/latest/): client tooling and API framework.
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/): ordering, delivery limits, and application-level recovery.
- [chess.js documentation](https://jhlywa.github.io/chess.js/): move validation, notation, and game representation.
- [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html): protecting concurrent updates within transactions.
- [The Glicko author's documentation](https://www.glicko.net/glicko.html): methodology and reference calculations.
- [Official Stockfish distribution](https://stockfishchess.org/download/): a starting point for selecting the engine package.
