# Roadmap

The first complete flow is a game over a challenge link, followed by a saved replay. That creates the reliable game history needed for the project's other core feature: analysis. Interactive engine analysis and full game review come before Swiss tournaments in this proposed sequence.

The development environment, domain move validation, results, and an in-memory 5+3 clock are implemented. Mating-possibility detection covers proven material and closed pawn cases. Flag fall now records a final draw, a witnessed win, or a frozen pending timeout, with its side and effective deadline. A separate bounded search can find verified mate lines for pending resignations or timeouts, but it cannot prove impossibility. The maintainer has confirmed the Windows setup runs with PostgreSQL and the web page is visible. Durable clocks and adjudication, online play, analysis, and tournaments remain future work. Product rules and open choices live in the [specification](product-spec.md); the [architecture](architecture.md) explains the implementation and later proposals.

## Agree on the starting scope

The initial stack is chosen: TypeScript, npm workspaces, React + Vite, Fastify, PostgreSQL, and separate domain/contracts packages. The first playable flow will use secure guest sessions and a casual 5+3 challenge. Its clock starts when both authorized players are ready. The [game rules](game-rules.md) record implemented results and detector limits. The [adjudication decision](adjudication-design.md) specifies the remaining durable claim and pending-result procedure. Set the server-outage policy before implementing reconnect and restart handling. Board selection and deployment planning can proceed when those features need them.

## First playable milestone

Take these steps in order, keeping each change small enough to demonstrate on its own.

1. **Set up the development environment — implemented.** The web/server workspaces, locked dependencies, PostgreSQL configuration, health checks, and initial migration are in place. A clean checkout must install and start using the README, pass server and database health checks, and need no secrets committed to Git. Use `npm run db:check`, `npm run db:migrate`, and `npm run test:db` to verify a PostgreSQL installation; a working page alone does not verify migration rollback.
2. **Validate moves — implemented.** The domain API exposes a standard starting position, current FEN and side to move, move submission with optional promotion, and ordered replay history. Deterministic tests cover legal and illegal moves, wrong turns, king safety, both castling directions and lost rights, en passant expiry, and promotion choices. Every rejected request leaves position, turn, and history unchanged. See the [domain API](../packages/domain/README.md). The separate game API now owns results; the position API remains usable for replay.
3. **Add results and clocks — domain rules and in-memory 5+3 timeout adjudication implemented; step still open.** The game API handles automatic fivefold/75-move draws, threefold/50-move claims, dead-position proofs, resignation, agreement, and flag fall. An unresolved resignation or timeout freezes the game; a separate bounded search may find a verified mate witness. The clock owner starts after both sides are ready, stamps and serializes moves and resignations, applies increment once, and records one flag event at the effective deadline. Next implement the [durable adjudication flow](adjudication-design.md#resolving-a-resignation-online), persist clock transitions and command receipts atomically, and add the incorrect-claim procedure with its forced intended move, offer, pause, and time bonus. Controlled-time tests still need to cover durable retries, claims around the deadline, processing across commits, and restart recovery. An unresolved case must never publish a final result.
4. **Create and accept a challenge.** Bind the two seats to authorized sessions and show a simple board. Two simultaneous acceptances must not create a third player, and an unrelated session must not move for either participant.
5. **Exchange confirmed moves.** Connect two browser sessions and display the confirmed position, clocks, and connection status. Wrong-player and stale-version commands must be rejected. A pending move must remain visibly unconfirmed until the server accepts it.
6. **Make the state durable.** Save each move, state version, clocks, request receipt, and any result atomically before acknowledgment. Restart after an acknowledgment must not lose the move. Failed writes, duplicate requests, and racing completion requests must not create false confirmations or a second result.
7. **Recover interrupted sessions.** Restore the same authorized player's state after reconnect or refresh. Test disconnection before and after acknowledgment, a committed move whose broadcast was lost, and a server restart. State and clocks must converge under the agreed outage policy, including when the connection appears healthy but an event was missed.
8. **Replay the finished game.** Add the result, move list, and start/previous/next/end controls. Two players must complete a game, reopen it after a restart, and reproduce the position at every half-move.

The milestone is complete when all [first playable acceptance criteria](product-spec.md#first-playable-milestone) pass. Verify the full flow in two browser contexts, use a real test database for transactions, and test races and clock boundaries with controlled time. Include a backup restore check and measure latency against the agreed targets before public release.

## Accounts, ratings, and matchmaking

Build accounts and archive ownership first, then expose all 16 time controls and the rated/casual choice. Document Glicko-2 parameters and rating periods before adding calculations. A reference calculation must pass; an eligible result must affect only its pool, once, and casual results must leave every rating unchanged.

Next, add matchmaking in three small changes: exact time-control/type queues, rating-range expansion, and cancellation with concurrent reservations. Tests must show that elapsed time widens the search without changing the selected control or type. No self-pairing, double reservation, or match from a canceled request is allowed.

This is the proposed order, not an analysis dependency: once saved games and the required access controls exist, analysis work can proceed without waiting for matchmaking.

## Interactive engine analysis

Start with the saved-game analysis board and access policy. Then add engine on/off controls and evaluations, followed by multiple candidate lines and resource limits. Choose where the engine runs before integrating it; that choice affects both cost and enforcement of the active-game advice restriction.

Completion means that lines are legal for the selected position, evaluation perspective is clear, and the player can explore multiple lines. An active player must not obtain advice through either the UI or a direct server request under the chosen policy. Engine work must not delay active-game clocks. Account support is needed here only if the chosen access policy requires it.

## Full game review

First write and validate the accuracy and move-label methodology. Then build a bounded background job, and finally show the review with its engine and methodology versions. Full review depends on the analysis infrastructure, not on tournaments or AI.

Use a fixed set of games to verify results within a documented tolerance. Cover mate evaluations and label boundaries with worked examples. A retry must reuse or replace the intended result without creating duplicates. A failed job must leave the saved game and ordinary replay available.

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
