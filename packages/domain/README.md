# Domain positions and games

`@chess/domain` owns chess rules without exposing chess.js types. It supports standard chess from the standard starting position, move validation, replay history, and a small game lifecycle. It does not run clocks, save games, or authenticate players. The [game rules](../../docs/game-rules.md) define the draw policy, online adaptations, and conservative mating detector.

```ts
import { createPosition } from '@chess/domain';

const position = createPosition();
const result = position.submitMove({ side: 'white', from: 'e2', to: 'e4' });

if (result.accepted) {
  console.log(result.move.san); // e4
  console.log(result.position.sideToMove); // black
} else {
  console.log(result.reason, result.message);
}
```

## Position API

- `createPosition()` creates an independent position with White to move and empty history. `STANDARD_STARTING_FEN` is exported for replay consumers.
- `getPosition()` returns `{ fen, sideToMove }`. Sides are `white` and `black`. FEN includes the board, turn, castling rights, en passant state, and move counters. The en passant target is included only when a legal en passant capture is available, following chess.js normalization. FEN counters do not imply a draw policy.
- `submitMove({ side, from, to, promotion? })` accepts lowercase squares `a1`–`h8`. Promotion uses `q`, `r`, `b`, or `n` and is required when promoting; there is no automatic queen choice. A promotion field on an ordinary move is rejected. Castling uses the king's coordinates, such as `e1` to `g1`.
- `getHistory()` returns ordered records with a one-based half-move number (`ply`), side, origin, destination, optional promotion, SAN notation, UCI coordinates, and before/after FEN. Starting from `STANDARD_STARTING_FEN` and submitting each record reconstructs the positions for later replay.

An accepted result has `accepted: true`, a `move` record, and the new `position`. A rejection has `accepted: false`, a stable `reason`, and a readable `message`:

| Reason | Meaning |
| --- | --- |
| `invalid_input` | Invalid side, square syntax, or promotion choice. |
| `wrong_turn` | The supplied side is not the side to move. |
| `promotion_required` | The move can promote, but a piece was not chosen. |
| `illegal_move` | No legal move matches the request, including blocked paths or exposing the king. |

Input validation happens before turn checking, then legal-move matching. Every rejected request preserves the position, side to move, and history. Returned records and snapshots are detached copies, so changing them cannot change the internal position. The API is typed; a future network boundary must still validate incoming data and derive the side from the authorized session.

The position API checks legality without enforcing game status. It remains suitable for replay; use the game API to enforce results and automatic draws.

## Game API

`createGame()` creates an independent active game and privately owns its position. Callers cannot bypass completion checks by accessing that position.

`getState()` returns a detached snapshot with `position`, `status`, `result`, and `drawOffer`. An active snapshot has a null result and an optional offerer's side. An accepted unresolved resignation has status `pending_adjudication`, a null result, no offer, and the resigning side. A finished snapshot has a result and no offer; one resolved by review also carries its `adjudication` ruling. `getHistory()` returns the same ordered, detached move records as the position API.

`submitMove({ side, from, to, promotion? })` uses the existing move rules. Success returns `{ accepted: true, move, game }`, including any result caused by the move. Resignation and offer/response commands take `{ side }` and return `{ accepted: true, game }` on success:

- `resign` draws when the opponent is proven unable to mate and awards a win when a legal mate witness exists. Otherwise it accepts the resignation and freezes the game in `pending_adjudication`.
- `offerDraw` requires no pending offer and is allowed even before the first move.
- `acceptDraw` finishes by agreement; only the recipient of a pending offer can accept, after both sides have played a move.
- `declineDraw` clears an offer without finishing; only its recipient can decline.

Offers can be made outside the actor's turn. The offerer's move preserves an offer; the recipient's accepted move declines it. An illegal move does not decline it. Results clear offers. See the [precise policy](../../docs/game-rules.md#implemented-lifecycle).

A win is `{ outcome: 'win', winner, reason: 'checkmate' | 'resignation' }`. A draw has `outcome: 'draw'` and a reason: `stalemate`, `agreement`, `dead_position`, `fivefold_repetition`, `seventy_five_move`, `threefold_repetition`, `fifty_move`, or `resignation_no_mating_possibility`. These distinguish automatic draws, claims, agreement, and resignation exceptions.

Rejections return `{ accepted: false, reason, message }` and preserve all state. The game first checks completion (`game_finished`) or an accepted resignation (`adjudication_pending`), then the acting side (`invalid_side`). Moves then use the position API's rejection reasons. Draw commands can reject with `draw_too_early`, `draw_offer_pending`, `no_draw_offer`, or `own_draw_offer`. A terminal or pending retry is rejected even if it repeats the original command; later server request receipts will handle network retries. The future server must validate payloads and derive the side from the authorized session, not trust a client-supplied side.

```ts
import { createGame } from '@chess/domain';

const game = createGame();
game.submitMove({ side: 'white', from: 'e2', to: 'e4' });
game.submitMove({ side: 'black', from: 'e7', to: 'e5' });
game.offerDraw({ side: 'white' });
const response = game.acceptDraw({ side: 'black' });
if (response.accepted) console.log(response.game.result); // Draw by agreement.
```

## Claims and mating queries

`claimDraw({ side, rule, intendedMove? })` accepts `threefold_repetition` or `fifty_move`. The optional intended move contains `from`, `to`, and optional `promotion`; its side is always the claimant. Only the side to move may claim. A successful response is `{ accepted: true, game }`; even a successful intended-move claim leaves the board, turn, and history unchanged.

An invalid side, wrong turn, unknown rule (`invalid_claim`), invalid intended move (the existing move rejection reasons), or unmet threshold (`claim_not_available`) rejects without changing state or offers. A rejected claim does not bind the player to the intended move or add a draw offer. Clock penalties and the FIDE claim-as-offer procedure need explicit integration later.

`getMatingPossibility(side)` returns `impossible` for a sound negative proof, `possible` for a verified immediate checkmate by that side, or `unresolved`. Automatic dead-position draws need impossibility for both sides; resignation checks only the opponent. The [detector coverage](../../docs/game-rules.md#mating-possibility-and-resignation) includes material proofs and closed pawn positions, but misses other fortresses or forced continuations.

An accepted unresolved resignation stops all player commands. `resolveResignation({ verdict: 'mate_possible', mateLine })` checks a legal line from the frozen position through checkmate by the opponent, including earlier automatic-result checks. Invalid lines leave the pending state unchanged. There is no external no-mate ruling command: a reviewer ID or evidence string alone cannot approve a draw. Positions that the built-in detector proves impossible still draw immediately on resignation. Other no-mate cases remain pending until a future implementation can validate a complete proof. The [online decision](../../docs/adjudication-design.md) specifies the remaining server work.

Call `findResignationMateWitness(game, { maxDepth?, maxNodes? })` **after** a resignation has entered `pending_adjudication`, from a worker rather than a move handler. It tries replay-verified opening witnesses and then a deterministic, cooperative legal-move search. The defaults are seven plies and 5,000 visited positions; hard limits are eight plies and 20,000 positions. Seed-line positions count toward that budget. A `found` result contains a mate line and node count. An `unresolved` result identifies `not_pending`, `depth_exhausted`, or `budget_exhausted`; none proves mate impossible. Search never changes the game. `verifyResignationMateLine(line)` is a read-only check; `resolveResignation` verifies again before changing the result.

```ts
import { createGame, findResignationMateWitness } from '@chess/domain';

const game = createGame();
game.resign({ side: 'white' });
const search = findResignationMateWitness(game);
if (search.status === 'found') {
  game.resolveResignation({ verdict: 'mate_possible', mateLine: search.mateLine });
}
```

This example is an in-memory domain flow. The server still needs authorized sessions, game persistence, a serialized command queue, and a separate worker to save an accepted resignation and its verified final result safely.

`createGame()` still starts only from the standard position. The internal FEN fixture factory is not part of the package API and cannot restore repetition history; production restoration will need the complete move history.

## Checks

From the repository root:

```sh
npm test -- packages/domain/test
npm run check
```

Move-validation and original lifecycle fixtures use legal sequences from the standard start. Focused rule tests also use internal FEN fixtures to isolate counters, material, and repetition rights without adding public custom-game setup. Tests cover normal moves, turn order, king safety, castling and lost rights, en passant and its expiry, all four promotion choices, replay history, and unchanged state after rejection. Lifecycle tests cover both colors delivering mate, stalemate, resignation, agreement, draw-offer lifetime, invalid commands, terminal retries, and unchanged state after rejection. Draw-rule tests cover claim and automatic thresholds, intended moves, repetition identity, counter resets, mate precedence, closed pawn positions, resignation exceptions, and cases where cooperative mate remains possible. Search tests cover both colors from the start, a developed position, invalid witnesses, and budget exhaustion. They need no database, network service, or clock.
