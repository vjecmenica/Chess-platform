# Glicko-2 ratings and settlement

Phase 1 provides pure rating calculations, preset-to-pool mapping, and PostgreSQL storage for account ratings. Phase 2A settles eligible rated results in the game transaction. Public Rated/Casual selection and rated challenge creation are Phase 2B work. Public games and historical results remain Casual.

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

The game service saves the authoritative final result, updates both ratings, and writes the settlement in one Read Committed transaction. A White win scores 1 for White and 0 for Black, a Black win reverses those scores, and a draw scores 0.5 for each. The result's reason is preserved in history. Casual, aborted, unfinished, and pending adjudication games are skipped. The same persistence path handles moves, draw claims and agreements, resignation, and clock expiry. Current adjudication rules still apply. A future delayed adjudicator must save the final result and call settlement in the same transaction.

Settlement locks the game first, then checks for a committed settlement. It initializes and locks each involved rating row in ascending account UUID order before reading the next row. Rating locks are scoped to the pool. The database clock is sampled after both locks, with the settlement time floored at the newer activity anchor to handle clock regression. Replay can reproduce the resulting states from the recorded inputs and this timestamp.

`chess.game_rating_settlements` stores one row per game, keyed by game ID. It includes the pool, account IDs, final result, timestamp, policy version, and both full pre- and post-settlement rating states. The pre-states include the original inactivity anchors. A deferred database check requires a matching settlement before a finished rated result can commit.

A failed transaction rolls back the final game transition, both rating changes, history, and any command completion. A previously admitted command remains pending and can be retried by the existing receipt processor after restart. Due clocks likewise remain eligible for processing after rollback. Repeated processing, including across instances, sees the committed settlement under the game lock. PostgreSQL publishes game notifications on commit, and notification delivery is independent of rating durability.

Production deployment requires migration `029` before starting the new server. Phase 2B will add authenticated rated challenge creation and Rated/Casual selection. Disconnect forfeits and administrative correction tools are separate work.
