# Read-only source PGN diagnostics

From the repository root in PowerShell:

```powershell
npm run build:packages
npm run --silent explorer:diagnose -- --file "private-data/import-games/TWIC_PGN_FIDEIDS_1_834.pgn" --samples 3
```

`--silent` suppresses npm's command echo, which would otherwise repeat the input path.
The command reads UTF-8 source records once through the importer's existing bounded
stream splitter and calls its unchanged preparation function. It does not load
environment files, connect to PostgreSQL, acquire import locks, write reports/files,
or update import records. It does not deduplicate within the source either. A valid
duplicate counts as valid on every occurrence. Consequently these counts should
not be compared directly with accepted/skipped counts from a retried database import.
The reported historical import totals alone cannot determine source validity.

Output is JSON. `totals.records` is the number of records yielded by the splitter;
`valid + excluded + invalid` equals that total. Categories and top-level percentages
use all source records as denominator. Exclusion precedence follows preparation:
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

Memory is bounded by one source record and its prepared game, a fixed set of counters,
and bounded ordinal samples. `--max-plies 24` (default, range 1–80) matches the current
opening-index preparation depth; it does not truncate main-line legality validation.
Large archives still require CPU and disk time, so run this explicitly at a suitable
time. No full private corpus is part of automated tests or benchmarks.
