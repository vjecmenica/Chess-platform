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

The domain supports checkmate, stalemate, resignation, agreement, automatic fivefold/75-move draws, threefold/50-move claims, and timeout adjudication. Intended-move claims do not play the move. Proven dead positions draw automatically. Resignation and timeout use a three-answer mating check: proven impossible, proven possible, or unresolved. An unresolved resignation or timeout freezes the game without a final result until a supported ruling is supplied. Timeout records the flagged side and effective deadline. The [game rules](game-rules.md) describe current behavior; the [adjudication decision](adjudication-design.md) specifies the later durable server procedure for claims, flags, and unresolved cases. Finished and pending games reject further player commands.

### Ratings and matchmaking

Each player has separate Glicko-2 ratings for bullet, blitz, rapid, and classical. An eligible rated result affects only its own pool and must be applied once. Casual games never change ratings. The treatment of abandoned or voided games remains open.

Matchmaking requires the exact same time control and game type. A player seeking rated 3+0 must not be matched into casual 3+0 or rated 3+2. Within that queue, the search starts with similar ratings from the relevant pool and gradually widens. Waiting longer does not change the chosen time control or rated status.

Tests must show that the search widens with elapsed waiting time, canceled requests cannot be matched, and concurrent requests cannot pair a player with themselves or reserve them for two games. Glicko-2 calculations must match a documented reference example. Reprocessing a result must not update either player's rating twice.

## Saved games and analysis

**Game analysis is a core part of the product.** It has three distinct layers, so a reliable replay can be delivered first without treating analysis as an optional extra.

### Saved-game replay

Finished games are stored with their moves and result. Players can step through every half-move, return to the starting position, or jump to the end. Replay does not require an engine and is part of the first playable milestone.

### Interactive engine analysis

On the analysis board, players can turn the engine on, see position evaluations, and explore multiple candidate lines. Engine lines must be legal from the selected position, and the evaluation must make its perspective clear. Running analysis must not delay clocks in active games.

### Full game review

A separate review analyzes the whole game, calculates accuracy, and labels the quality of individual moves. Before displaying those scores or labels, document and validate the methodology:

- Engine version, analysis budget, and evaluation perspective.
- How mate scores are handled and how evaluations become accuracy scores.
- How scores are aggregated across a game, including any excluded positions.
- The meaning and thresholds of each move label, with ordinary and boundary examples.
- A methodology version stored with each result, so a later formula change does not silently reinterpret old reviews.

The formula, label names, and thresholds are still open. They must not be arbitrary values borrowed from another service or presented as a universal standard. A fixed collection of games should produce results within a documented tolerance, and retrying a review job must not create duplicate results.

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

The board is the main element. Keep clocks, the side to move, the result, and connection status easy to read, without unnecessary animations. UI copy is English, as is all other repository content. The board component, mobile layout, keyboard access, colors, and asset licenses remain to be chosen.

## First playable milestone

Two players follow a challenge link, play a legal game with a clock, and then replay the saved game move by move. The chosen starting scope is a casual 5+3 challenge from the standard starting position, using secure guest sessions. The current server already creates a game on acceptance and saves legal HTTP moves with version checks and retry receipts. That route has no authoritative clock, deadlines, live updates, or replay interface, so the first playable milestone is still open. Session recovery details and archive visibility still need decisions. Ratings, matchmaking, engine analysis, and tournaments are not prerequisites for this first complete flow.

Acceptance criteria:

1. Two separate browser sessions can create and accept a challenge. A third session cannot take an occupied seat or move for either player. Simultaneous attempts to accept the link cannot create an extra participant.
2. Both players see the same confirmed position and side to move. The server rejects illegal moves and moves from the wrong player. Tests cover castling, castling through check, en passant, promotion, and escaping check.
3. The server measures elapsed time and adds increment exactly once per accepted move. Illegal or repeated requests cannot pause or reset a clock. Expiry is detected even if no further message arrives. Tests cover moves before, at, and after the deadline under the chosen boundary rule.
4. Checkmate, resignation, draws, and time expiry produce a saved result and reason under the agreed rules. No moves are accepted after the game ends. Implement the selected [claim and adjudication procedure](adjudication-design.md) before enabling timed play; unresolved mating possibility cannot produce a final win or draw.
5. Resending a request cannot produce a second move. After a dropped connection or page refresh, the authorized player receives the current position, version, move history, and clocks. Keeping clocks running through a client disconnect is the proposal, not an approved rule yet.
6. Every acknowledged move survives a server restart. Failed database writes must not produce successful acknowledgments. A game can finish only once, even when requests race.
7. A finished game can be reopened after refresh or restart. Start, previous, next, and end controls reconstruct the saved position at each half-move without changing the game.
8. Recovery of active games after a server outage follows a documented and tested policy. That policy must be selected before the milestone is complete.

## Choices still open

### Initial choices and remaining setup decisions

**Stack and deployment.** TypeScript, npm workspaces, React + Vite, Fastify on Node.js, PostgreSQL, and the domain/contracts package boundaries were chosen on September 28, 2026. This keeps the development setup small and gives persistence a real transactional database from the start. See the [architecture](architecture.md) for the setup and later proposals. Socket.IO remains a proposal for live play. Hosting region, budget, load targets, monitoring, retention, and backup/restore targets remain open before public release.

**Identity and access.** The first challenge slice uses an opaque 30-day HttpOnly guest cookie, a CSRF token for writes, and a random link that lets one other guest claim Black while the seat is open. Seat ownership is stored in PostgreSQL; filled challenges and their games are readable only by their two guests. Losing the cookie currently loses access. Guest recovery, invitation expiry and revocation, broader saved-game visibility, and later account linking still need design before the complete playable flow. Accounts for rated play remain the suggestion for the later rating step.

**Game rules and time.** The [adjudication decision](adjudication-design.md) sets claim penalties, offers, forced intended moves, receipt ordering, and the flag-fall boundary. For the first 5+3 game, the clock starts when both authorized seats confirm readiness; White is charged from the second confirmation. An accepted move stops its mover's clock at server receipt and starts the other clock at confirmation, with one increment. Resignation, completion, or pending adjudication stops both. The domain has this in-memory clock and timeout boundary, but durable receipts, a background worker for pending results, and claim penalties still need implementation before timed play is enabled. Handling a missing first move, client disconnects, server outages, and latency still needs selection. Keeping clocks running during client disconnects and omitting latency compensation remain proposals. A server outage needs its own policy: continue charging time, pause it, or abort/void the game.

**Board and access needs.** Choose the board component and piece assets with their licenses, then agree on mobile and keyboard behavior. A responsive board and visible keyboard focus are proposed defaults. English copy is already agreed.

### Before the relevant feature

**Ratings and matchmaking.** Select initial rating, rating deviation (RD), volatility, tau, rating periods, inactivity treatment, provisional status, and abandoned/voided-game rules. Updating after every match is not automatically the same as the intended Glicko-2 method. Choose the initial search range, widening interval and amount, waiting limit, cancellation behavior, and treatment of new players. FIFO among mutually compatible candidates is a suggestion.

**Analysis and review.** Choose browser versus server engine execution, CPU/memory budgets, the multiple-line (MultiPV) limit, caching, and package licensing before interactive analysis. Set and validate the accuracy formula, move labels, thresholds, and versioning before full game review.

**Fair play and privacy.** Define restrictions while a player has an active game, including access to analysis of other finished games and puzzles with advice. Address reporting and moderation before public rated play. Set puzzle licensing and personal-game privacy rules before puzzles and AI explanations ship.

**Swiss rules.** Select a pairing implementation, scoring, tie-breaks, byes, repeat-opponent and color rules, withdrawals, no-shows, late entry, minimum attendance, cancellation, break length, and the duration estimate. Freezing the time control, round count, and rated status at tournament start is the current proposal.

**Custom challenges.** Choose allowed time limits and increments, pool assignment, and rated eligibility. Custom controls remain limited to direct challenges.

Record approved choices with their date, rationale, and consequences, then update the [roadmap](roadmap.md) and architecture where needed. Detailed rules can wait until their feature is due; the initial game cannot wait for clear clock and recovery behavior.
