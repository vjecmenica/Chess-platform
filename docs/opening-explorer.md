# Self-hosted opening explorer

Finished-game Analysis has an **Opening Book** tab. It loads candidate moves and a restricted
sample of games reaching the selected position from our own API. Candidates create local
variations. Listed games open in the existing session-local replay/analysis view at the
matching ply, with complete main-line navigation, player metadata, Stockfish and review.
The original platform game is unchanged. No external service is a fallback.

**Masters** is the available source, backed by licensed TWIC data. **Site games** and
**Player** are disabled placeholders and make no dataset requests. The candidate list
shows about seven rows when space permits, with its own scrolling; shorter sidebars
reduce that area while retaining expanded example games and their pagination below it.
The interactive engine remains mounted above both sidebar tabs. Its header switch
controls only current-position evaluation, independently of Computer Analysis. The
header score reuses the current position’s first PV in White’s perspective; pending
positions and a stopped engine do not display another position’s score.
The blue plus beside the reached depth toggles continuous current-position analysis:
both depth and time limits become unlimited. Activating it again restores the last
bounded settings, including a single finite limit. The settings popover reflects the
same limits. The engine switch still stops the worker immediately; Computer Analysis
keeps its separate bounded search profile.

## Private source data

The owner reports TWIC permission for an opening book, weekly updates and commercial use
for £30/month once live, with downloads restricted to a subset. Keep the agreement and
payment obligation in private operational records. This is licensed data, not CC0.
This implementation adds **no PGN downloads or exports**. The bounded replay API returns
legal main-line moves and tags, never the original PGN text/comments/variations. Any public
replay necessarily exposes moves that a client could reconstruct; this is not DRM.

Keep source files outside the checkout or under ignored `private-data/`, never in web public
assets. Never commit archives, database files, backups or derived corpus datasets. Tests
use only synthetic PGNs. No production or full-corpus import is part of this change.

## Storage and indexing

Apply forward migration `016_explorer_game_records.sql`; migration 015 remains unchanged.
`explorer_records` retains each accepted game's complete original UTF-8 PGN text, including
comments, variations, line endings and spacing, plus all parsed tags as JSONB. Leading
blank separators between games are not part of a record. Invalid encodings are not promised
byte-identical recovery. Extracted columns include names, ratings, FIDE IDs, result, date,
event, site, round, ECO/opening and time control. Unknown/missing extracted values are null;
the original tags remain intact. Dates are text so partial dates remain representable.

`explorer_game_positions` maps canonical position to game ID, zero-based replay ply and
next UCI move. It records the first occurrence per game, through the configured depth,
including the position after the final indexed ply. A short game's final position has no
next move. Complete records are retained regardless of indexing depth, within the existing
parser limits (one million characters and 1,000 plies). Later positions are replayable but
not searchable. A **ply is one player's move**: the default 24 plies equals 12 full moves.

Canonical identity uses piece placement, side to move, castling rights and legally available
en passant; counters are excluded. Transpositions therefore share entries. Exact text keys
avoid position-hash collisions. Unique fingerprint and position/game constraints prevent
record/reference duplication. Foreign keys keep references tied to retained records.

## Initial import and weekly updates

Run `npm ci`, configure the private `DATABASE_URL`, then:

```powershell
npm run build:packages
npm run db:migrate
# First use a small privately prepared pilot in a disposable database.
npm run explorer:import -- --max-plies 24 --batch-size 20 "D:/PrivateChess/pilot.pgn"
# After inspecting counts, replay and capacity, use the intended corpus database.
npm run explorer:import -- --max-plies 24 --batch-size 100 "D:/PrivateChess/archive-1.pgn" "D:/PrivateChess/archive-2.pgn" "D:/PrivateChess/archive-3.pgn" "D:/PrivateChess/archive-4.pgn" "D:/PrivateChess/archive-5.pgn" "D:/PrivateChess/archive-6.pgn"
# Later updates use the same depth.
npm run explorer:import -- --max-plies 24 "D:/PrivateChess/weekly-update.pgn"
```

Plain UTF-8 PGNs only; extract archives privately. Keep files immutable during import.
The command streams twice: file checksum, then framed PGNs and legal main-line validation
through the existing domain parser. Comments/variations/NAGs are stripped only for replay
validation; the original remains stored. No startup import or new chess implementation.

The first import fixes depth (1–80 plies). Changing depth requires a deliberate rebuild in
a separate database. Batch size is 1–500 games (default 100), flushed early at eight million
source characters. JSON and parsed objects add memory overhead, but no corpus-wide map is
built. Fingerprints, records, references, aggregates and progress commit atomically. One
administrative importer per database is enforced by advisory lock. Lower batch size if a
transaction exceeds the configured database timeout.

Unfinished/empty games and unsupported variants are skipped. Illegal moves, custom starts,
conflicting results, malformed annotations and oversized records are invalid. The framer
recovers at a subsequent header. Counts report processed, accepted, skipped (including
duplicates), and invalid records without logging PGN text. Inspect `explorer_imports` for
file basename, checksum, status and last committed counts. No filesystem path is retained.

An identical completed file is skipped. Across files, identity-v1 hashes normalized player
names, Date/Event/Site/Round, result and the complete legal UCI main line. Ratings/FIDE IDs
are excluded so older editions without IDs do not double-count. First accepted copy wins;
duplicates do not replace annotations or enrich metadata. Corrected identifying fields
can produce a second identity; indistinguishable games with absent metadata can collapse.
This is conservative exact deduplication, not fuzzy matching. Audit overlapping pilots.

After interruption, rerun the same command: committed batches skip, uncommitted batches
retry. Migration 016 marks previous completed manifests retryable to backfill aggregate-only
imports; existing fingerprints do not contribute counters again. No corpus has been imported
yet, so apply all migrations before the initial pilot. No down/reset command is provided;
corrections use a new forward migration or deliberate maintenance process.

## Statistics and bounded API

All routes require the existing guest cookie and share 120 requests/minute/guest, a bounded
process-local guard. Add shared edge abuse protection before public scale: new guest sessions
are not strong corpus-scraping prevention. Queries use a 1.5-second statement timeout.

- `GET /api/opening-explorer?fen=...`: at most 218 legal UCI/SAN candidates. White/draw/Black
  counts are final game outcomes, independent of turn. Support is their sum; percentages
  divide by support. A game counts once per distinct position/move pair. If it plays two
  different moves on repeat visits, it supports both, so summed support is not a distinct
  position-game total. Aggregate semantics are unchanged.
- `GET /api/opening-explorer/games?fen=...&page=0`: ten metadata entries per page, pages 0–4,
  maximum 50 games per position. Stable ID order, not rating/date ranking; no total-count
  scan or arbitrary filters. A game's first matching ply/next move accompanies its metadata.
- `GET /api/opening-explorer/games/:id?fen=...`: one structured main-line replay, only when
  that game belongs to the position's first 50 matches. No PGN attachment or bulk route.

ECO/opening headers describe individual games, not an inferred name for every position.
Missing metadata is displayed as unavailable. Samples do not imply a master-rating threshold.
The optional Book-badge rule remains exact legal-move support greater than zero, independent
of engine labels; this change does not add background badge lookups.

Only finished-game Explorer tabs request data. Statistics retain their bounded 32-entry,
five-minute in-memory cache; game lists/replays are uncached, cancellable and time-limited.
Position changes reset pagination and discard stale requests. Errors offer retry without
blocking the board. No user-generated game access/export behavior is changed.

## Capacity planning

Measure a private pilot before importing millions of games. Let G be unique accepted games,
D the ply depth, P distinct aggregate position/move pairs, S measured average retained record
bytes (PGN, JSONB, extracted columns, TOAST and indexes), and R measured bytes per reference
including indexes. Estimate growth as `G × S + G × (D + 1) × R + aggregate bytes for P +
fingerprint/import overhead`. Short games and repeated positions reduce reference counts.
At 4.8 million games and depth 24, 120 million references is an upper bound, **not a measured
storage size**. Complete PGN storage is independent of indexing depth. Allow space for WAL,
backups, free pages and maintenance. This corpus has not been imported or benchmarked here.

Measure wall time, RSS, WAL growth and query latency on the pilot. Use
`pg_total_relation_size` for `chess.explorer_records`, `chess.explorer_game_positions`,
`chess.explorer_moves` and `chess.explorer_games`; include indexes/TOAST. Run ANALYZE on these
tables after large imports and inspect representative queries with EXPLAIN (ANALYZE, BUFFERS).
Do not extrapolate early common-opening aggregation ratios blindly to later archives.
