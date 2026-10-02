# Game results and draw policy

The reference is the [official FIDE Laws of Chess](https://handbook.fide.com/chapter/e012023), especially articles 5.1.2, 5.2, 6.9, and 9.1–9.6. The domain implements the rules below with explicit online adaptations. The guest HTTP game persists 5+3 clocks, timeout decisions, resignation, and draw offers and responses. It does not claim full FIDE compliance: mating-possibility detection is conservative, and pending timeouts still lack automatic resolution.

## Implemented lifecycle

Games start at the standard position. Every player command identifies its acting side; the server derives that side from the authorized guest session. Finished games reject every mutation, including repeated terminal commands. An unresolved timeout enters `pending_adjudication` and rejects all player commands. Position and history remain available for replay.

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

The live board shows **Claim draw** only to the player to move when the saved current position qualifies. Clicking it submits a current-position claim using the server-reported rule; the server checks the rule and version again under its game lock. The HTTP API still supports declared legal moves, but this compact control does not ask players to enter one. A future move-planning interface can expose intended-move claims without weakening the server rule.

The standalone domain `claimDraw` command rejects invalid and unmet-threshold claims without changing repetition counts or pending offers. The guest HTTP clock procedure applies the documented penalty to an otherwise valid claim that misses the threshold, as specified in the [adjudication decision](adjudication-design.md#incorrect-claims-online). No claim availability is inferred from chess.js's aggregate game-over or draw helpers.

## Offers and agreement

The current domain has separate offer and claim commands. An explicit offer may be sent outside the player's turn, but only after both players have made a move (at least two saved half-moves). After an offer is accepted as a command, that player cannot offer again until **more than 20 further half-moves** have been played: an offer made at ply 2 can next be made at ply 23. Decline and expiry do not reset this count. Each side has its own count, and receipt or game-version changes do not advance it. Acceptance still requires one move from each side. Only the recipient may accept or decline. A second or crossed explicit offer is rejected; the recipient must explicitly accept instead. Offers cannot be withdrawn. These limits are the current guest-game online policy, not a claim that FIDE mandates this cooldown. An incorrect claim creates a separate offer that may coexist with the opponent's explicit offer. It replaces the claimant's own earlier explicit offer, so each side has at most one active offer.

An offer survives the sender's moves. It ends on recipient acceptance, explicit decline, the recipient's accepted move, or any game result. Rejected moves do not decline an offer. This maps physical piece-touching to an accepted online move; selecting a piece has no domain effect. A rejected early or cooldown offer creates no offer for the opponent and changes no eligibility state. Tournament-specific restrictions remain open.

## Mating possibility, resignation, and timeout

Game creation requires an explicit resignation policy. The guest server chooses `casual_concession`: resignation ends immediately. A sound proof that the opponent cannot mate makes it a draw; otherwise the opponent wins, including when the detector returns `unresolved`. This can award a win in an unusual position where mate is impossible but the current detector cannot prove it. It is not an exact implementation of FIDE Article 5.1.2. The separate `fide_proof_required` domain mode accepts an unresolved resignation into a frozen pending state instead of awarding a win; it is a boundary for future adjudication, not a ready competitive service. Rated and tournament games must not use the casual mode and cannot launch on the strict mode without a reliable way to finish pending cases. Timeout still requires a proven `impossible` or `possible` answer and remains pending if unresolved. `getMatingPossibility(side)` exposes those three answers; a bounded search that finds nothing cannot prove impossibility. The [adjudication decision](adjudication-design.md) explains the difference.

The detector proves impossibility for:

- A bare king.
- A king and one knight against a bare king or a king with only queens.
- A king with only bishops when every bishop on the board occupies the same square color and the opponent has no pawn or knight. Opposing rooks or queens do not invalidate this particular proof.
- Pawn-only positions whose entire reachable graph contains only quiet king moves and no checkmate. The search stops as inconclusive at 4,096 distinct positions or as soon as a pawn move or capture is reachable. It ignores move counters and does not use repetition or move-count draws to prove mating impossibility.

Both sides must be proven unable to mate for an automatic dead-position result. Two knights are not treated as dead material. Opposite-colored bishops and opposing material that can help block a king's escape squares are not automatically discarded. The material criteria can also be compared with [python-chess's documented conservative material check](https://python-chess.readthedocs.io/en/latest/_modules/chess.html#Board.has_insufficient_material); python-chess is not a dependency.

**Detection remains partial.** Other fortresses, forced continuations, and searches that exceed the budget remain `unresolved`. They cannot justify an automatic dead-position draw or a timeout result. The game may miss an automatic dead position until a complete proof is available. A background worker searches pending timeouts after a flag or restart; a verified mate line finishes the game, while exhaustion remains pending for further adjudication. An engine score or a perfect-play tablebase draw cannot substitute for cooperative mate reachability.

At flag fall, the clock calls `flagTimeout` once with the side to move and the effective deadline. A sound proof that the opponent cannot mate ends the game as `timeout_no_mating_possibility`; a verified legal mate line ends it as a timeout win. Otherwise the game enters `pending_adjudication` with the flagged side and deadline. The board and history do not change. A precomputed line may be registered with the clock before the deadline; the domain verifies it and the live clock path never searches for one. After a pending flag, `findTimeoutMateWitness` can run separately and a valid line can be passed to `resolveTimeout`. Search exhaustion leaves the game pending. A repeated flag or ruling cannot create a second result.

## Work remaining for timed play

The requested repetition thresholds and claim procedure are implemented for guest games. The [online claim and clock decision](adjudication-design.md#incorrect-claims-online) describes the current behavior:

- Pause a valid claim at server receipt. An incorrect threshold claim adds the applicable time penalty, creates a draw offer, and commits its legal intended move if supplied. The guest server applies these effects through a durable receipt; the standalone domain claim command still rejects an unmet threshold unchanged.
- The transport-free 5+3 clock wrapper stamps commands, orders them, charges accepted moves, and applies the three-answer timeout rule at flag fall. The guest server now persists that rule for the new free-first-move start and legacy readiness, moves, and flags, using UTC deadlines that continue through outages. An unresolved timeout stays frozen and cannot become a win by default.
- Pending timeout search is durable and runs outside the live command path. Exhausted positions still need a stronger proof or a future authorized adjudicator. Resignation and explicit draw offers already use serialized receipts.

Arbiter intervention, paper notation, and touch-move procedures are not simulated. The current guest server authorizes moves, resignation, claims, and explicit draw actions and orders their durable receipts against flags across processes, and sends post-commit game-update signals. For every such action, the trusted server receipt time wins if strictly before the current deadline; an action received at or after it loses to the flag, including an opponent's draw acceptance or a resignation. A successful acceptance or resignation stops the running clock at receipt time, even if database processing finishes later. Offers and declines leave the clock running. Public competitive play still needs synchronized host clocks, handling for wall-clock corrections and expired ingress leases, and unresolved timeout review.
