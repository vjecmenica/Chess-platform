# Game results and draw policy

The reference is the [official FIDE Laws of Chess](https://handbook.fide.com/chapter/e012023), especially articles 5.1.2, 5.2, 6.9, and 9.1–9.6. The domain implements the rules below with explicit online adaptations. It does not claim full FIDE compliance: mating-possibility detection is conservative, and only the first 5+3 clock boundary is implemented; timeout results and claim penalties are not.

## Implemented lifecycle

Games start at the standard position. Every player command identifies its acting side; the later server must derive that side from an authorized session. Finished games reject every mutation, including repeated terminal commands. A game with an accepted, unresolved resignation is `pending_adjudication` and also rejects all player commands. Position and history remain available for replay.

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

In the current domain-only API, invalid claims leave everything unchanged, including repetition counts and pending offers. The future clock procedure handles an incorrect, otherwise valid claim differently, as specified in the [adjudication decision](adjudication-design.md#incorrect-claims-online). No claim availability is inferred from chess.js's aggregate game-over or draw helpers.

## Offers and agreement

The current domain has separate offer and claim commands. An explicit offer may be sent outside the player's turn, even before both players have moved. Acceptance requires at least one played move by each side. Only the recipient may accept or decline. A second or crossed explicit offer is rejected; the recipient must explicitly accept instead. Offers cannot be withdrawn. The future online procedure also treats an incorrect claim as an offer and will support offers from both sides at once.

An offer survives the sender's moves. It ends on recipient acceptance, explicit decline, the recipient's accepted move, or any game result. Rejected moves do not decline an offer. This maps physical piece-touching to an accepted online move; selecting a piece has no domain effect. Tournament restrictions and repeated-offer moderation belong to later steps.

## Mating possibility and resignation

Resignation draws when the opponent is proven unable to mate and awards a win when a legal mate line proves that mate is possible. The same side-specific check is exposed as `getMatingPossibility(side)` for the future timeout rule. It returns `impossible`, `possible`, or `unresolved`. The synchronous positive proof is a legal checkmate on the next move by that side. An unresolved resignation is accepted into `pending_adjudication`: no further move or result-changing player command can occur. A separately invoked bounded search can find and verify a cooperative mate line from that state. A found line can resolve the resignation to a win; exhaustion cannot resolve it to a draw. The domain has no command to convert an unverified external no-mate claim into a draw. Such cases stay pending until a complete proof can be validated. The [adjudication decision](adjudication-design.md) defines the server responsibility before live play.

The detector proves impossibility for:

- A bare king.
- A king and one knight against a bare king or a king with only queens.
- A king with only bishops when every bishop on the board occupies the same square color and the opponent has no pawn or knight. Opposing rooks or queens do not invalidate this particular proof.
- Pawn-only positions whose entire reachable graph contains only quiet king moves and no checkmate. The search stops as inconclusive at 4,096 distinct positions or as soon as a pawn move or capture is reachable. It ignores move counters and does not use repetition or move-count draws to prove mating impossibility.

Both sides must be proven unable to mate for an automatic dead-position result. Two knights are not treated as dead material. Opposite-colored bishops and opposing material that can help block a king's escape squares are not automatically discarded. The material criteria can also be compared with [python-chess's documented conservative material check](https://python-chess.readthedocs.io/en/latest/_modules/chess.html#Board.has_insufficient_material); python-chess is not a dependency.

**Detection remains partial.** Other fortresses, forced continuations, and searches that exceed the budget remain `unresolved`. They cannot justify either a resignation win or a draw. The game may miss an automatic dead position until a complete proof is available. A pending resignation can wait indefinitely at this stage because there is no server reviewer, durable queue, or complete proof engine. Do not call this full FIDE compliance. An engine score or a perfect-play tablebase draw cannot substitute for cooperative mate reachability.

## Work remaining for timed play

The requested repetition thresholds and successful-claim behavior are implemented. The [online claim and clock decision](adjudication-design.md#incorrect-claims-online) specifies the remaining procedure:

- Pause a valid claim at server receipt. An incorrect threshold claim adds the applicable time penalty, creates a draw offer, and commits its legal intended move if supplied. The current domain rejects such a claim unchanged because it has no clock or durable command receipt yet.
- The 5+3 clock wrapper already stamps commands, orders them, charges accepted moves, and freezes at flag fall. Use the same three-answer mating decision for the 6.9 timeout exception; a flag currently has no final result. An unresolved timeout needs adjudication and cannot become a win by default.
- Make command receipts and clocks durable, then implement the selected claim pause and time bonus. Choose server-outage recovery separately in the [architecture](architecture.md#clocks-and-recovery).

Arbiter intervention, paper notation, and touch-move procedures are not simulated. The clock boundary has an in-memory FIFO queue, but the future server must authorize and serialize commands with durable request receipts. There is no transport or game persistence yet.
