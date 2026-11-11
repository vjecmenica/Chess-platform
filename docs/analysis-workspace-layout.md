# Analysis workspace layout

The shared navigation is a 64px desktop rail. Below 701px it becomes a compact
header with a disclosure menu. Unavailable destinations remain nonfunctional;
account and challenge links retain their existing destinations.

`AnalysisWorkspaceTabs` keeps both primary panes mounted. Its Analysis pane owns
the existing EnginePanel and Moves/Opening Book panes. Its Game Review pane owns
a stable portal host; EnginePanel continues to own both independent engine and
review lifecycles. Switching primary or secondary views does not cancel workers,
clear a report, reconstruct a tree, or re-request an explorer position. Pressed
buttons intentionally reserve Left/Right keys for existing board navigation.

The existing measured `--analysis-sidebar-height` is still the outer desktop
height. Review content scrolls within that height; the interactive evaluation
and move-time charts retain their navigation callbacks. Mobile uses natural page
flow. The obsolete full-width review host and empty second grid row are removed.

`CompanionPanel` keeps Info/Chat/Notes mounted while hidden. Play defaults to
expanded; Analysis defaults to collapsed, with separate in-session overrides.
Board utilities remain outside the hidden content. Hidden chat is not treated as
read, and hiding Notes triggers its existing inactive-view save path. Collapse
changes grid allocation, not the saved board-size preference. The prior 62px
header budget is retained only in the automatic board-size calculation so the
navigation relocation does not enlarge the default board.

No game contracts, backend services, review calculations, or database schemas
are changed.
