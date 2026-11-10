# Board and piece appearance

Board & Pieces is in Account Settings and the board utility gear for guests and accounts. Basic piece/theme choices have a shared live preview; Advanced contains custom colors, scale (80–110%), vertical offset (−8–8%), frame color/width (1–5 px), thin square edges, and optional shadow (0–30%). Reset actions preview changes; Save appearance persists them. Solid palettes are original CSS colors. The default and all earlier theme IDs/colors remain unchanged.

Migration 025_board_appearance.sql adds nullable accounts.board_appearance. Existing accounts receive unchanged defaults. GET/PUT /account/appearance use existing participant-independent account sessions; writes require CSRF and an owner header to reject account-switch races. The server validates all IDs, colors and numeric limits. Guests save only to chess-board-appearance:guest:v1. Guest values never migrate automatically into an account. Settings load on startup/focus, and unknown saved IDs fall back to defaults. Save errors preserve the preview and show retry feedback. Appearance is not game/PGN data.

All board consumers use one source for piece URLs and CSS variables, including site play, analysis, imported/explorer games, captures, promotion and engine previews. Only appearance changes notify context consumers; position navigation does not update the appearance store. Glyph transforms leave square targets and board measurements unchanged. Frame rendering occupies reserved border space and cannot move player panels.

## Additional palettes and photographic wood materials

| Theme | Light base | Dark base | Surface |
| --- | --- | --- | --- |
| Muted purple | `#e9e1ee` | `#92809f` | Solid |
| Warm amber | `#f4e4bb` | `#b28b47` | Solid |
| Muted burgundy | `#efdfdc` | `#a06f78` | Solid |
| Natural wood | `#e3cba7` | `#896545` | Photographic oak / stained-table grain |
| Golden wood | `#e8dcc4` | `#927855` | Golden treatment of oak / stained-table grain |

The textured choices now use locally bundled CC0 photographs from Poly Haven: Oak Veneer 01 by Jenelle van Heerden and Wood Table 001 by Dimitrios Savva (photography) and Rico Cilliers (processing). Commercial use and redistribution are explicitly permitted. Exact diffuse-map URLs, source hashes and color treatment are documented in [texture provenance](../apps/web/public/boards/PROVENANCE.md). The asset manifest records source and derivative SHA-256 hashes. Product artwork credits link the authors, source pages, license and provenance. No BabasChess texture is used.

The v3 materials preserve photographed grain in 512px images with restrained light/dark color treatments. CSS selects different crops across squares instead of repeating one identical tile everywhere. Four JPEGs total 185,116 bytes; only the selected pair (about 93 KB) loads. There are no runtime filters or per-move image operations. The table lists fallback/custom colors, not every textured pixel. Custom colors retain soft-light tinting. Preview, main board and engine previews share these rules; legal hints retain a cream edge and warm themes retain the last-move boundary. Defaults and saved IDs remain unchanged.

The exact v2 JPEGs, definitions, CSS and provenance are backed up outside the production assets in [paired-wood-v2-ee528fc](../assets/board-backups/paired-wood-v2-ee528fc/README.md). Its README gives restoration steps without reverting unrelated UI changes.

White-side analysis fills are pure `#fff`, independent of the board palette: the evaluation bar, positive/zero PV score badges, and positive Computer Analysis graph areas share one variable. The graph uses a warm-gray `#e9e5dd` background so white areas remain distinct, retaining the baseline, brown trace and interactive targets. Negative fills remain `#333b36`. When both Board frame and Thin square borders are off, the eval-bar outer border and backing are transparent. Its reserved 1px border box remains, so disabling borders cannot resize or realign the bar. Either enabled border control restores its frame-color edge; keyboard focus stays visible.

No additional migration is needed: the existing version-1 JSON preferences and server-side preset validation accept the new IDs. Existing saved selections are neither rewritten nor reset.

Apply forward migration 025 through the existing migration command before deploying the new account endpoint. No game records or historical ownership are changed. The migration was validated only on the disposable test database during development.

Validation: `npm run check` covers type checks, the full non-database test suite, and all production builds. `npm run test:db -- apps/server/test/account-appearance.integration.test.ts apps/server/test/database.integration.test.ts` checks account isolation, cross-session persistence, CSRF/owner validation, and the migration system. Browser checks used the production preview at 1440×900 and 390×844, including live play, completed-game analysis, imported and blank analysis, flipping, resizing, captures, promotion and guest reload. Account persistence was verified by integration tests rather than manual account login. Asset tests verify twelve files per set, hashes, full license texts, and absence of external SVG resources.

The palette refinement additionally checked all five new presets on 497px and 311px boards at desktop/mobile widths, with Chessnut, Kosal, Celtic and RhosGFX. A read-only contrast fixture reused the actual board-model, piece, legal-hint, user-arrow and engine-arrow components at 320px/184px in both orientations. A completed browser-local Stockfish review of a synthetic PGN supplied both positive and negative graph areas. Removing borders was measured before/after: board 704×704px and bar 28×704px in both states. Tests also cover new-theme restoration, textured/custom-color surfaces, clearing textures on solid themes, bounded local files, and persistence of a borderless textured account preference across sessions.

## Asset audit and provenance

The original default was Chessnut by Alexis Luengas, Apache-2.0, with an existing attribution and full license. Every existing SVG was compared byte-for-byte against lila revision bdd824062fcf3a680687d20d7a7322c71d2dae53 and matched. No default artwork was replaced. Recommendation: retain Chessnut as the commercially reusable default; no Alpha or other personal-use set is present in the public piece assets. The board squares and frame were CSS colors, not downloaded textures. Existing Stockfish assets have separate GPL notices and are unaffected.

Added alternatives: Kosal by Philatype (CC-BY-4.0), obtained directly from philatype/kosal at fea676adb94de83e19834a2160b9f19ab94fd104; Celtic, Fantasy and Spatial by Maurizio Monge (MIT), with artwork rights verified directly at maurimo/chess-art revision 18baed27e8a2a721f1d60e7e27452166b3e20c1b. Their direct source contains configurable single-piece SVGs, so the complete credited two-color exports were obtained from the pinned lila revision above, whose COPYING.md specifically licenses those asset directories under MIT. RhosGFX by RhosGFX (CC0-1.0) is confirmed by the author's https://rhosgfx.itch.io/vector-chess-pieces page and the pinned asset-specific lila credit; the public author handle is used, not an invented legal name.

Human-readable notices are served at /pieces/credits.html and linked from settings. /pieces/manifest.json records every exact asset URL, revision, SHA-256, author, license and license evidence. Full licenses and per-set source notices are beside the SVGs. Only Kosal filenames were normalized; artwork bytes were not edited. No Alpha, Game Room, Companion, Maestro, Cardinal, Chess.com or BabasChess artwork was imported. There are no unresolved permissions for the shipped files; future asset updates must repeat revision-specific verification. No source code from the asset-hosting projects was copied.

Natural oak squares (oaksquares) is an additional opt-in theme. It uses 64
coordinate-bound crops of licensed Oak Veneer 01, at a consistent scale and
vertical grain direction. It does not replace Natural wood or Golden wood.
See public/boards/PROVENANCE.md and tools/prepare-oak-squares.ps1 for the exact
source, crop recipe and license. The data-square atlas mapping is shared by
play, engine previews and the settings swatch; no move-time randomization occurs.

Natural wood now selects the approved mixed-region oak atlas (natural-oak-v4),
without changing theme IDs or the default. Existing Natural wood selections use
it automatically; other choices remain unchanged. The previous Natural textures
and settings are in assets/board-backups/natural-before-v4-2e0c4a4. No migration.

Verification: npm run check passed (74 test files, 563 tests), including type
checks and all production builds. Browser inspection covered imported analysis
at 1440x1000 and 390x844, both orientations, annotation arrow, coordinate labels,
last-move highlights and a legal capture. All 64 crop positions were unchanged
by flip. Live site-game verification was blocked: the disposable test database
at 127.0.0.1:55434 refused connection; no existing database was modified.
