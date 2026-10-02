# Product specification

The platform brings competitive chess and game analysis into a simple interface. This document describes the agreed product scope. Implementation choices and unresolved rules are collected at the end; suggestions there are not approved decisions.

## Play

Players can start rated or casual (unrated) online games through a friend challenge or automatic matchmaking. The server validates moves, decides their order, and controls the clocks. A client may suggest a move or display an estimated remaining time, but it cannot determine the official position, time, or result.

In `m+s` notation, each player starts with `m` minutes and receives `s` seconds after each accepted move.

| Rating pool | Time controls |
| --- | --- |
| Bullet | 1+0 |
| Blitz | 3+0, 3+2, 5+3 |
| Rapid | 10+0, 10+2, 10+5, 15+0, 15+2, 15+5 |
| Classical | 20+0, 20+10, 25+0, 25+10, 30+0, 30+10 |

These are the product's explicit assignments for all 16 time controls. Do not substitute a formula that moves a listed control into a different pool. Custom time controls will come later for direct challenges; their limits, rating pool, and eligibility for rated play still need to be decided.

### Results and draws

The domain supports checkmate, stalemate, resignation, agreement, automatic fivefold/75-move draws, threefold/50-move claims, and timeout adjudication. Intended-move claims do not play the move. Proven dead positions draw automatically. The mating check returns proven impossible, proven possible, or unresolved. For a casual guest resignation, a proof of impossibility draws; otherwise the opponent wins immediately under the documented concession policy. For current casual guest games, a proven no-mate timeout draws; otherwise the opponent wins at flag fall, including unresolved mating queries. This practical policy is not an exact FIDE Article 6.9 ruling. Timeout records the flagged side and effective deadline. The [game rules](game-rules.md) describe current behavior; the [adjudication decision](adjudication-design.md) documents the durable claim procedure and casual timeout policy. Finished and pending games reject further player commands.

### Ratings and matchmaking

Each player has separate Glicko-2 ratings for bullet, blitz, rapid, and classical. An eligible rated result affects only its own pool and must be applied once. Casual games never change ratings. The treatment of abandoned or voided games remains open.

Matchmaking requires the exact same time control and game type. A player seeking rated 3+0 must not be matched into casual 3+0 or rated 3+2. Within that queue, the search starts with similar ratings from the relevant pool and gradually widens. Waiting longer does not change the chosen time control or rated status.

Tests must show that the search widens with elapsed waiting time, canceled requests cannot be matched, and concurrent requests cannot pair a player with themselves or reserve them for two games. Glicko-2 calculations must match a documented reference example. Reprocessing a result must not update either player's rating twice.

## Saved games and analysis

**Game analysis is a core part of the product.** It has three distinct layers, so a reliable replay can be delivered first without treating analysis as an optional extra.

### Saved-game replay

Finished games are stored with their moves and result. Players can step through every half-move, return to the starting position, or jump to the end. Replay does not require an engine and is part of the first playable milestone.

The current browser-local analysis board lets a player branch from any saved or explored move, navigate the tree, promote a local line for viewing, add comments and standard PGN Numeric Annotation Glyphs, and remove a continuation with confirmation. The saved result, moves, and clocks never change. This local note tree is not an engine evaluation or a full game review. The searchable annotation menu supports all defined non-null [PGN Standard NAG values](https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm#c10), 1–139; value 0 is null and 140–255 are reserved. Comments are stored separately from numeric annotations.

### Interactive engine analysis

On the analysis board, players can turn the engine on, see position evaluations, and explore multiple candidate lines. Engine lines must be legal from the selected position, and the evaluation must make its perspective clear. Running analysis must not delay clocks in active games.

### Full game review

The first review runs locally in the browser after a finished game. A player starts it explicitly. It evaluates the initial position and every saved main-line position with Stockfish.js 19 lite single-threaded, one worker, depth at most 14, and at most 1.2 seconds per position, with a short pause between searches. Cached evaluations under those same engine settings are reused. The player sees progress and can cancel; completed positions remain cached, but a partial review is not presented as a complete result. Variations are excluded. No game data or review result is sent to the server.

The first methodology is `local-cpl-v1`. Each UCI score is converted from the side-to-move perspective to White's perspective. For a move, convert the evaluations before and after it to the moving player's perspective, subtract after from before, and clamp a negative result to zero. This is **centipawn loss (CPL)**. A White move from +0.50 to +0.20 loses 30 cp; a Black move that changes White's score from +0.20 to +0.90 loses 70 cp. Search variation can make the value unstable, so these labels are rough training cues, not a verdict on the move.

| CPL | First-version label |
| --- | --- |
| 0–20 | Strong |
| 21–60 | Good |
| 61–120 | Inaccuracy |
| 121–250 | Mistake |
| 251 or more | Blunder |

The graph shows White's evaluation after every half-move, visually clipped at ±10 pawns. Mate scores sit at the corresponding graph edge; a `mate 0` score means the side to move is checkmated. A move whose before or after evaluation is a mate score has no numeric CPL and is labeled **Mate score**. We do not convert a mate distance into invented centipawns. The review displays its methodology version and keeps the saved game unchanged. These thresholds are this project's explicit, provisional choices, not values borrowed from or endorsed by another chess service.

The board-width review area holds the controls, progress, graph, and per-player summary. The summary counts inaccuracies, mistakes, and blunders and averages only moves with numeric CPL; it shows no average when none qualify. Graph points and nonzero summary counts can navigate to a saved main-line position. The existing move list shows compact engine labels beside saved moves: **S** for Strong, **G** for Good, **?!** for Inaccuracy, **?** for Mistake, **??** for Blunder, and **M** where a mate score prevents numeric CPL. S, G, and M are plain abbreviations, not PGN glyphs or claims of brilliant play. These review indicators are separate from manually entered PGN NAGs and comments; they do not change or replace either annotation.

Numerical accuracy, aggregation across a game, richer move-quality labels, multi-line engine comparison, persistent review records, and a server background job remain open. Before adding accuracy, define its formula, exclusions, mate handling, versioning, and validation games. A server job will also need durable retry and deduplication behavior.

Engine and AI advice must not be available to players during an active game. This must be enforced at server entry points as well as in the interface. The exact scope of restrictions on other analysis pages, and the limits of controlling browser engines or outside tools, need an explicit fair-play policy.

## Swiss tournaments

A registered user can create a Swiss tournament with a name, player limit, time control, number of rounds, and start time. Players can register and view pairings, results, and standings. The organizer chooses whether games affect the ordinary rating pool for that time control; a separate tournament rating is not required.

Each round starts after every game in the previous round is resolved, followed by a short break. Tournament duration is shown as an estimate, with its assumptions visible, rather than a promised finish time. Increment games make that distinction especially important.

Before release, a small simulated tournament must cover an odd player count, a bye, withdrawal, and tied scores under the selected rules. The final result of a round must schedule exactly one next round after the break. Restarts and repeated result messages must not duplicate pairings, advance early, or apply ratings twice. The organizer's rated/casual choice must carry through to every game.

The Swiss pairing rules, scoring, tie-breaks, byes, and handling of absences are not yet selected. The roadmap keeps tournaments after interactive analysis and full game review, even though their technical dependencies are mostly in the game and rating systems.

## Puzzles and later AI features

Players will be able to solve chess puzzles and, later, practice positions taken from their own games. Puzzle solutions must be verified, incorrect moves handled consistently, and access to private positions follow the source game's permissions. Puzzle sources and licensing still need review.

AI will later explain positions using engine findings. Any chess line it proposes must pass legal-move and engine checks before being presented as verified advice. AI text does not determine accuracy scores. If the AI service fails, saved-game replay and engine analysis should still work. Privacy rules must be agreed before sending personal game data to an external service.

## Interface

The board is the main element. Keep clocks, the side to move, the result, and connection status easy to read, without unnecessary animations. The current preview uses a FEN-rendered wood-colored board with locally bundled Chessnut SVG pieces, seat orientation, keyboard-focusable squares, click and pointer-drag input, a promotion choice, and server clock snapshots with a locally animated estimate. Dragging a king onto its own rook offers castling when legal. It shows that clocks continue through disconnects and server outages. Review screen-reader and touch behavior before public release. UI copy is English, as is all other repository content.

## First playable milestone

Two players follow a challenge link, play a legal game with a clock, and then replay the saved game move by move. The chosen starting scope is a casual 5+3 challenge from the standard starting position, using secure guest sessions. The current preview has an HTTP board, versioned move submission, draw claims, explicit offers and resignation, committed game-update signals with fallback polling, saved history, authoritative clocks with durable deadlines, replay controls, and immediate casual-policy resignation results. Casual timeouts now settle with the flag, including positions that exhausted the old search. Broader recovery work remains before the first playable milestone is complete. Session recovery details and archive visibility still need decisions. Ratings, matchmaking, engine analysis, and tournaments are not prerequisites for this first complete flow.

Acceptance criteria:

1. Two separate browser sessions can create and accept a challenge. A third session cannot take an occupied seat or move for either player. Simultaneous attempts to accept the link cannot create an extra participant.
2. Both players see the same confirmed position and side to move. The server rejects illegal moves and moves from the wrong player. Tests cover castling, castling through check, en passant, promotion, and escaping check.
3. The server measures elapsed time and adds increment exactly once per accepted move. Illegal or repeated requests cannot pause or reset a clock. Expiry is detected even if no further message arrives. Tests cover moves before, at, and after the deadline under the chosen boundary rule.
4. Checkmate, resignation, draws, and time expiry produce a saved result and reason under the agreed rules. No moves are accepted after the game ends. Implement the selected [claim and adjudication procedure](adjudication-design.md) before enabling competitive play. Casual timeout and resignation follow their documented immediate-result policies; competitive play needs stricter adjudication.
5. Resending a request cannot produce a second move or increment. After a dropped connection or page refresh, the authorized player receives the current position, version, move history, and clocks. Clocks keep running through a client disconnect and server outage for this casual milestone.
6. Every acknowledged move survives a server restart. Failed database writes must not produce successful acknowledgments. A game can finish only once, even when requests race.
7. A finished game can be reopened after refresh or restart. Start, previous, next, and end controls reconstruct the saved position at each half-move without changing the game.
8. Recovery of active games after a server outage uses the saved UTC deadline and applies an overdue flag at that deadline. Test crash and restart boundaries, clock-skew effects, and backup restoration before the milestone is complete.

## Choices still open

### Initial choices and remaining setup decisions

**Stack and deployment.** TypeScript, npm workspaces, React + Vite, Fastify on Node.js, PostgreSQL, and the domain/contracts package boundaries were chosen on September 28, 2026. This keeps the development setup small and gives persistence a real transactional database from the start. See the [architecture](architecture.md) for the setup and later proposals. The current live update path uses server-sent events; Socket.IO remains an option if later features need bidirectional delivery. Hosting region, budget, load targets, monitoring, retention, and backup/restore targets remain open before public release.

**Identity and access.** The first challenge slice uses an opaque 30-day HttpOnly guest cookie, a CSRF token for writes, and a random link that lets one other guest claim Black while the seat is open. Seat ownership is stored in PostgreSQL; filled challenges and their games are readable only by their two guests. Losing the cookie currently loses access. Guest recovery, invitation expiry and revocation, broader saved-game visibility, and later account linking still need design before the complete playable flow. Accounts for rated play remain the suggestion for the later rating step.

**Game rules and time.** The [adjudication decision](adjudication-design.md) sets claim penalties, offers, forced intended moves, receipt ordering, and the flag-fall boundary. For newly accepted casual 5+3 games, White may move immediately. White has a separate 30-second deadline beginning when Black accepts. Both regular clocks stay at 5:00 until White's first legal move commits; that move costs no time and earns no increment. Black's regular clock and separate 30-second first-move deadline then start together in the durable handoff. A player whose first legal move is not received strictly before their deadline aborts the game without a win or loss. Each deadline is saved and remains effective through a restart. Previously saved games keep their existing free-first-move or Ready rule. The server captures a complete player command's arrival before asynchronous authentication, durably admits it, and processes receipts in time order across server instances. After the free first move, an accepted move charges its mover through that receipt and adds one increment. The opponent's clock starts in a durable handoff after the move commit; the final handoff transaction's brief commit latency is charged to the opponent. Completion or pending adjudication stops both clocks. A periodic poll and reads can apply an overdue flag without a move. A running clock continues through client disconnects and server outages, with no latency compensation; a committed move awaiting handoff remains paused until recovery completes it. The server reconstructs a running clock from its saved UTC deadline, not a process-local monotonic value. Synchronized host clocks, lease expiry during a long database outage, and requests lost before durable admission need stronger operational handling before public competitive play. The HTTP flow now persists claims, penalties, forced intended moves, and offers. Casual timeout results commit with the flag; exact FIDE timeout adjudication remains open for competitive play.

**Board and access needs.** The preview uses native buttons and the Apache-2.0 [Chessnut piece set](../apps/web/public/pieces/chessnut/ATTRIBUTION.md). Validate screen-reader, keyboard, mouse, and touch behavior in two-browser testing, then decide whether this board needs a dedicated component. English copy is already agreed.

### Before the relevant feature

**Ratings and matchmaking.** Select initial rating, rating deviation (RD), volatility, tau, rating periods, inactivity treatment, provisional status, and abandoned/voided-game rules. Updating after every match is not automatically the same as the intended Glicko-2 method. Choose the initial search range, widening interval and amount, waiting limit, cancellation behavior, and treatment of new players. FIFO among mutually compatible candidates is a suggestion.

**Analysis and review.** Choose browser versus server engine execution, CPU/memory budgets, the multiple-line (MultiPV) limit, caching, and package licensing before interactive analysis. Set and validate the accuracy formula, move labels, thresholds, and versioning before full game review.

**Fair play and privacy.** Define restrictions while a player has an active game, including access to analysis of other finished games and puzzles with advice. Address reporting and moderation before public rated play. Set puzzle licensing and personal-game privacy rules before puzzles and AI explanations ship.

**Swiss rules.** Select a pairing implementation, scoring, tie-breaks, byes, repeat-opponent and color rules, withdrawals, no-shows, late entry, minimum attendance, cancellation, break length, and the duration estimate. Freezing the time control, round count, and rated status at tournament start is the current proposal.

**Custom challenges.** Choose allowed time limits and increments, pool assignment, and rated eligibility. Custom controls remain limited to direct challenges.

Record approved choices with their date, rationale, and consequences, then update the [roadmap](roadmap.md) and architecture where needed. Detailed rules can wait until their feature is due; the initial game cannot wait for clear clock and recovery behavior.
