# Analysis navigation and board-size continuity

## Local reproduction and measurements

The November 2026 investigation used a synthetic 67-ply game with 478 local
variation moves: twelve long continuations with nested forks. The same sequence
of 24 selections jumped between trunks and consecutive moves within them, with
Stockfish 19 Full, one thread and three PVs, stopped and then continuously running.
The application was served by Vite in development/React Strict Mode in the local
Chromium in-app browser, without CPU throttling. The API was an in-memory fixture;
no PostgreSQL or explorer data was changed.

Temporary React Profiler boundaries measured the workspace and move list. A
capture-phase click timestamp followed by requestAnimationFrame measured time to
the next frame callback. These are local scheduling/render measurements, not
production benchmarks or exact display latency. Warm-up selections were excluded.

| Click-to-frame sample | Before median / p95 | After median / p95 |
| --- | --- | --- |
| Engine stopped (24 samples each) | 10.20 / 38.97 ms | 11.49 / 12.71 ms |
| Engine running (24 before, 23 captured after) | 16.03 / 48.83 ms | 10.27 / 18.41 ms |

The stopped median did not improve; the large stalls did. Workspace render p95
fell from 33.19 to 6.13 ms stopped and 55.09 to 21.15 ms running. The original
rank-by-rank updates repeatedly converted all PVs to legal SAN/FENs, about 6.12 ms
median per line. Reusing validated prefixes reduced that to 3.69 ms in this
navigation-heavy sample, where many roots are fresh. Rebuilding the move-list
element hierarchy and updating invisible ancestor-path flags also consumed time
as the tree grew.

The fixes keep the rendered line structure stable across cursor changes and
subscribe only the previous/new selected entries to selection updates. Tree edits
still rebuild the hierarchy. Engine UI publication coalesces searching updates
once per animation frame, with immediate off/error/completion transitions.
A per-panel, 192-prefix cache reuses legal SAN/FEN results, is bounded during
infinite searches, and clears on root changes. Scores are never cached by this
presentation cache. Hover previews remain component-local and perform no tree
edits or persistence writes. Analysis trees remain temporary; only existing
completed engine caches and display preferences use browser storage.

Fresh legal PV suffixes still require domain validation and can be expensive;
Stockfish itself also consumes CPU in its worker. The engine budget, candidate
count, review calculations and board/evaluation transitions were not reduced.
Initial mounting or editing a large tree remains more expensive than navigation.

A separate navigation race could leave the panel at "Loading Full · 100%": late
download progress replaced a cached result after the user returned from an
uncached position. Progress now leaves the current cached result intact while
the earlier worker finishes initialization. A controller regression test covers
progress followed by readiness without starting an unnecessary search.

## Board size

Site-game Analysis links carry a bounded `board` query value containing the
rendered frame width, including its coordinates. Direct load and refresh restore
that contextual size, preserving the live-to-Analysis square size. Entering
Analysis in the same tab also snapshots the rendered frame instead of resetting
to an automatic size. Normal CSS viewport limits continue to apply.

Only deliberate drag/keyboard resizing writes `chess.board-size.v1`. Reading a
link snapshot or clamping a large preference on a small viewport never overwrites
the preference. Existing board orientation, annotation-color preferences and
engine caches remain separate and unchanged. No database migration is involved.
