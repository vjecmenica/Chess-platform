# Private game notes

Chat and Notes share the site-game panel. Notes are plain text (10,000 characters)
and remain editable after the game. Changes autosave after 650 ms without typing;
blur, switching tabs and hiding the panel also flush pending edits. The editor stays
mounted and editable during saves. Small Saving/Saved/error feedback is outside the
writing area. Wait for Saved before leaving; unsaved edits trigger the browser's
leave/reload warning and a best-effort save. Mobile browsers may not warn or finish
that request on forced app termination. Drafts are not persisted in browser storage.

Migration `022_private_game_notes.sql` adds independent note storage. No explorer
source records or import tables change. Apply migrations during a planned deployment,
not against an ongoing import for this UI task.

Every GET/PUT checks participation and resolves the current authenticated owner.
Account notes follow the account across authenticated sessions. Guest notes follow
only the original guest session; loss of that session may lose access. Signing in
never copies guest notes to an account. Different owners always see their own empty
or saved editor, with no opponent-note existence flag. Notes never enter chat, SSE,
move history, or game reads. Saves use CSRF protection and optimistic versions;
conflicts preserve the local draft and stop autosave until the owner reloads to
compare, then explicitly keeps their edits or uses the saved notes. Network failures
offer Retry save. Returning focus reloads the current owner/version; drafts remain
separate by owner within the open editor and are never copied to another account.

Opening Book pagination reports the page count of at most 50 example games, in
pages of 10. It is not a total-corpus count. A bounded indexed query reads only
that sample and derives the number of pages without counting the full corpus.
