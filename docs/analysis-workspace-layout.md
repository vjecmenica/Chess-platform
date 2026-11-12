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
- Imported and blank analysis: Analysis / Game Review, without online Game Room.

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
Game Room mounts one GameChat with the existing Notes editor.
The floating launcher changes that same mounted component's CSS presentation;
there is no second chat controller, history, composer, poll timer or subscription.
Opening the overlay preserves the selected views. If opened from Game Room,
the main pane appears behind it temporarily. Selecting Game Room docks the
conversation. Escape or Close restores the room view and focuses the launcher.
Drafts, history, mute and quick-chat state survive.
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
