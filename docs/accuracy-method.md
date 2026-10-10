# Local game accuracy v1

`local-win-accuracy-v1` estimates each player's accuracy from the evaluations
already collected by browser-local full-game review. It performs no extra engine
searches, makes no network request, and stores no new data. The existing engine
cache and `local-cpl-v1` move labels, CPL values, and graph are unchanged.

This is an independent implementation of the mathematical approach described on
the [Lichess accuracy page](https://lichess.org/page/accuracy), checked on October
10, 2026. That page gives the following equations and aggregation steps but does
not specify window sizing, alignment, edge handling, or zero-volatility behavior.
The conventions below are our explicit local v1 choices. This is not exact
Lichess parity; no Lichess source code was copied or ported.

## Position and move values

For a centipawn evaluation `c` in a player's perspective:

```text
WinPercent(c) = 50 + 50 * (2 / (1 + exp(-0.00368208 * c)) - 1)
Accuracy(before, after) = 103.1668 * exp(-0.04354 * (before - after)) - 3.1669
```

Stockfish reports from the side-to-move perspective. Convert each score to
White's perspective first, using that position's FEN turn field. Black's win
percentage is `100 - WhiteWinPercent`. Both evaluations for a move must use
the moving player's perspective: the post-move UCI score usually belongs to
their opponent and must be reversed. A reported improvement or unchanged winning
chance gives 100 accuracy; other results are clamped to 0–100. These conventions
also handle finite-search fluctuations and the equations' rounded coefficients.

For accuracy only, an engine mate score maps directly to 100% for the side with
the reported forced mate and 0% for the other side. Positive mate favors the
side to move; negative mate favors the opponent. `mate 0` means the side to move
has been checkmated. Mate distance does not affect the percentage. This is an
engine estimate, not a domain result ruling. We never invent a centipawn value
for mate; affected moves still have no numeric CPL and retain the **Mate score**
label. Losing or finding an engine-reported mate therefore changes accuracy's
win percentage without manufacturing a CPL value.

## Local volatility windows

Let `N` be the number of evaluated positions, including the initial position and
the position after every main-line half-move. Positions are indexed `0..N-1`.

```text
windowSize = min(N, max(3, min(9, ceil(sqrt(N)))))
windowStart(j) = max(0, min(N - windowSize, j - floor((windowSize - 1) / 2)))
```

For the move ending at position `j`, take `windowSize` consecutive White win
percentages starting at `windowStart(j)`. Center on the post-move position; an
even window has one more position following the center than preceding it.
At either boundary, shift the whole window inward instead of padding or shrinking
it. For games shorter than three positions, use all available positions. The
initial position participates, and both players' moves remain in the chronological
timeline. The square-root rule gives longer games more context while keeping
the computation bounded at nine positions per move.

The move's weight is the **population standard deviation** of those percentages:
`sqrt(sum((x - mean)^2) / windowSize)`. Using White's percentages does not favor
White: replacing every value with `100 - x` leaves standard deviation unchanged.
Windows are formed before separating the moves by player.

## Per-player aggregation

For each player's moves, compute:

```text
weightedMean = sum(moveAccuracy * moveWeight) / sum(moveWeight)
harmonicMean = moveCount / sum(1 / moveAccuracy)
gameAccuracy = (weightedMean + harmonicMean) / 2
```

A zero-volatility move has zero weight. If all that player's weights are zero,
use the arithmetic mean as the weighted-mean fallback. If any move accuracy is
zero, the harmonic mean is zero. The final value is bounded to 0–100. Internal
calculations retain precision; the UI rounds only the final score to one decimal.

Each player result carries the method version, move count, both component means,
and either a value or an explicit unavailable reason. A player who has not moved
gets no accuracy value, including in an empty game. A one-move game gives only
its mover a value. Missing/non-finite evaluations or invalid turn/mate values
make accuracy unavailable for both players who moved; v1 does not score a partial
timeline or bridge gaps when computing volatility. Review itself still requires
a complete, position-matched set of evaluations before showing its summary.

## Interpretation and validation

This is a local engine-based estimate of the reviewed moves, not an Elo rating,
an estimate of established strength, or evidence of cheating. The existing
depth-14/1.2-second per-position budget, device speed, engine version, and cached
evaluations affect the result. Short and already-decided games can score highly.
Results should not be compared directly with other sites or other method versions.

Tests use independently calculated decimal reference values for the published
equations and weighted/harmonic aggregation, plus both player perspectives,
window boundaries, mate transitions, flat evaluations, missing data, short games,
and numerical limits. Changing any formula, window rule, mate policy, or fallback
requires a new accuracy version. Broader validation against a fixed corpus and
stronger engine searches remains future work; no strength or rating calibration
is claimed by v1.
