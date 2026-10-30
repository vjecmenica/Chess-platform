# Private game notes

Chat and Notes share the site-game panel. Notes are plain text (10,000 characters)
and remain editable after the game. Save explicitly; switching tabs or hiding the
panel keeps the editor mounted. Unsaved edits trigger the browser's leave/reload
warning. Mobile browsers may not warn on forced app termination: save before leaving.

Migration `022_private_game_notes.sql` adds independent note storage. No explorer
source records or import tables change. Apply migrations during a planned deployment,
not against an ongoing import for this UI task.

Every GET/PUT checks participation and resolves the current authenticated owner.
Account notes follow the account across authenticated sessions. Guest notes follow
only the original guest session; loss of that session may lose access. Signing in
never copies guest notes to an account. Different owners always see their own empty
or saved editor, with no opponent-note existence flag. Notes never enter chat, SSE,
move history, or game reads. Saves use CSRF protection and optimistic versions;
conflicts preserve the local draft for copying before a reload.

Opening Book pagination reports the page count of at most 50 example games, in
pages of 10. It is not a total-corpus count. A bounded indexed query reads only
that sample and derives the number of pages without counting the full corpus.
