# Bounded TWIC recoverability investigation

This was a read-only investigation of six disjoint windows of 5,000 source records:
1–5,000, 200,001–205,000, 400,001–405,000, 600,001–605,000,
800,001–805,000 and 1,000,001–1,005,000. These are chronological samples, not random
samples and not full-file recovery totals. The existing splitter scanned intervening
records without parsing them. Only the selected 30,000 records underwent full validation.
Private names, tags, movetext and source excerpts are not included here or in fixtures.

| Window start | Move/syntax failures | Missing result failures |
| ---: | ---: | ---: |
| 1 | 29 | 188 |
| 200,001 | 163 | 62 |
| 400,001 | 142 | 66 |
| 600,001 | 138 | 39 |
| 800,001 | 132 | 36 |
| 1,000,001 | 154 | 22 |
| Total | 758 | 413 |

There were also two malformed-header failures and one result mismatch. Main-line
parsing, rather than annotation cleanup, was the failure stage in the two major groups.

## Enabled rule: exact castling spelling

After existing annotation cleanup, change only a complete `0-0` or `0-0-0` move token
to `O-O` or `O-O-O`, retaining a move-number prefix and check/mate suffix. Require one
movetext result at the end before applying the spelling change. Headers and result
markers are not rewritten. The entire game still passes the existing strict parser,
including legal castling, starting-position and result checks. Original PGN text remains
stored unchanged. No permissive parser mode is enabled.

In these windows, six major-category failures contained candidate tokens. Four became
valid; two still failed other validation. Overall 1,167 of the 1,171 major-category
failures remained invalid (754 move/syntax, 413 missing result). All four recoveries
were ordinals **973, 974, 975 and 977** in the first window. Repeating the same windows through the shared path confirmed
exactly those four additional valid records and no additional recovery from missing-result
or other categories. This cannot estimate the count recoverable across all 41,187 failures.

Synthetic tests cover both colors and castling sides, attached move numbers, suffixes,
unchanged tags and fingerprints versus canonical games, and unchanged complete move/position
histories. Negative tests retain rejection of illegal castling, result disagreement,
multiple-result castling records, missing results, unmatched annotations and arbitrary footers.

## Investigated but not enabled

- **Post-result removal:** 412 of the 413 missing-result failures had a result followed
  by extra content; one had no movetext result. 348 had a dashed-separator footer and
  64 had another suffix. Trimming at the existing result made 406 prefixes validate;
  seven cases did not validate even under that probe. These are *valid prefixes*, not
  proven recoverable complete games. Generic trimming could discard later moves, tags,
  or another game, so no footer removal or result insertion is implemented. Ordinals
  1113, 200079, 400035, 600360, 800160 and 1001407 illustrate recurring footer structure.
- **Malformed Event framing:** ordinals 1609–1611 contain `[[Event` source lines,
  not valid inline Event tags. There were 55 such malformed lines in the first window,
  and none in the other five windows. A bounded boundary-only candidate for a complete valid
  Event tag recovered zero additional records and was removed. Repairing the extra
  bracket and moving that tag between records requires a separate provenance audit;
  it could change Event metadata and fingerprints of a previously accepted neighbor.
  The splitter is unchanged in this commit. No malformed header is silently repaired.
- **Origin disambiguation:** three other move failures per window were probed (18 in
  total). Seventeen used origin-disambiguation notation and passed the library's
  permissive parser; one failed that parser too. Examples include ordinals 173, 200014,
  400033, 600052, 800036 and 1000026. A permissive parse is not proof that the original
  origin/capture/check information is consistent and unambiguous. No disambiguation
  stripping, coordinate-move conversion or permissive SAN acceptance is enabled.

## Supplementing existing data later — not executed

No database operation, import, ledger reset, table alteration or rebuild was performed.
No migration is needed for this code change. The original archive is unchanged.

1. With explicit authorization, make a read-only manifest from the original archive
   using the old splitter/preparation version and the new version. Record source ordinals
   and stable identities privately. Select **only previously rejected records newly
   passing the approved rule**, and require complete headers, moves and result preservation.
2. Validate this manifest on a disposable database first. Deduplicate recovered records
   against each other and existing canonical fingerprints. Canonical castling has the
   same UCI move sequence, header identity and result as equivalent accepted SAN, so the
   existing fingerprint scheme handles it. Do not change that fingerprint scheme.
3. If authorized, write a separate private PGN subset of only those recoveries. Its
   checksum creates a new import ledger entry through the existing administrative importer;
   the original completed-file entry stays intact. Use the database's existing configured
   opening depth, not a depth inferred from the diagnostic's metadata-only max-plies option.
4. The import transaction inserts fingerprints once, adds aggregates only for newly
   inserted fingerprints, and adds source records/position references only where missing.
   Retries and duplicate subset entries therefore must not add aggregate counts twice.
   Verify source/reference counts and aggregate deltas against the deduplicated manifest.

Do not simply rerun the unchanged completed archive: its checksum is already marked
complete and will be skipped. Do not reset that ledger entry to force a full import.
A full rebuild is unnecessary for the castling rule; a controlled append-only backfill
is sufficient. Future malformed-header/boundary repairs need extra care: restoring a
missing Event can change a previously accepted game's fingerprint, so blindly importing
corrected neighbors could double-count the same physical game. Such repairs require
identity reconciliation before any backfill, not just the current fingerprint constraint.
