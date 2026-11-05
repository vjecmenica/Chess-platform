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
