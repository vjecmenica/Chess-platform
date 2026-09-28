# Game results and draw policy

This document separates the small lifecycle implementation from rules still proposed for the complete game. The current API is not a complete competition ruleset. Resolve the pending rules below before adding clocks or exposing live play.

## Implemented lifecycle

A game starts active at the standard position. Each command names its acting side, `white` or `black`. This is not authentication: the future server must supply that side from an authorized session.

After an accepted move, checkmate immediately awards a win to the mover. Stalemate immediately produces a draw: the next side has no legal move and is not in check. These checks require no player request. The final move remains in replay history.

Either side may resign, including outside its turn. In this initial implementation, resignation awards the opponent a win. The exception for an opponent unable to mate is deferred with mating-possibility adjudication below; this simplified behavior must not be mistaken for full FIDE compliance.

An agreed draw requires an offer and an explicit acceptance from the other side. For this increment, both sides must have made at least one move before an offer is allowed. After that, offers and responses are not restricted to the side to move. Only one offer can be pending. Another offer, including one from the opponent, is rejected rather than treated as acceptance. Only the recipient can accept or decline it. There is no withdrawal command.

An accepted move by the recipient declines the offer. A move by the offerer preserves it. Rejected moves and commands leave the offer unchanged. Any game result clears the offer. No time-based expiry or tournament restriction is implemented.

A result is final. All subsequent move, resignation, offer, acceptance, and decline commands return `game_finished`, including exact retries. They cannot change the position, history, or result. Network request deduplication will later belong to the server; the domain does not pretend that a repeated terminal command succeeded again.

## Draws not implemented yet

Stalemate is the only automatic draw in this increment. Agreement is the only player-requested draw. Repetition, move counters, or low material do not currently finish a game; there is no draw-claim command. The game API never uses chess.js `isGameOver()` or `isDraw()` to select competition policy.

The following is a proposal for review, not an approved extension:

- Make threefold repetition and 50 moves by each side without a pawn move or capture claimable by the side to move. Support a claim about the current position or a specified legal move that would reach the threshold.
- Make fivefold repetition and 75 such moves by each side automatic. Checkmate on the final move takes precedence over the move-count draw.
- Make dead positions automatic. Decide the supported detector and its limitations; chess.js's insufficient-material test alone does not establish every position in which mate is impossible.
- Use mating possibility for the resignation and future timeout exceptions: consider whether the opponent could ever deliver mate through legal play, not whether it could force mate.

These proposals use [FIDE Laws of Chess, articles 5, 6.9, and 9](https://handbook.fide.com/chapter/E012023) as a reference. Online claim handling and draw-offer commands still need our own explicit protocol.

## Decisions required before clocks

1. Approve or replace the proposed claimable and automatic repetition/move-count thresholds and their precedence.
2. Choose a dead-position and one-sided mating-possibility policy, including a practical detector, any declared limitations, and consistent resignation/timeout outcomes. Resolve the current resignation simplification before live play.
3. Decide how a claim carries an intended move, whether that move is committed on acceptance, and what an invalid claim does to the running clock. Decide whether claim handling also creates a draw offer; no such side effect exists yet.
4. Review the implemented offer protocol, including the one-move-per-side minimum, before attaching clocks. Decide how an acceptance or claim racing a move or expiry is ordered. Tournament-specific agreement limits can wait for the tournament step.

Clock start, deadline boundaries, increment, disconnects, and server outages remain separate open questions in the [architecture](architecture.md#clocks-and-recovery).
