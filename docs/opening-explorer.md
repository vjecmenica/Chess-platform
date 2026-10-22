# Self-hosted opening explorer

Finished-game Analysis has an **Explorer** tab beside the saved move list. It requests
only the selected position from our Fastify API. A candidate opens as a local analysis
move using the existing domain rules. Stockfish, review, and the saved game remain
independent. There is no Lichess request, OAuth requirement, external fallback, sample-game
list, PGN download, or source-game endpoint. Empty and unavailable books do not block analysis.
Opening names and ECO codes are not inferred from whole-game headers in this version.

## Private data and permission

The project owner reports permission from TWIC to use the supplied archives for an opening
book, add weekly PGN updates, and use the service commercially for £30/month once live,
with downloads limited to a restricted subset. Keep the agreement and the live-service
payment obligation in the project's private operational records. This implementation
offers **zero source-game downloads**; any later sample/download feature needs an explicit
limit that fits the agreement. This is licensed data, not a claim of CC0 or redistribution rights.

Keep archives outside the checkout or under ignored `private-data/`, never under
`apps/web/public`. PGN files and compressed PGNs are ignored except synthetic test fixtures.
Database files, dumps, bulk exports, backups, credentials, and import source files must
remain private. Do not commit them. The database stores counters and fingerprints, not
game text, player identities, FIDE IDs, or source PGNs.

## Setup and import

Install dependencies with `npm ci`, configure `DATABASE_URL` in the ignored repository-root
`.env`, and run:

```powershell
npm run build:packages
npm run db:migrate
npm run explorer:import -- --max-plies 24 --batch-size 100 "D:/PrivateChess/archive-1.pgn" "D:/PrivateChess/archive-2.pgn" "D:/PrivateChess/archive-3.pgn" "D:/PrivateChess/archive-4.pgn" "D:/PrivateChess/archive-5.pgn" "D:/PrivateChess/archive-6.pgn"
```

Use plain UTF-8 PGN files. Extract compressed archives privately before importing. Keep
input files immutable while the command runs. It reads each file twice: a streaming SHA-256
checksum pass, then streaming game framing and legal replay. Imports never run during
app startup. Only one importer runs per database, enforced by a PostgreSQL advisory lock.
No extra service or queue is required. Run large imports off peak: they share database IO
with live games. The CLI uses the same bounded database timeouts as the app; if a batch is
too slow, retry with a smaller `--batch-size` (1–500).

The first import fixes the book's depth, default **24 plies (12 complete moves)**, allowed
range 1–80. Subsequent files must use the same depth. A deeper book needs a deliberate
rebuild in a separate database; silently increasing depth would leave older games incomplete.
The entire main line is validated, but only moves whose preceding position occurs in the
first configured number of plies contribute. The index itself merges transpositions:
a position indexed at ply 8 is also available if a user reaches it at ply 12.

Each bounded batch (100 framed games by default) inserts new fingerprints and adds their
counters in one transaction, alongside import progress. No corpus-wide map is built in
memory. A game/line above one million characters is invalid; the framer recovers at the
next game header. The existing domain parser validates legal standard-start moves and
results. This administrative adapter removes comments, nested variations, and NAGs before
that replay; the browser's PGN import policy is unchanged. Unsupported variants, unfinished
games (`*`), and empty games are skipped. Illegal moves, damaged syntax, conflicting results,
custom starts, and overlong games are invalid. No partial game contributes statistics.

Output reports `processed`, `accepted`, `skipped`, and `invalid`; skipped includes duplicate
games. Counters describe the current attempt. A completed identical file returns
`alreadyImported: true` with zero new work. Inspect `chess.explorer_imports` for basename,
checksum, status, last committed counts, and update time. Input errors are counted without
logging private PGN text. A process crash can leave status `running`; rerunning recovers it.

## Weekly updates and deduplication

```powershell
npm run explorer:import -- --max-plies 24 "D:/PrivateChess/weekly-update.pgn"
```

A completed file's SHA-256 prevents exact reruns. Across different or interrupted files,
an identity-v1 fingerprint combines normalized White/Black names, Date, Event, Site, Round,
result, and the **complete legal main line in UCI**. Names and metadata use Unicode NFKC,
trimmed/collapsed whitespace, and lowercase. Ratings and FIDE IDs are excluded so adding IDs
to older games does not double-count them. Each new game's counters and fingerprint commit
together. On interruption rerun the same command; earlier batches become duplicates, not
new contributions. A transaction failure rolls back that batch.

This is conservative exact deduplication, not fuzzy entity matching. Corrected names, dates,
events, results, or move sequences can produce a second identity; two indistinguishable
games with missing metadata collapse. Hash collision risk is negligible but not mathematically
zero. Audit overlapping editions on a pilot dataset. Identity changes or correction/removal
of already imported games require a separate rebuild, because source games are not retained.
There is no destructive reset command. Back up the book and import metadata together.

## Statistics and API

`GET /api/opening-explorer?fen=<URL-encoded FEN>` requires the existing guest cookie. The
position is validated and canonicalized by the same chess.js domain adapter as gameplay:
piece placement, side to move, castling rights, and only legally available en passant count;
move counters do not. Exact canonical position text avoids position-hash collisions.

The response contains legal UCI/SAN candidates and `white`, `draws`, `black` counts. These
are final **game outcomes**, independent of whose turn it is. Candidate support is their
sum; percentages divide each outcome by that sum. A game contributes once per distinct
position/move pair, even after a repetition. If a game plays two different moves on separate
visits to the same position, it supports both candidates: summing candidate counts is not
a distinct-game total for the position. This preserves the previous per-candidate UI meaning.
No rating/FIDE-ID filter is applied: this is the licensed TWIC collection, not a promise
that every game meets a master-rating threshold.

The primary key `(position, uci)` serves exact-position queries. At most 218 candidates
(the standard-chess legal-move upper bound) return, sorted by supporting games then UCI.
Queries have a 1.5-second statement timeout, strict bounded parameters, and a bounded
process-local limit of 120 requests/minute/guest. Before wider public deployment add a
shared edge rate limit and monitor query latency; guest creation is not strong abuse control.
The client debounces replay navigation, serializes/cancels requests, times out after five
seconds, and holds at most 32 responses for five minutes in memory. Weekly changes can be
invisible in that tab until cache expiry. Only the Explorer tab of finished-game Analysis
makes these requests; live games do not.

The existing optional Book-badge contract means an exact legal move has positive support
for its preceding position, separately from engine classifications. This milestone does
not add automatic badge lookups across the move list.

## Capacity and operations

4.8 million games × 24 plies gives an upper bound of 115.2 million contributions before
deduplication, repeated pairs, and transpositions. The distinct `(position, move)` count
determines aggregate storage. Rough planning allowance: 200–350 bytes per distinct row
including its primary index, or about 23–40 GB at that deliberately pessimistic bound;
the 4.8 million fingerprint rows and index add roughly 0.5–1 GB. These are estimates, not
measurements. Allow substantial additional space for WAL, backups, index/page overhead,
and maintenance. PostgreSQL compression, shared positions, and filesystem details affect
actual sizes. No throughput or full-corpus size claim has been validated here.

First import a small private pilot PGN at the final intended depth in a disposable database.
Measure wall time, process RSS, WAL/disk growth, and query latency before scheduling all six
archives. Check table/index sizes with `pg_total_relation_size('chess.explorer_moves')` and
`pg_total_relation_size('chess.explorer_games')`, then run `ANALYZE chess.explorer_moves` after
a large import. Use `EXPLAIN (ANALYZE, BUFFERS)` for representative position queries. Inspect
accepted/skipped/invalid counts before proceeding. Do not extrapolate early common-opening
aggregation ratios blindly to later archives. Lower depth reduces cost but requires a new
rebuild database; lower batch size reduces per-transaction cost without changing statistics.

Migration `015_opening_explorer.sql` is forward-only and leaves games/challenges untouched.
The UI reports unavailable if it is missing. Tests use only synthetic PGNs. Full-corpus
ingestion and benchmarking require the owner's private files and remain an operational step.
