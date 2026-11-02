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
are respected. Muted readable text uses `--text-muted`; wood surfaces retain their
existing high-contrast cream labels. Controls use a compact line height. Mobile
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
than panel-specific button dimensions. Their active underline and text use wood
neutrals, with the same inset keyboard-focus outline. Game Info uses 16px player
names and result scores, 14px values and 13px labels. Missing player ratings use
an accessible dash; the game's Unrated status is stated once.

Time-control symbols are original 20px inline SVGs accompanied by category text.
Their display categories follow the explicit preset assignments in the product
specification, not an inferred rating pool. Unknown/custom controls have no guessed
category. Simple PGN controls can match a supported preset but retain their raw tag
and PGN source label; multi-stage controls remain raw metadata.

## Button hierarchy

Buttons default to a quiet cream surface with a wood-neutral border. Use the explicit
`primary` class for the main action within a form or task (create/accept challenge,
authentication, save settings, send, start engine, request analysis). It uses a blue
surface, white text, a short lower edge, hover/pressed feedback, and a light-blue
keyboard focus ring. Use `secondary` for cancel, stop, close, retry navigation and
supporting actions. Use `danger` for resignation and deletion. Move links, tabs,
board controls and charts keep their own interaction styling and never receive
`primary`. Disabled primary actions lose their shadow and saturation. Reduced-motion
preferences disable button translation and transition. Component rules should set
layout and spacing without overriding semantic button colors.
