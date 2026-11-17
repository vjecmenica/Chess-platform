# Glicko-2 rating foundation

Phase 1 provides pure rating calculations, preset-to-pool mapping, and PostgreSQL storage for account ratings. Rated game creation and settlement are pending. Existing games remain unrated, and historical results are excluded from rating calculations.

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

`rateGame` is the immediate-update policy for future settlement. It calculates both players' effective RD at the same explicit settlement time, then uses the Glicko-2 result and volatility formulas on the two pre-result states. Only elapsed time contributes process variance. Two games at the same timestamp add zero time-based variance between them. Newly calculated volatility governs subsequent inactivity.

Effective RD is calculated on demand as `min(350, sqrt(RD² + (173.7178 × volatility)² × elapsedDays))`. Elapsed days are fractional 24-hour periods since the last rated activity. An unrated account starts at RD 350 with no activity timestamp. Reads leave the persisted state untouched, so repeating a read does not compound the adjustment. Each applied rated result will store the new RD and advance the timestamp together. Inactivity leaves rating, volatility, and the game count unchanged.

Calculations retain floating-point precision. Only presentation should round. Invalid scores, non-finite values, nonpositive RD or volatility, and invalid timestamps are rejected. Time inputs are nonnegative Unix milliseconds. Times earlier than the stored anchor are rejected. The volatility solver bounds both bracketing and convergence and fails explicitly for inputs outside the supported numerical range.

## Storage and settlement

Migration `028_account_ratings.sql` creates `chess.account_ratings`, keyed by account ID and pool, with cascade deletion. Rating, RD, and volatility use double precision. The row also stores an integer rated-game count and a nullable timestamp that anchors inactivity. The constraints enforce supported pools, finite values, bounded RD, and agreement between the count and the presence of a valid activity timestamp.

`loadOrCreateAccountRating` initializes the requested pool on first use. Registration and migration require no backfill. The primary key and conflict-safe insert protect concurrent initialization under PostgreSQL's default Read Committed isolation. The helper only loads or initializes ratings.

Future settlement must verify two distinct registered accounts and a supported preset on a completed rated game. Casual and aborted games never modify ratings. Disconnect forfeits will be implemented separately. The settlement transaction must serialize overlapping updates to account pools, read both pre-result states under lock, and atomically record the two updates and a unique settlement record for the game. Store pre- and post-result states and the calculation policy version in rating history for audits and future corrections. Repeated settlement attempts must produce exactly one durable result.
