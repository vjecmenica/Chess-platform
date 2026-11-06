# Photographic wood textures

Verified/downloaded 2026-11-05. The source asset page identifies the diffuse map as
CC0. https://polyhaven.com/license explicitly permits commercial use, redistribution,
and inclusion in sold products. Attribution is appreciated, not required. We credit
the work in /pieces/credits.html. The full CC0 text is CC0-1.0.txt beside this file.
No runtime external requests, site screenshots, preview renders, BabasChess assets,
or generated grain are used.

## Exact source file

- Wood Table 001, Dimitrios Savva (photography), Rico Cilliers (processing):
  https://polyhaven.com/a/wood_table_001
  https://dl.polyhaven.org/file/ph-assets/Textures/jpg/4k/wood_table_001/wood_table_001_diff_4k.jpg
  SHA-256: 5da68c7ebe8732f029ecbd602cb0d86d2a271e32539df953a0f10efa052b9516

The source hash pins the download. The shipped files and hashes are in
/pieces/manifest.json, under their original photographic-wood-v3 asset revision.

## Derivatives and rendering

Each theme reuses its existing 512px color-treated Wood Table 001 JPEG. The two
files total 97,568 bytes, with one loaded per selected theme. To reproduce them,
pass the hash-verified source JPEG to `tools/prepare-board-photos.ps1 -TableSource`.
The original four-file recipe and its inputs are preserved in the v3 backup.

The board paints a single centered photograph at 200% width and native aspect ratio.
A mild blur, brightness adjustment and desaturation apply to this layer alone.
The photo extends past the board before the filter and is clipped to its perimeter
afterward. Each square paints a 70% tint from the theme or custom color, so light
and dark squares sample the same grain at every boundary. The six-column appearance
preview scales the photo by 8/6 to match the grain scale relative to a square.

## Previous version backup

`assets/board-backups/photographic-wood-v3-f004273/` contains all four pre-refinement
JPEGs, theme and rendering definitions, manifest and original provenance. The earlier
generated set is preserved in `assets/board-backups/paired-wood-v2-ee528fc/`. Both
directories are outside public/ and include restoration instructions.
