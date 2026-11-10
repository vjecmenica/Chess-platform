# Wood candidates — review only, 2026-11-06

The production Natural and Golden themes are restored byte-for-byte to f004273
using assets/board-backups/photographic-wood-v3-f004273. Their original crop mapping
is restored as well. The original A/B/C candidates remain review-only. The refined
A square treatment described below is now selectable; no appearance preference
or default was changed. The rejected blurred implementation
remains in Git history at 449dd32, not in an active style or additional backup.

Open index.html locally for a standalone comparison. This is a visual proof, not
an integrated game page. The position and clock labels are illustrative. The
pieces are the application's Kosal SVG assets, embedded unchanged, and the arrow
geometry matches BoardArrows. Existing Kosal notices remain in public/pieces/kosal.
Select a candidate or either restored theme, flip, and use the size slider.
Screenshots show 768px boards at a 1000x1100 viewport and 350px boards at 390x844.

## Candidates and mapping

All candidates crop the original 4096px photograph before resampling once to
1024px. No blur or sharpening is applied. Luminance variation is preserved with a
bounded contrast factor and recolored using the listed light/dark RGB midpoints.
One complete photograph spans the board. The alternating tint is baked at exact
128px intervals into the 1024px image. CSS paints this single image at 100% width
and height under the transparent square grid. No per-square offsets, random
transformations, runtime pixel processing, or gaps are involved. Flipping moves
pieces/labels/arrows only. All squares use the same grain scale. This prototype
uses fixed candidate colors. Integration with custom square colors, if selected,
would require aligned tint layers or an equivalent color customization step.

- A, Natural oak: Oak Veneer 01, crop x900 y800 size1800. Light (224,203,168),
  dark (139,102,69), contrast .65. Balanced flowing grain, 194075-byte JPEG.
- B, Walnut stain: Wood Table 001, crop x1000 y900 size2000. Light (223,203,175),
  dark (124,89,62), contrast .95. Stronger fibers and contrast, 261083-byte JPEG.
  Walnut describes the color treatment, not the photographed species.
- C, Honey oak: Oak Veneer 01, crop x1800 y1600 size1200. Light (234,211,167),
  dark (156,113,62), contrast .55. Broader grain and warmer tones, 198116-byte JPEG.

The retained high-resolution input files in .local are hash-verified below.
prepare.ps1 reproduces the JPEGs from those inputs from the repository root using
PowerShell 7 / System.Drawing on Windows. Quality is 92. Checker edges lie on JPEG
block boundaries. The UI uses a single image, so there cannot be independent image
rounding gaps at adjacent squares. Browser inspection found no gaps or jumps in
all eight rows/columns at the tested sizes. Other device pixel ratios were not
individually emulated. A real integrated candidate should still receive that check.

## Exact sources and license

Verified again on 2026-11-06. Poly Haven identifies each asset as CC0 and explicitly
permits commercial use and redistribution at https://polyhaven.com/license.
The license text is included as CC0-1.0.txt. No screenshot/reference-site assets,
preview renders, or AI-generated grain are used.

Oak Veneer 01, Jenelle van Heerden:
https://polyhaven.com/a/oak_veneer_01
https://dl.polyhaven.org/file/ph-assets/Textures/jpg/4k/oak_veneer_01/oak_veneer_01_diff_4k.jpg
SHA256 7e8c64811e580ef6664c20524606359c739e6fe030eff5c2c06c3482ecc8b1cf

Wood Table 001, Dimitrios Savva (photography), Rico Cilliers (processing):
https://polyhaven.com/a/wood_table_001
https://dl.polyhaven.org/file/ph-assets/Textures/jpg/4k/wood_table_001/wood_table_001_diff_4k.jpg
SHA256 5da68c7ebe8732f029ecbd602cb0d86d2a271e32539df953a0f10efa052b9516

## Verification

Restored CSS, appearance mapper, settings component and asset manifest match
f004273, and active JPEG hashes match the retained backup. npm run check passed
74 test files / 561 tests, all workspace type checks and builds. Initial sandboxed
checks failed due to Windows temp-file/socket permissions; the unrestricted rerun
passed. git diff --check passed. No database or user preference changes.

## Refined A: individual oak squares — 2026-11-10

`compare.html` and `oak-comparison.png` compare original continuous A with the
refined treatment. `squares.html` provides the standalone size/flip preview.
The application exposes the refinement as **Natural oak squares (texture)**.

`tools/prepare-oak-squares.ps1` creates one 2048px JPEG atlas (559464 bytes) from
64 distinct, non-overlapping source crops. Canonical square index i (a8=0,
h1=63) uses crop (23*i+11) modulo 64. All fibers keep their source direction;
each crop is luminance-normalized into A's light/dark palette. No blur, sharpening,
runtime image generation, or random selection is used. CSS selects the atlas cell
by algebraic square, so flipping and moving pieces cannot shuffle the grain.

Browser checks covered large and small boards, 1920x1080 desktop and 390x844
mobile, both orientations, highlights and arrows. All 64 square coordinates
remained stable after flipping; measured shared edges differed by less than
0.00004 CSS pixels. Separate device pixel ratios were not individually emulated.
`oak-mobile.png` shows the integrated narrow layout. `npm run check` passed
74 files / 562 tests, all workspace type checks and production builds.

## Revised A v2 — preview only, 2026-11-10

The old affine permutation kept source x constant within each board file. V2
uses a seeded Fisher-Yates permutation, rejecting maps with fewer than five
source columns or source rows in any board file/rank or either main diagonal.
Each same-color half of a line samples at least three source columns. The chosen
map passed on attempt 21. Files a–h sample 6,6,5,5,5,5,5,6 source columns.

All 64 non-overlapping 320px crops have distinct regions, with deterministic
origin offsets of up to 40px within their separated source cells. Crop size,
fiber direction, palette and contrast are unchanged. No rotations or filters
were added. Coordinates are recorded in oak-v2-crops.json, keyed by algebraic
square. revise-oak.mjs reproduces the map and prepare-oak-v2.ps1 makes the atlas.
The JPEG is 559924 bytes. Source remains Oak Veneer 01, Jenelle van Heerden,
Poly Haven CC0; exact URL/hash and license text are recorded above.

compare-v2.html and oak-v2-comparison.png show current Refined A versus v2 at
768px. oak-v2-empty.png exposes the grain; oak-v2-flipped.png shows orientation.
Browser inspection found no file-wide shared strip in v2, though related oak
fibers naturally remain. All 64 CSS crop coordinates stayed identical by square
after flip. At 350px the measured adjacent square gap was zero. Pieces,
highlights and both arrows remained legible. Two crop-map tests passed with
node --test design/wood-candidates/oak-v2.test.mjs; git diff --check passed.
No production asset, theme registration, preference, or application code was
changed for v2. Application checks were not rerun for this isolated preview.
