# Chess platform

A focused platform for competitive chess and game analysis, with the board first and no distracting animations.

Planned features include rated and casual games, friend challenges, matchmaking, four Glicko-2 rating pools, and Swiss tournaments. Analysis is central: saved-game replay, engine evaluations with multiple lines, and full game review with accuracy scores and move labels. Puzzles, practice from your own games, and engine-checked AI explanations follow later.

## Where the project stands

This repository contains documentation and empty source directories, with no runnable application yet. The [architecture](docs/architecture.md) is a proposal awaiting review.

First milestone: **two players follow a challenge link, play a legal game with server-controlled clocks, and replay it move by move.** A casual 5+3 game is the proposed starting scope. Interactive analysis and full game review follow saved games and precede Swiss tournaments.

## Start here

- [Product specification](docs/product-spec.md): agreed features, acceptance criteria, and unresolved rules.
- [Roadmap](docs/roadmap.md): small, verifiable steps from the first game through analysis and later features.
- [Architecture proposal](docs/architecture.md): server authority, clocks, persistence, analysis workers, and technology tradeoffs.

## Repository layout

```text
docs/                 Product specification, roadmap, and architecture
apps/web/             Future board, game pages, and analysis interface
apps/server/          Future API and authoritative game server
packages/domain/     Future game rules and business logic
packages/contracts/  Future message schemas and shared types
```

Source directories contain `.gitkeep` placeholders. Review the open choices before adding dependencies or implementation.

## Contributing

**Use English for all future repository content**, including documentation, code comments, tests, commit messages, and UI copy.

Distinguish requirements from proposals and record why choices are approved. Keep the documents consistent; check relative links and `git diff --check` before committing.
