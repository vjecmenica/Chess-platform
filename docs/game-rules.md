# Game results and draw policy

The reference is the [official FIDE Laws of Chess](https://handbook.fide.com/chapter/e012023), especially articles 5.1.2, 5.2, 6.9, and 9.1–9.6. The domain implements the rules below with explicit online adaptations. It does not claim full FIDE compliance: mating-possibility detection is conservative, and clock/arbiter procedures are not implemented.

## Implemented lifecycle

Games start at the standard position. Every command identifies its acting side; the later server must derive that side from an authorized session. Finished games reject every mutation, including repeated terminal commands. Position and history remain available for replay.

After each accepted move, adjudication checks these conditions in order:

1. Checkmate: the mover wins.
2. Stalemate: draw.
3. Proven dead position: draw.
4. Fifth occurrence of the same position: automatic draw.
5. 150 consecutive half-moves without a pawn move or capture: automatic 75-move draw.

This order gives checkmate precedence over the 75-move rule. Where several draw conditions apply, it selects one stable reason. The final played move remains in history.

## Repetition and claims

Position identity includes piece placement, side to move, castling rights, and an en passant target only when a legal capture exists. A pinned pawn with no legal en passant capture does not distinguish positions. Counters are excluded. The initial position counts once; only accepted moves add occurrences. Losing castling rights matters even when castling is temporarily blocked.

Only the side to move can claim threefold repetition or 50 moves by each side without a pawn move or capture. A claim names its rule and optionally an intended move. The domain validates that move on a separate board, with normal king-safety and promotion rules, and checks the resulting position against the threshold.

A successful claim ends the game immediately without playing the intended move. Board, turn, and move history remain at the position before the claim; the result reason identifies the claim. A legal intended move is required even when the current position would already qualify. Claims do not wait for opponent consent.

Invalid claims leave everything unchanged, including repetition counts and pending offers. No claim availability is inferred from chess.js's aggregate game-over or draw helpers.

## Offers and agreement

An offer is separate from a claim. It may be sent outside the player's turn, even before both players have moved. Acceptance requires at least one played move by each side. Only the recipient may accept or decline. A second or crossed offer is rejected; the recipient must explicitly accept instead. Offers cannot be withdrawn.

An offer survives the sender's moves. It ends on recipient acceptance, explicit decline, the recipient's accepted move, or any game result. Rejected moves do not decline an offer. This maps physical piece-touching to an accepted online move; selecting a piece has no domain effect. Tournament restrictions and repeated-offer moderation belong to later steps.

## Mating possibility and resignation

Resignation draws when the opponent is proven unable to mate; otherwise it awards the opponent a win. The same side-specific check is exposed as `getMatingPossibility(side)` for the future timeout rule. Its results are `impossible` and `not_ruled_out`; the latter is not a proof that mate is reachable or forceable.

The detector proves impossibility for:

- A bare king.
- A king and one knight against a bare king or a king with only queens.
- A king with only bishops when every bishop on the board occupies the same square color and the opponent has no pawn or knight. Opposing rooks or queens do not invalidate this particular proof.
- Pawn-only positions whose entire reachable graph contains only quiet king moves and no checkmate. The search stops as inconclusive at 4,096 distinct positions or as soon as a pawn move or capture is reachable. It ignores move counters and does not use repetition or move-count draws to prove mating impossibility.

Both sides must be proven unable to mate for an automatic dead-position result. Two knights are not treated as dead material. Opposite-colored bishops and opposing material that can help block a king's escape squares are not automatically discarded. The material criteria can also be compared with [python-chess's documented conservative material check](https://python-chess.readthedocs.io/en/latest/_modules/chess.html#Board.has_insufficient_material); python-chess is not a dependency.

**Detection remains partial.** Other fortresses, forced continuations, and searches that exceed the budget remain `not_ruled_out`. This avoids false draws, but can miss a dead position or a resignation draw exception. Complete reachability adjudication is intentionally deferred; resolve that limitation before claiming full compliance or enabling public competitive play. Ordinary engine evaluations and force-mate tablebase scores are not substitutes for cooperative mate reachability.

## Decisions required before clocks

The requested repetition thresholds and successful-claim behavior are now implemented, not proposals. Remaining work is:

- Integrate claim evaluation with authoritative time and command ordering, including claims or agreement racing expiry. FIDE 9.5 pauses time for adjudication and adds two minutes to the opponent after an incorrect claim. No time change exists yet.
- Decide the online handling of FIDE 9.1.2.3 (a claim also being an offer) and 9.5.3 (playing the indicated move after an incorrect claim). To honor atomic rejection now, a rejected claim neither creates an offer nor commits or binds a move. A later penalty procedure must be explicit rather than silently changing rejection semantics.
- Reuse the mating check for the 6.9 timeout exception, while addressing its documented incomplete coverage. Do not turn `not_ruled_out` into a claim of proven mating possibility.
- Set clock start, deadline boundaries, increment, disconnect, and server-outage behavior in the [architecture](architecture.md#clocks-and-recovery).

Arbiter intervention, paper notation, and touch-move procedures are not simulated. The domain checks commands synchronously; the future server must serialize them and provide durable request receipts. No clock, transport, or persistence has been added here.
