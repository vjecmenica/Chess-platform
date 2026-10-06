# Roadmap

The first complete flow is a game over a challenge link, followed by a saved replay. That creates the reliable game history needed for the project's other core feature: analysis. Interactive engine analysis and full game review come before Swiss tournaments in this proposed sequence.

The development environment, domain move validation, results, and an in-memory 5+3 clock are implemented. The server now stores guest sessions, challenge seats, standard-start games, moves, a clock-start mode, authoritative clock deadlines, and retry receipts in PostgreSQL. A minimal board shows confirmed moves and server clock snapshots, receives server-pushed game-update signals, and recovers after refresh. Finished games have replay controls, a browser-local variation tree, optional local Stockfish evaluation of the selected position, and a first browser-local full-game review. Complete result commands, accuracy scoring, server-backed reviews, and tournaments remain future work. Mating-possibility detection is conservative: casual timeouts draw only on a sound no-mate proof and otherwise finish as flag forfeits. Exact FIDE adjudication remains future competitive work. Product rules and open choices live in the [specification](product-spec.md); the [architecture](architecture.md) explains the implementation and later proposals.

## Agree on the starting scope

The initial stack is chosen: TypeScript, npm workspaces, React + Vite, Fastify, PostgreSQL, and separate domain/contracts packages. The first playable flow uses secure guest sessions and a casual 5+3 challenge. New games give White 30 seconds for the first move after Black accepts. Neither regular clock runs before White's first move; Black's regular clock and own 30-second first-move deadline start together after that move commits. Missing either first-move deadline aborts the game without a winner. Saved Ready-based games retain their original rule. Once running, clocks continue through disconnects and server outages; recovery uses the saved UTC deadline. The [game rules](game-rules.md) record implemented results and detector limits. The [adjudication decision](adjudication-design.md) describes the claim procedure and the casual timeout policy, including its limits.

## First playable milestone

Take these steps in order, keeping each change small enough to demonstrate on its own.

1. **Set up the development environment — implemented.** The web/server workspaces, locked dependencies, PostgreSQL configuration, health checks, and initial migration are in place. A clean checkout must install and start using the README, pass server and database health checks, and need no secrets committed to Git. Use `npm run db:check`, `npm run db:migrate`, and `npm run test:db` to verify a PostgreSQL installation; a working page alone does not verify migration rollback.
2. **Validate moves — implemented.** The domain API exposes a standard starting position, current FEN and side to move, legal destinations for a selected piece, move submission with optional promotion, and ordered replay history. Deterministic tests cover legal and illegal moves, wrong turns, king safety, both castling directions and lost rights, en passant expiry, and promotion choices. Every rejected request leaves position, turn, and history unchanged. See the [domain API](../packages/domain/README.md). The separate game API now owns results; the position API remains usable for replay.
3. **Add results and clocks — domain rules and persisted 5+3 move/timeout path implemented; step still open.** The game API handles automatic fivefold/75-move draws, threefold/50-move claims, dead-position proofs, resignation, agreement, and flag fall. The server persists explicit draw offers and responses. Resignation finishes in its ordered receipt transaction under the documented casual concession policy; casual timeouts now finish at flag fall under an explicit policy. The server persists the new grace deadlines, older free-first-move and readiness modes, remaining time, UTC deadlines, accepted moves, results, flags, and ordered receipts. Incorrect claims now persist their intended move, offer, pause, and time bonus. Migration 011 finalizes historical pending timeouts. Exact mating-possibility adjudication and broader recovery testing remain before competitive timed play.
4. **Create and accept a challenge — implemented for guests.** The creator owns White, and one other guest can accept Black through a shareable link. PostgreSQL enforces distinct seats and deduplicated creates; acceptance atomically fills Black and creates exactly one game. New games need no Ready action: White has 30 seconds to make the free first move. Black's regular clock and own 30-second first-move deadline start after that move commits. Saved Ready-based games keep their existing action and clock rule.
5. **Exchange confirmed moves — committed game-update stream implemented.** The board submits domain-validated moves with a version and request ID, displays only confirmed changes, and reloads on server-pushed updates or focus for the opponent's moves and clock status. Click, keyboard, mouse drag, and touch drag use the same move path; promotion is selected before submission. Selecting a piece shows legal destinations and distinguishes captures, including in local analysis. Stale versions trigger a reload. The stream reconnects and reloads the confirmed game; four-second polling runs only while it is unavailable. Add an explicit connection-status display later. A pending move must remain visibly unconfirmed until the server accepts it.
6. **Make the state durable — timed moves, claims, resignation, and offers implemented; competitive adjudication still open.** Each player command is admitted to a durable receipt before it competes with a flag. A move's position, version, and clock handoff commit together, with an increment only after the free first move; a second transaction starts the opponent's clock and completes the durable response. Saved moves and actions, including a crashed handoff, can be recovered after restart. Rejected requests have durable outcomes. Casual timeout results commit with the flag; test failed writes and racing completion commands more broadly.
7. **Recover interrupted sessions — timed HTTP refresh and restart recovery implemented; broader recovery still open.** Reloading the challenge page reads saved history and clocks for the same guest cookie. An overdue clock is flagged at its saved deadline after restart, not at callback time. Test disconnection before and after acknowledgment, a committed move whose delivery was lost, clock skew, backup restoration, and reconnect gaps before the first playable milestone is complete.
8. **Replay the finished game — implemented.** A finished game shows its result and ordered moves. Start/previous/next/end controls and clickable moves display each saved half-move without changing the game or its clocks. The final replay frame matches the confirmed position. A fresh page or server read reconstructs replay from persisted history; the two-browser manual check in the README covers a completed game.

The milestone is complete when all [first playable acceptance criteria](product-spec.md#first-playable-milestone) pass. Verify the full flow in two browser contexts, use a real test database for transactions, and test races and clock boundaries with controlled time. Include a backup restore check and measure latency against the agreed targets before public release.

## Accounts, ratings, and matchmaking

Build accounts and archive ownership first, then expose all 16 time controls and the rated/casual choice. Document Glicko-2 parameters and rating periods before adding calculations. A reference calculation must pass; an eligible result must affect only its pool, once, and casual results must leave every rating unchanged.

Next, add matchmaking in three small changes: exact time-control/type queues, rating-range expansion, and cancellation with concurrent reservations. Tests must show that elapsed time widens the search without changing the selected control or type. No self-pairing, double reservation, or match from a canceled request is allowed.

This is the proposed order, not an analysis dependency: once saved games and the required access controls exist, analysis work can proceed without waiting for matchmaking.

## Interactive engine analysis

The saved-game analysis board keeps the original moves and a browser-local tree of alternative legal moves. Saved moves use White and Black columns. Consecutive variation moves stay inline; only real forks add indentation. Comments, PGN NAGs, local line promotion, board orientation, and per-position colored arrows and square marks survive a refresh in the same browser without changing the saved game. A player can branch from any saved or explored position, navigate every branch, and delete a branch after confirmation. Analysis is available only after the game finishes. A player may start a single-threaded Stockfish Web Worker for an evaluation, best move, and one to five ranked principal variations of the selected saved or explored position. The default remains one line and a depth-14, 1.2-second limit. Players can choose depth-only, time-only, both, or an explicit unlimited search. Changing positions cancels the old search; completed bounded results are cached by settings. Unlimited or longer searches can use noticeable CPU and battery on mobile devices. Full-game review retains its fixed single-line budget. The [bundled engine notice](../apps/web/public/engine/NOTICE.md) records its GPLv3 license and exact source.

Completion means that lines are legal for the selected position, evaluation perspective is clear, and the player can explore multiple lines. An active player must not obtain advice through either the UI or a direct server request under the chosen policy. Engine work must not delay active-game clocks. Account support is needed here only if the chosen access policy requires it.

## Full game review

The first review is browser-local. On request, it scans the saved main line position by position, reuses completed engine evaluations, shows progress, and can be cancelled. A completed review shows a White-perspective evaluation graph and per-move CPL with the provisional `local-cpl-v1` labels documented in the [product specification](product-spec.md). Mate scores have no numeric CPL. The work remains single-threaded and bounded per position, though a long game may still take minutes on a mobile device.

Next define and validate an accuracy formula, then decide whether richer review needs a server job. A future job needs durable progress, resource limits, versioned results, retry deduplication, and a fixed validation set. It must leave replay and local analysis usable when it fails. Full review still comes before Swiss tournaments in the product sequence.

## Swiss tournaments

Schedule this work after interactive analysis and full review. It reuses the game, persistence, identity, and rating systems; it does not require matchmaking.

1. Add creation and registration with the name, capacity, time control, round count, start time, and rated/casual setting.
2. Implement and test the chosen Swiss pairing and scoring rules separately from live games.
3. Run one round using the existing game flow and collect its results.
4. Add later rounds, breaks, standings, and an explained duration estimate.

A simulated tournament must cover an odd player count, byes, withdrawals, no-shows, and tied standings according to the selected rules. Every game must inherit the organizer's rating choice. The next round must start only after all current results are resolved and the break has elapsed. Duplicate events or a restart must not generate a second pairing set, a second next round, or duplicate rating changes.

## Puzzles and later extensions

**Puzzles:** start with an appropriately licensed collection, verified solutions, move checking, and progress. Later, use full game review to find practice positions in a player's own games. Incorrect moves must be handled consistently, and private positions must retain the source game's access rules.

**AI explanations:** build on engine analysis. Define the information passed to the explanation service, validate any proposed lines, and then add the explanation interface. Illegal or unverified lines must not appear as confirmed advice. Service failure must not block replay or engine analysis, and active-game restrictions still apply. Choose the service and privacy policy before sending it personal game data.

**Custom challenges:** after standard controls and ratings work, agree on custom limits, pool assignment, and rated eligibility. Validate boundary values and show the rules before the opponent accepts. Keep custom challenges out of standard matchmaking queues.

## Finishing a step

Record the demonstration or test result and update the affected documentation. Changes to clocks, persistence, ratings, and round progression need failure and retry tests as well as a successful example. Measure capacity before making performance claims, especially for bullet games.
