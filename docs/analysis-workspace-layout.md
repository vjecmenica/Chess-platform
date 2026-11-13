# Shared game workspace

The navigation uses the existing icons and dark wood palette. At widths of 1400px
and above it is a 176px labelled sidebar; narrower desktops use the existing
64px icon rail, and screens below 701px use the compact disclosure menu.
Fraunces is reserved for navigation labels, primary tabs, and prominent headings.
The functional interface uses the system font stack. Fraunces's Latin and Latin Extended
WOFF2 subsets are self-hosted, use swap loading, and include their OFL notices
in `apps/web/public/fonts`.

The desktop grid centers the board and workspace together. The right panel can
shrink with available space and stops growing at 550px. Board utilities sit at
the right end of the material row directly below the lower player strip. The
initial sizing budget retains its previous spacing allowance, so the shorter
tool row does not change the automatic board size.

`AnalysisWorkspaceTabs` owns presentation only:

- Play: Moves / Game Room.
- Analysis: Analysis / Game Review / Game Room.
- Imported games, including Opening Book examples: Analysis / Game Review / Game Room with PGN information.
- Blank analysis: Analysis / Game Review.

Every primary pane stays mounted. The Analysis pane retains EnginePanel and
Moves/Opening Book. Game Review retains its stable portal host; EnginePanel still
owns the independent interactive and review workers. Switching views does not
cancel workers, clear reports, rebuild the tree or request the explorer again.
Pressed buttons reserve Left/Right keys for existing board navigation.

The existing measured `--analysis-sidebar-height` remains the Analysis panel's
outer desktop height. Play aligns the sidebar with the measured upper and lower
clock edges. All primary
views share their shell's dimensions; extensive content scrolls inside it. Mobile
and very short viewports use natural page flow.

Play's Game Room switches between Info, Chat, and Notes. Analysis lets Chat/Notes
fill the space above the Game Info summary. Long conversations scroll inside the
chat history, and short viewports can scroll the room independently of the footer.
Game Room mounts one GameChat controller with the existing Notes editor.
The launcher opens a second chat view with its own scroll position. Both chat
views share the same history, draft, mute state, quick-chat state, and poll timer.
The docked view and selected tabs stay in place while the overlay is open.
Escape or Close dismisses the overlay and focuses the launcher.
Notes remain mounted and use their existing inactive-view/blur autosave behavior.

Unread counts follow actual chat visibility: hidden Game Room keeps receiving
messages, while visible floating or docked Chat marks them read. Muting retains
its existing server rules and suppresses badges. The launcher and Game Room tab
share the same count. The floating panel is viewport-bounded and never participates
in the workspace grid.

The workspace footer is a sibling of the tab panes. The existing results,
game actions, rematch controls, and retry messages stay mounted at the bottom
while the middle region switches views. Long footer states scroll internally.

No game contracts, backend services, review calculations, or database schemas
are changed.
