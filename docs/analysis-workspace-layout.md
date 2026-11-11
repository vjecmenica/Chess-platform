# Shared game workspace

The navigation uses the existing icons and dark wood palette. At widths of 1400px
and above it is a 176px labelled sidebar; narrower desktops use the existing
64px icon rail, and screens below 701px use the compact disclosure menu. Georgia
is reserved for navigation labels and selected headings. Moves, clocks, charts,
chat, form controls and numerical data retain the sans-serif typography.

The desktop grid has two columns: the board/player strips and the right workspace.
The separate companion column and its collapse state are removed. Board utilities
remain beneath the board. The saved size, resize gestures, initial height budget
and square geometry are unchanged. The width bound no longer reserves space for
the removed companion column; this does not automatically enlarge the board.

`AnalysisWorkspaceTabs` owns presentation only:

- Play: Moves / Game Room.
- Analysis: Analysis / Game Review / Game Room.
- Imported and blank analysis: Analysis / Game Review, without online Game Room.

Every primary pane stays mounted. The Analysis pane retains EnginePanel and
Moves/Opening Book. Game Review retains its stable portal host; EnginePanel still
owns the independent interactive and review workers. Switching views does not
cancel workers, clear reports, rebuild the tree or request the explorer again.
Pressed buttons reserve Left/Right keys for existing board navigation.

The existing measured `--analysis-sidebar-height` remains the Analysis panel's
outer desktop height. Play retains its board-aligned sidebar height. All primary
views share their shell's dimensions; extensive content scrolls inside it. Mobile
and very short viewports use natural page flow.

Game Room renders one GameChat, including the existing Info and Notes views.
The floating launcher changes that same mounted component's CSS presentation;
there is no second chat controller, history, composer, poll timer or subscription.
Opening the overlay preserves the current primary view (opening from Game Room
returns to the main pane). Selecting Game Room docks Chat again. Escape or Close
returns focus to the launcher. Drafts, history, mute and quick-chat state survive.
Notes remain mounted and use their existing inactive-view/blur autosave behavior.

Unread counts follow actual chat visibility: hidden Game Room keeps receiving
messages, while visible floating or docked Chat marks them read. Muting retains
its existing server rules and suppresses badges. The launcher and Game Room tab
share the same count. The floating panel is viewport-bounded and never participates
in the workspace grid.

A compact notice outside the hidden panes exposes draw offers, pending actions,
connection errors and rematch offers. View game actions closes the overlay,
selects the main workspace and its Moves view, and focuses the primary button.
The original action controls and their logic are reused, not duplicated.

No game contracts, backend services, review calculations, or database schemas
are changed.
