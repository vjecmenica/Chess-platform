# Shared game workspace

The navigation uses the existing icons and dark wood palette. At widths of 1400px
and above it is a 176px labelled sidebar; narrower desktops use the existing
64px icon rail, and screens below 701px use the compact disclosure menu.
Fraunces is reserved for navigation labels, primary tabs, and prominent headings.
The functional interface uses the system font stack. Fraunces's Latin and Latin Extended
WOFF2 subsets are self-hosted, use swap loading, and include their OFL notices
in `apps/web/public/fonts`.

The desktop grid centers the board and workspace together. The right panel can
shrink with available space and stops growing at 550px. Settings, Flip and
Resize use the existing desktop gap beside the board. On stacked layouts they
share the material row. The automatic board sizing budget is independent of
the tool row. Both player rows sit 5px from the board, with extra clearance
below the board when outside file labels are displayed.

`AnalysisWorkspaceTabs` owns presentation only:

- Play: Moves / Game Room.
- Analysis: Analysis / Game Review / Game Room.
- Imported games, including Opening Book examples: Analysis / Game Review / Game Room with PGN information.
- Blank analysis: Analysis / Game Review.

Completed Game Reviews are saved in this browser's IndexedDB, in the
`chess-game-reviews` database and `reviews` store. The 20 most recently completed
reviews are retained. The key hashes the game source and exact main line. The
record includes the review and accuracy method versions, Stockfish build, thread
count, search limits and completed position evaluations. A matching review
restores automatically. Analyze again runs a new review, and the previous saved
review stays available until a replacement completes.

Book metadata uses the same review key and is reused for up to seven days while
the recognition criteria still match. Local PGN files and pasted text are
session-local. Reopening the same PGN can recover its saved review.

Every primary pane stays mounted. The Analysis pane retains EnginePanel and
Moves/Opening Book. Game Review retains its stable portal host; EnginePanel still
owns the independent interactive and review workers. Switching views does not
cancel workers, clear reports, rebuild the tree or request the explorer again.
Pressed buttons reserve Left/Right keys for existing board navigation.

Play aligns its sidebar with the measured upper and lower clock edges. Desktop
Analysis measures from the upper edge to the viewport bottom and leaves a 20px
margin. All primary views share the same shell dimensions. Overflow scrolls
inside the panel, including on short desktops. Stacked Analysis uses natural page flow.

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

The workspace footer is a sibling of the tab panes. Results, game actions,
rematch controls, and retry messages stay mounted at the bottom while the
middle region switches views. Share & Export sits at the right of the action
row when available. Long footer states scroll internally.

No game contracts, backend services, review calculations, or database schemas
are changed.
