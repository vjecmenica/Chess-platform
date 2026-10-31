# Read-only source PGN diagnostics

From the repository root in PowerShell:

```powershell
npm run build:packages
npm run --silent explorer:diagnose -- --file "private-data/import-games/TWIC_PGN_FIDEIDS_1_834.pgn" --limit 10000 --samples 3
```

For the complete archive (no limit):

```powershell
npm run --silent explorer:diagnose -- --file "private-data/import-games/TWIC_PGN_FIDEIDS_1_834.pgn" --samples 3
```

`--silent` suppresses npm's command echo, which would otherwise repeat the input path.
Progress starts immediately and is written to **stderr** every five seconds and at
completion: examined record count, elapsed seconds, and average records/second.
No runtime ETA is printed because the CLI has no independently verified record total;
file byte size is not a reliable game-count proxy. Progress works with or without
npm `--silent`. Without it, npm also adds its own command/banner text to stdout;
use `--silent` when consuming the final JSON. To capture both streams separately:

```powershell
npm run --silent explorer:diagnose -- --file "private-data/import-games/TWIC_PGN_FIDEIDS_1_834.pgn" --limit 10000 --samples 3 > diagnostic.json 2> diagnostic-progress.log
```

`--limit` accepts 1–10,000,000 records. `coverage.scope: "prefix"` and
`limitReached: true` mean **all percentages describe only the examined prefix**, not
the full archive. A run ending before its limit has `complete_file` coverage. Reaching
a limit exactly equal to the file length is conservatively labelled a prefix; the
command does not read an extra record just to prove EOF. Samples retain source ordinals.

The command reads UTF-8 source records once through the importer's existing bounded
stream splitter and annotation cleanup. It uses the same strict domain PGN validator
as preparation, without constructing verbose replay history, fingerprints or opening
position indexes. It does not load
environment files, connect to PostgreSQL, acquire import locks, write reports/files,
or update import records. It does not deduplicate within the source either. A valid
duplicate counts as valid on every occurrence. Consequently these counts should
not be compared directly with accepted/skipped counts from a retried database import.
The reported historical import totals alone cannot determine source validity.
Nonstandard variants retain the importer's early exclusion; unfinished or empty games
still undergo strict validation before exclusion. There is no unsafe result-tag shortcut
that would classify an illegal unfinished game as excluded. Excluded games are parsed
once rather than reparsed to discover the reason. The importer itself still constructs
its normal complete records, fingerprints and indexes; its filtering and outputs do not change.

Output is JSON. `totals.records` is the number of records yielded by the splitter;
`valid + excluded + invalid` equals that total. Categories and top-level percentages
use examined source records as denominator. Exclusion precedence follows preparation:
nonstandard variant first, then a parsed unfinished result, then no moves. A malformed
unfinished game can still be invalid because parsing happens before result exclusion.
Preparation errors are grouped under fixed diagnostic labels, not raw parser errors.
Illegal moves and ambiguous syntax failures share a category where the parser cannot
distinguish them. Unknown future failures use `other_preparation_error`.

Feature and pairwise-overlap counts are per record, not number of occurrences.
Their `percent` denominator is `featurePercentDenominator` (inspectable records).
Samples are one-based source ordinals, not database IDs or line numbers. Each category,
feature and overlap keeps only the first `--samples` ordinals (default 3, range 0–20).
These intentionally are examples, not random or representative samples. No names,
source paths, raw PGNs, moves or private parser messages appear in diagnostic output.
Use the ordinals locally to inspect the private source yourself.

Syntax scanning skips initial tag-pair lines, respects brace/semicolon comment
boundaries, detects RAV parentheses outside comments, numeric NAGs and SAN-attached
symbolic annotations. It includes annotations within variations, even though the
importer validates only the retained main line. `recursive_variations` means any
PGN RAV; `nested_variations` means depth greater than one. Pairwise overlaps help
identify records mixing comments, RAVs and glyphs. Punctuation in tags or comments
does not count as variation/NAG/symbolic move syntax. `clock_directives` and
`eval_directives` require a closed `[%clk ...]` or `[%eval ...]` directive inside a
comment. They count syntactic presence, not the validity or provenance of its payload.
Prose comments alone do not establish the presence of engine analysis; even an eval
directive does not identify its author or engine.

Limits: feature scanning is lexical, not full validation of variation moves or
directive values. Malformed tag/comment boundaries are best-effort; records remain
classified using the real importer. PGN tag pairs must follow the importer's
line-oriented format. The existing splitter may resynchronize at an Event tag after
damage, so severely malformed input can change record boundaries. It emits a sentinel
instead of retaining records exceeding its 1,000,000-character bound or containing
NUL damage. Those have unknown features, counted in `featureUnavailable`, and cannot
be separated into exact oversize versus damage causes using the existing splitter.
Feature percentages therefore describe inspected records, not necessarily the whole
file. No claim is made that comments imply engine annotations or that lexical counts
prove an invalid PGN is well formed.

Memory is bounded by one source record and its validated board, a fixed set of counters,
and bounded ordinal samples. `--max-plies 24` (default, range 1–80) is retained as
report compatibility metadata; diagnostics builds no opening index and always validates
the complete main line, regardless of that setting.
Large archives still require CPU and disk time, so run this explicitly at a suitable
time. No full private corpus is part of automated tests or benchmarks.

## Windows measurements (2026-10-31)

Read-only measurements used the actual supplied archive in its local checkout. The
first 1,000 records had 994 valid, 0 excluded and 6 invalid games. Before optimization,
splitter time was 31 ms, feature scanning 29 ms, preparation 7,763 ms, and excluded
reparsing 0 ms. An additional separate 100-record probe took 1 ms for annotation
cleanup and 447 ms for full parsing. Total profiler time was 8.3 seconds including
that probe (about 7.8 seconds in the diagnostic stages). Preparation, not splitting
or feature scanning, was the measured bottleneck. Full parsing builds verbose move
history, and preparation additionally builds unused fingerprints and normalized indexes.

After optimization, the same 1,000-record CLI run took 2.0 seconds (507 records/s),
with unchanged classification totals. A 10,000-record prefix took 17.9 seconds
(558 records/s; 9,547 valid, 0 excluded, 453 invalid). Extrapolating these rates to
1,138,903 records gives approximately **34–38 minutes** on this machine under those
conditions. This is not a measured full run or a guarantee: later games, annotations,
invalid-record costs, disk/cache conditions and competing CPU work may differ.
The full archive was not diagnosed during this change, and no import or database
operation was run. Tests also compare strict validation-only decisions with preparation,
including malformed unfinished games, result conflicts, variants and annotations.
