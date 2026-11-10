# Photographic wood textures — photographic-wood-v3

Verified/downloaded 2026-11-05. Both source asset pages identify the diffuse maps as
CC0. https://polyhaven.com/license explicitly permits commercial use, redistribution,
and inclusion in sold products. Attribution is appreciated, not required. We credit
both works in /pieces/credits.html; the full CC0 text is CC0-1.0.txt beside this file.
No runtime external requests, site screenshots, preview renders, BabasChess assets,
or generated grain are used.

## Exact source files

- Oak Veneer 01, Jenelle van Heerden: https://polyhaven.com/a/oak_veneer_01
  https://dl.polyhaven.org/file/ph-assets/Textures/jpg/4k/oak_veneer_01/oak_veneer_01_diff_4k.jpg
  SHA-256: 7e8c64811e580ef6664c20524606359c739e6fe030eff5c2c06c3482ecc8b1cf
- Wood Table 001, Dimitrios Savva (photography), Rico Cilliers (processing):
  https://polyhaven.com/a/wood_table_001
  https://dl.polyhaven.org/file/ph-assets/Textures/jpg/4k/wood_table_001/wood_table_001_diff_4k.jpg
  SHA-256: 5da68c7ebe8732f029ecbd602cb0d86d2a271e32539df953a0f10efa052b9516

These content hashes pin the exact downloaded versions; the provider has no Git
revision for these files. All derivative filenames/hashes are in /pieces/manifest.json.
Wood Table (a different pine asset) was inspected but rejected as too distressed;
it is not shipped. The oak/table photographs are better suited to a clean playing
surface than another generated pattern.

## Derivatives and rendering

The two photos are reduced with high-quality bicubic resampling to 512x512. A
luminance-preserving color treatment distinguishes pale oak / brown stained grain
(Natural) and honey oak / golden-brown stained grain (Golden). These are color
variants, not claims that the photos depict four different species of wood.
No fibers or knots are synthesized. The exact repeatable processing is in
`tools/prepare-board-photos.ps1`; supply the two locally downloaded, hash-verified
source JPEGs as -OakSource and -TableSource. JPEG quality is 88.

Natural light/dark RGB midpoint: (224,204,170)/(126,88,58); contrast .85/1.10.
Golden light/dark RGB midpoint: (237,211,161)/(159,112,59); contrast .85/1.05.
Each pixel retains its luminance difference from the source mean. The four shipped
images total 185,116 bytes (two images, about 93 KB, loaded for the selected theme).

CSS displays different 128px windows into each photograph using 400% background
size and deterministic crop positions. This reduces identical-square repetition
without per-square images, runtime filters or work on pointer events. Crops repeat
after sixteen cells; this is a small bounded material atlas, not nonrepeating wood.
Preview and game boards share the surface rules. Custom square colors still opt
into soft-light tinting. Solid/default theme and preference IDs are unchanged.

## Previous version backup

`assets/board-backups/paired-wood-v2-ee528fc/` contains the exact four previous JPEGs,
theme/style definitions, manifest and original generation provenance. Its README
explains restoration. It is outside public/ and is not shipped by Vite.

## Natural oak squares — oak-squares-v1

A separate optional theme, based on Candidate A and the same hash-pinned
Oak Veneer 01 diffuse map by Jenelle van Heerden (CC0), listed above.
64 different non-overlapping 320px crops are resized once to 256px and assembled
in a 2048px 8x8 JPEG atlas. Light midpoint (224,203,168), dark (139,102,69),
luminance contrast .65. No blur, sharpening, random noise, or runtime generation.
Source crop for board index i (a8=0, h1=63): v=(23*i+11)%64;
x=200+(v%8)*440, y=200+floor(v/8)*440. All grain retains its original direction.
Each tile's mean is normalized to keep contrast predictable across the board.
The bijection uses every crop once, with 32 light and 32 dark square variants.

tools/prepare-oak-squares.ps1 verifies the original SHA-256 and reproduces the
atlas offline. CSS indexes tiles by data-square, not DOM order. A square keeps
its material on flip, move, and rerender; resizing changes all tiles equally.
The same rules serve game, engine preview and settings boards. Custom colors
retain the existing soft-light treatment. Original Natural/Golden assets and
both backup directories remain unchanged. Existing preferences/defaults are not
migrated. The new theme adds no database requirements.

## Approved Natural wood — natural-oak-v4

Natural wood now uses the approved Revised A mixed-source-region preview, copied
byte-for-byte from design/wood-candidates/a-oak-squares-v2.jpg. Its 64 crop origins
and deterministic assignment are in oak-v2-crops.json; revise-oak.mjs and
prepare-oak-v2.ps1 reproduce it offline. Source remains the hash-pinned Oak Veneer
01 by Jenelle van Heerden, CC0, identified above. No new source or processing was
introduced on integration. The single 2048px atlas is 559924 bytes, with 800%
background sizing and algebraic-square coordinates. Both colors use the atlas.
The default and preference IDs are unchanged. Golden wood and oaksquares are
unchanged. The previous Natural version is preserved with restoration instructions
in assets/board-backups/natural-before-v4-2e0c4a4, in addition to older backups.
