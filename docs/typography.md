# UI typography

The shared scale lives in `apps/web/src/style.css` on `:root` and applies to home,
challenges, live games, and all analysis sources. Use semantic roles rather than
introducing smaller analysis-only or mobile-only overrides:

| Variable | Default | Role |
| --- | --- | --- |
| `--text-body` | 16px | Explanations, empty/error states, chat messages, player names, ordinary content |
| `--text-compact` | 14px | Buttons, form labels, table cells/headers, engine candidate lines, variations |
| `--text-meta` | 13px | Secondary source notices, compact metadata and player-side labels |
| `--text-caption` | 12px | Timestamps, inline move numbers, annotation badges |
| `--text-heading` | 20px | Card headings, including Engine Evaluation, Opening Book and Game chat |

The scale uses rem units with the browser's default root size (normally 16px), a
1.5 body line height, and the existing system font. Custom browser font defaults
are respected. Muted readable text uses `--color-text-muted`. Controls use a compact line height. Mobile
layouts should wrap or reflow rather than reduce body or table text to 10–11px.

Opening Book outcomes show a proportional color bar with separate White/Draw/Black
percentages in that order. Percentage text has its own space rather than being
clipped inside small segments. On narrow screens, the outcomes occupy a second row
under the move, played percentage, and count. The underlying counts and percentages
are unchanged, including the more precise accessible result description.

Board pieces and coordinates, clocks, evaluation/accuracy figures, and chart axes
have independent sizes. Their geometric or numeric scales are not typography
tokens; do not enlarge them as a side effect of changing card text. Large home-page
hero text also retains its separate display treatment. Keep detailed tables and
engine output scrollable only where their content actually needs it.

Info/Chat/Notes, Moves/Opening Book and Computer Analysis/Move times share
`.analysis-view-tabs`: use `--tab-height`, `--tab-padding`, and `--tab-gap` rather
than panel-specific button dimensions. Their active underline and focus outline use
the interface theme's accent and focus colors. Game Info uses 16px player
names and result scores, 14px values and 13px labels. Missing player ratings use
an accessible dash; the game's Unrated status is stated once.

Time-control symbols are original 20px inline SVGs accompanied by category text.
Their display categories follow the explicit preset assignments in the product
specification, not an inferred rating pool. Unknown/custom controls have no guessed
category. Simple PGN controls can match a supported preset but retain their raw tag
and PGN source label; multi-stage controls remain raw metadata.

## Button hierarchy

Use `primary` for the main action within a form or task, such as creating a
challenge, signing in, saving settings, or requesting analysis. Use
`accent-action` for supporting actions such as Rematch, the neutral treatment
for close and cancel, and `danger` for resignation and deletion. Move links,
tabs, board controls, and charts have their own interaction states.

Interface colors are defined in `apps/web/src/interface-themes.css`. Use its
semantic tokens for surfaces, text, borders, controls, and status. Add palettes
there and add their identifiers to `apps/web/src/interface-theme.ts`. Settings
applies the selected palette immediately and saves it under
`chess.interface-theme.v1` in local storage. Board & Pieces has its own saved
appearance and uses the separate `--appearance-*` variables.
