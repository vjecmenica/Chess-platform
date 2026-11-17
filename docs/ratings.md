# Glicko-2 ratings and settlement

Phase 1 provides Glicko-2 calculations and per-account ratings. Phase 2A settles eligible results in the game transaction. Phase 2B adds Rated/Casual selection, with Rated creation available only in explicitly enabled development environments. Public production games and historical challenges remain Casual.

## Creating and accepting challenges

Casual is the default and supports guests. For local Rated testing, set `ENABLE_DEV_RATED_CHALLENGES=true` and restart the API. The flag defaults to off and is ignored when `NODE_ENV=production`. The API enforces it for creating Rated invitations and accepting open Rated invitations. Accepted games can resume and settle after the flag is turned off.

Migration `030_rated_challenges.sql` stores the selected mode and, for Rated invites, the creator's account ID. The creator and acceptor each authenticate with an account session to occupy a Rated seat. The seats must belong to different registered accounts. The acceptance transaction assigns Black and inserts the game with the two account IDs and the pool for the fixed time control. The account IDs then govern game access and settlement across sessions. Retrying a creation key with different terms returns a conflict.

Rated rematches are unavailable during this phase. Casual rematches continue through the existing workflow.

## Adjudication and first moves

Development Rated games use the domain's `fide_proof_required` resignation and timeout policies. Phase 2C adds durable processing for unresolved mating decisions. Both clocks stop while an isolated worker searches for a verified witness. An inconclusive case stays pending for authorized review, and ratings remain untouched. The operator CLI can submit a verified witness. Cases requiring a negative judgment beyond the domain's proven rules remain unresolved. [Adjudication and review procedure](adjudication-design.md#rated-recovery-and-operator-review)

Both modes use the existing 30-second first-move grace period. A missed first-move deadline aborts the game and leaves ratings untouched. A voluntary resignation received before the deadline follows the applicable resignation policy even at ply zero. It can remain pending in a Rated game. Disconnect forfeits remain separate work.

## Parameters and pools

| Parameter | Value |
| --- | --- |
| Initial rating | 1500 |
| Initial rating deviation (RD) | 350 |
| Initial volatility | 0.06 |
| Tau (volatility change constraint) | 0.5 |
| Volatility convergence tolerance | 0.000001 |
| Provisional rating | Effective RD strictly greater than 110 |
| Base inactivity period | 24 hours |
| Maximum effective RD | 350 |

Each account starts with the same parameters in each pool. The pools evolve independently. The assignments below match the product specification and the supported preset IDs.

| Pool | Presets |
| --- | --- |
| Bullet | 1+0 |
| Blitz | 3+0, 3+2, 5+3 |
| Rapid | 10+0, 10+2, 10+5, 15+0, 15+2, 15+5 |
| Classical | 20+0, 20+10, 25+0, 25+10, 30+0, 30+10 |

## Rating periods and immediate updates

`calculateGlicko2Period` implements the official batch algorithm. All opponents are evaluated from their pre-period rating and RD. The algorithm uses scores of 1 for a win, 0.5 for a draw, and 0 for a loss. It solves for updated volatility and adds one period of variance before the posterior rating and RD update. An empty period increases RD using the current volatility. The batch primitive is separate from the account RD cap. The tests compare against the worked example within the precision of the published intermediate rounding. [Mark E. Glickman's Glicko-2 specification](https://www.glicko.net/glicko/glicko2.pdf)

`rateGame` is the immediate-update policy. It calculates both players' effective RD at the same explicit settlement time, then uses the Glicko-2 result and volatility formulas on the two pre-result states. Only elapsed time contributes process variance. Two games at the same timestamp add zero time-based variance between them. Newly calculated volatility governs subsequent inactivity.

Effective RD is calculated on demand as `min(350, sqrt(RD² + (173.7178 × volatility)² × elapsedDays))`. Elapsed days are fractional 24-hour periods since the last rated activity. An unrated account starts at RD 350 with no activity timestamp. Reads leave the persisted state untouched, so repeating a read does not compound the adjustment. Each applied rated result stores the new RD and advances the timestamp together. Inactivity leaves rating, volatility, and the game count unchanged.

Calculations retain floating-point precision. Only presentation should round. Invalid scores, non-finite values, nonpositive RD or volatility, and invalid timestamps are rejected. Time inputs are nonnegative Unix milliseconds. Times earlier than the stored anchor are rejected. The volatility solver bounds both bracketing and convergence and fails explicitly for inputs outside the supported numerical range.

## Storage and settlement

Migration `028_account_ratings.sql` creates `chess.account_ratings`, keyed by account ID and pool, with cascade deletion. Rating, RD, and volatility use double precision. The row also stores an integer rated-game count and a nullable timestamp that anchors inactivity. The constraints enforce supported pools, finite values, bounded RD, and agreement between the count and the presence of a valid activity timestamp.

`loadOrCreateAccountRating` initializes the requested pool on first use. Registration and migration require no backfill. The primary key and conflict-safe insert protect concurrent initialization under PostgreSQL's Read Committed isolation.

Migration `029_rated_game_settlement.sql` adds the rated flag, both account IDs, and the rating pool to the game. Rated terms can only be set when inserting a timed game with two distinct registered accounts that match its accepted seats and a pool that matches the preset. The terms are immutable after insertion. Settlement uses those account IDs, even if a guest seat's account link later changes. Foreign keys prevent deletion of an account while a rated game references it.

The game service saves the authoritative final result, updates both ratings, and writes the settlement in one Read Committed transaction. A White win scores 1 for White and 0 for Black, a Black win reverses those scores, and a draw scores 0.5 for each. The result's reason is preserved in history. Casual, aborted, unfinished, and pending adjudication games are skipped. The same persistence path handles moves, draw claims and agreements, resignation, clock expiry, and final adjudication. A delayed ruling also commits its witness and audit record in that transaction.

Settlement locks the game first, then checks for a committed settlement. It initializes and locks each involved rating row in ascending account UUID order before reading the next row. Rating locks are scoped to the pool. The database clock is sampled after both locks, with the settlement time floored at the newer activity anchor to handle clock regression. Replay can reproduce the resulting states from the recorded inputs and this timestamp.

`chess.game_rating_settlements` stores one row per game, keyed by game ID. It includes the pool, account IDs, final result, timestamp, policy version, and both full pre- and post-settlement rating states. The pre-states include the original inactivity anchors. A deferred database check requires a matching settlement before a finished rated result can commit.

A failed transaction rolls back the final game transition, both rating changes, history, and any command completion. A previously admitted command remains pending and can be retried by the existing receipt processor after restart. Due clocks likewise remain eligible for processing after rollback. Repeated processing, including across instances, sees the committed settlement under the game lock. PostgreSQL publishes game notifications on commit, and notification delivery is independent of rating durability.

Deployments require migration `031` before starting the updated API. Public Rated creation remains gated pending adjudication coverage, operational review procedures, infrastructure recovery, disconnect handling, fair-play protections, and Rated rematch policy. Rating displays and administrative correction tools are separate work.
