# Adjudication and online command policy

The [FIDE Laws of Chess](https://handbook.fide.com/chapter/e012023) define mate possibility as mate after *some* legal sequence, even if the defender helps. The same question governs dead positions (5.2.2), resignation (5.1.2), and flag fall (6.9). This decision also applies articles 9.1–9.5 to online draw claims. The rules below are selected for the planned online game; they are not a claim of full FIDE compliance.

## Deciding whether mate is possible

Use three answers for each side: `impossible` with a sound proof, `possible` with a verified legal move sequence ending in its checkmate, and `unresolved`. Replay a positive witness through the full game lifecycle; a sequence that crosses an earlier automatic result is not a valid witness. An engine score, material count alone, or failure to find a mate never proves the other answer. The synchronous game rules have material proofs, a complete search for some closed pawn positions, and a one-move mate witness. They return `unresolved` otherwise.

Casual games use `casual_concession`. A proven impossibility draws. A possible or unresolved mating query awards the opponent a win under the Casual concession policy, and both clocks stop. Rated games use `fide_proof_required`. A proven impossibility draws, a verified mating possibility awards a win, and an unresolved resignation freezes the game for adjudication. [FIDE Article 5.1.2](https://handbook.fide.com/chapter/e012023)

Casual timeouts use `casual_flag_forfeit`. A proven impossibility draws and other flags award an opponent win in the flag transaction. Rated timeouts use `fide_proof_required` and keep unresolved flags pending. The recorded flag side and deadline carry through any later ruling. [FIDE Article 6.9](https://handbook.fide.com/chapter/e012023)

| Approach | Correctness | Cost and fit |
| --- | --- | --- |
| Sound material rules and closed-position search | A negative answer is safe; coverage is incomplete. | Fast and maintainable in the domain; keep as the first pass. |
| Bounded cooperative search | A replayed legal mate line proves `possible`. Exhaustion leaves the case unresolved. | Runs outside the live Rated command path. |
| Exact reachable-state search or a cooperative endgame database | Exhausting every legal successor proves a negative, and a path proves a positive. | Useful for small, closed classes; building, storing, and verifying general coverage is too costly for the initial game server. |
| Chess engine evaluation or Syzygy WDL/DTZ alone | A drawing evaluation or perfect-play result cannot rule out a cooperative mate. | Useful for finding candidate lines, never as a negative certificate. Every proposed line must be replayed legally. |

`findResignationMateWitness` and `findTimeoutMateWitness` try known opening lines and then search legal continuations in deterministic order. The server keeps the default limits of seven plies and 5,000 visited nodes. Each candidate must survive full-history replay, including fivefold repetition, the 75-move rule, and other automatic endings. Engine evaluation, perfect-play tablebase values, and exhausted search do not establish impossibility.

## Resolving a resignation online

The guest server authenticates and orders resignation against moves and flags, then saves its action, receipt, final result, and stopped clock atomically. Both seats see the finished game on their next read. Migration 008 converts older pending resignations to opponent wins; those rows existed only where the old detector returned `unresolved`. Positions it proved impossible were already final draws. Historical verified witnesses remain stored for audit, but new resignations need no worker or extra result version.

Rated resignation uses the same ordered receipt transaction to stop clocks and persist the original resignation. A ruling from the immediate detector commits there. An unresolved resignation creates a durable adjudication case. This includes a voluntary resignation at ply zero received before the first-move deadline. A missed first-move deadline still aborts the game without a rating change.

## Resolving a timeout online

The guest server records the flagged side, effective UTC deadline, and final result in one row-locked transaction, then publishes an update after commit. Concurrent pollers can create only one flag. Migration 011 finalizes old pending timeout rows, including search-exhausted rows, under the casual policy and publishes the same update. Those rows were unresolved; proven no-mate positions had already finished as draws. The bounded background timeout worker is retired from the guest server. An engine score or exhausted search is never treated as a no-mate proof.

An unresolved Rated flag creates a durable adjudication case in the same transaction that freezes the clocks and records the original deadline. The background worker has no role in deciding which command arrived first.

Standard Syzygy results concern best play and the 50-move rule; they do not answer whether *either* side could help the other reach mate. Cooperative mate reachability is a hard search problem even on generalized boards. See the [Syzygy documentation](https://python-chess.readthedocs.io/en/latest/syzygy.html) and [research on helpmate complexity](https://arxiv.org/abs/2010.09271).

## Rated recovery and operator review

Migration `031_rated_adjudications.sql` creates one case per pending Rated game and queues already-pending Rated games. Cases record the original event kind and game version, processing status, attempts, diagnostic, search measurements, and any verified witness and decision attribution. The saved game and its original actions retain the FEN, flag or resignation, and played moves. The migration leaves finalized and Casual games alone.

Stop older API instances before applying migration `031` and start the upgraded API after it commits. The older binaries lack the new queue writes and cannot replay the new rulings.

The server shares the existing 500 ms poll cadence with an independent adjudication task. Each process runs one search at a time. PostgreSQL claims a due case with `FOR UPDATE SKIP LOCKED` and a 60-second lease. The processor snapshots the game under its row lock and releases the connection before handing search to a Node worker with an eight-second wall deadline and heap limits. Node, depth, or wall-time exhaustion sends the case to review. Temporary failures retry after five then ten seconds. After three attempts, including expired leases from crashed processes, the case goes to review. The worker checks the lease again when finalizing.

Local search samples found the starting-position resignation, an opening flag, and a resignation after three opening plies in 2–4 nodes and about 3–12 ms. A quiet eight-ply opening exhausted 5,000 nodes in about 3.9 seconds. These timings cover the search itself on one workstation.

A verified ruling is replayed against the locked game using the same domain commands that recreate the pending event. The ruling, final result, version increment, ratings, and settlement record commit together. PostgreSQL publishes the updated version after commit. Witness moves live in the case record. They never enter played move or clock history.

Use the internal CLI from a trusted operator host with database access. Set `ADJUDICATION_REVIEWERS` to an explicit comma-separated allowlist of OS usernames. The command verifies the OS username and uses the configured database credentials. There is no public adjudication API. Run `npm run build:packages` before using the CLI from a fresh source checkout.

```text
npm run adjudication -- list [AFTER_GAME_ID]
npm run adjudication -- show GAME_ID
npm run adjudication -- resolve GAME_ID WITNESS.json
```

`list` returns up to 100 review cases. `show` includes the position, prior moves, event and any saved ruling. For review, supply a JSON array of 1–256 moves with `from`, `to`, and optional `promotion` using `q`, `r`, `b`, or `n`. A verified mate settles a review case once and records the operator's OS username, evidence, timestamp, and policy version. Free-text judgments and negative overrides are unavailable. Cases that require a sound negative determination outside the domain's current proofs remain pending.

Before public Rated play, validate review coverage, a controlled negative-ruling process, clock continuity through infrastructure failures, and service capacity. The bounded closed-pawn proof can still visit up to 4,096 positions synchronously and needs separate load testing. The development gate remains off by default and disabled in production.

## Incorrect claims online

Treat a claim as one serialized, non-withdrawable command from the player to move. Authenticate the player, check the expected game version, and validate an indicated move's syntax and legality before registering the claim. A malformed or illegal indicated move is rejected as a command: the running clock continues, with no offer or bonus. This is an explicit online adaptation to prevent an invalid payload from pausing the clock. A legal claim whose repetition or move-count threshold is not met is an **incorrect claim**:

1. Stop charging the claimant's clock at the accepted claim's server receipt time while the server decides it. If the threshold is met, finish as a draw without playing the indicated move.
2. If the threshold is not met, add the applicable penalty to the opponent's *remaining* time exactly once. Article 9.5.3 says two minutes; Appendix A.3 changes Article 9 penalties to one minute in rapid, and B.3 applies that rapid rule to online blitz without the specified human arbiter supervision. Determine this from the FIDE time category (base time plus 60 increments), **not** the product's Glicko pool. All 16 currently listed controls fall below 60 minutes by that test, so the planned online setup adds **60 seconds**. If a future control reaches the FIDE classical category, use **120 seconds**. This is an online interpretation of the linked laws; do not label the platform FIDE certified.
3. The incorrect claim is also the claimant's draw offer under 9.1.2.3. It is never an automatic acceptance of an existing offer. Store offers by side so an incoming offer and the new claim offer can coexist. Only one offer per side remains active: a new claim replaces that claimant's earlier explicit offer. The authenticated responder therefore identifies the opponent's offer. An accepted move declines only the opponent's offer; an offer ends when declined, accepted, or the game ends.
4. If an intended move was given, execute that **same** validated move in the same serialized operation after the bonus. The claimant cannot change it. Apply the normal legal-move transition and increment once; check mate and automatic results before retaining the claim offer. The move declines an earlier opponent offer. If the claim had no indicated move, leave the board and turn unchanged, publish the claimant's offer, and resume the claimant's clock after adjudication.

Persist the claim receipt, pre-claim state, applicable clock change, any forced move, offers, and resulting version atomically. An identical request retry returns its stored outcome without a second bonus, move, or offer. The domain claim command still reports an unmet threshold without mutation; the guest server applies the documented incorrect-claim consequences in the same serialized receipt transaction. Rules for repeated nuisance claims and event-specific draw restrictions need separate moderation policy.

## Ordering with flag falls

The server, not the browser, assigns a player command's receipt time when the complete HTTP body reaches Fastify's `preValidation`, before asynchronous guest lookup. An ingress watermark on every live process holds back a flag while an earlier arrival is being authenticated or admitted. Authorized moves, resignation, and explicit draw actions enter a durable pending-receipt table before competing for the game row. Any server can replay those receipts by `(received_at, admission_id)` after a restart. A flag waits until every live watermark covers the instants before the saved deadline; it drains earlier receipts under the same row lock. A receipt **at or after** the deadline loses to flag fall. New casual games also have separate durable 30-second first-move deadlines: White's begins on acceptance, and Black's begins with its regular clock at the post-White-move handoff. The same receipt ordering protects an earlier legal first move from a late abort poll. At or after the first-move deadline, the game aborts without a win or loss; Black's normal clock continues concurrently until it moves or the game ends. Equal-millisecond commands use admission ID as their tie-breaker. Draw claims use this same receipt path. UTC epoch milliseconds survive restart; synchronized host clocks are required for cross-process ordering.

A successful move stops the mover's clock at its receipt. The move, increment, and a clock `handoff` state commit first; neither player is charged while that transaction runs. A second transaction writes the opponent's new start and deadline and completes the durable response. Its timestamp is taken before its brief commit, so that final commit latency is charged to the opponent by explicit policy. If the server crashes between transactions, another worker completes the handoff; no clock runs during the gap. Reject commands received before the new turn's start. A valid claim pauses time from receipt through adjudication; after an incorrect current-position claim, restart the same turn at the decision's confirmation time. An incorrect intended-move claim commits the forced move and starts the opponent's turn then. A flag result uses the same three-answer mating decision above; `unresolved` follows the explicit casual flag-forfeit policy in guest games. For the casual milestone, an already running clock continues through disconnects and outages using its saved UTC deadline.

The transport-free 5+3 clock still implements readiness, monotonic receipt stamping, FIFO processing, and in-memory duplicate IDs for domain use. The guest HTTP path persists new first-move grace deadlines, older free-first-move and readiness modes, pending receipts, ingress watermarks, timeout transitions, and restart-safe handoff. A 500 ms poll checks for expiry and pending work; a late callback records the original deadline. A flag saves a final no-mate draw or casual opponent win; it never runs mate-witness search live. Resignation and explicit draw actions share receipt ordering, and resignation finishes with stopped clocks at receipt time. Claims and their clock effects now use the guest HTTP flow; historical pending timeout rows are finalized by migration 011. An HTTP request lost before durable admission cannot be replayed after its process crashes. A live instance whose database lease expires during a prolonged outage and a host clock that jumps backward need stronger operational handling before public competitive play.
