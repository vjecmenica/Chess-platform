# Original board textures

Natural wood and Golden wood were created for Chess Platform with OpenAI's built-in image generation tool on 2026-11-04. No reference image, screenshot pixels, third-party texture, website artwork or existing chess assets were used as generation inputs. The BabasChess screenshots informed the requested material categories only.

These are project-original generated artwork, not externally licensed stock images. No third-party asset attribution was introduced. The existing piece licenses are separate and unchanged. The unified `/pieces/manifest.json` records the generation revisions, original-output hashes, shipped-file hashes and file paths.

The original generated PNGs were reduced to 512 × 512 JPEGs, quality 85, with high-quality bicubic resampling using Windows System.Drawing. No grain was painted or copied from another image. The shipped files total less than 90 KB. The browser covers each square with one image, blended using `soft-light` over the selected light/dark base colors; custom square colors remain usable. Solid themes explicitly remove the texture. No animated filters or per-frame texture work is performed.

## Natural wood prompt

Use case: product-mockup. Asset type: original repeating material texture for locally bundled chessboard squares. Create one square edge-to-edge orthographic scan of finely sanded natural maple wood, without objects, chessboard pattern, pieces, text, framing, lighting gradients, cast shadows or watermark. Uniform diffuse lighting, pale honey-cream neutral wood, visible fine long meandering grain and occasional gentle growth-ring curves, with restrained natural material character and tonal variation, no large knots or high contrast streaks. It should be seamless/tileable at all edges, appropriate as a quiet square background behind chess pieces, not a noisy overlay. Entire image is wood. Do not reproduce any existing chess site's or BabasChess texture. Fresh original material design.

Generation revision: `exec-4ab315cd-f095-4eb6-9d1a-1c04e5dc6531`.

## Golden wood prompt

Use case: product-mockup. Asset type: original seamless wood material for chessboard square backgrounds. Create one square edge-to-edge orthographic material scan of satin-finished golden oak veneer. Entire image is uninterrupted fine wood grain, clearly visible flowing longitudinal fibers and subtle softly curved growth lines. Warm golden honey tones, uniform diffuse illumination, no perspective or lighting gradients. Natural material detail should remain recognizable at small chess square sizes, moderate low contrast with broad quiet grain structures and fine pores, no large knots, no seams, no borders, no objects, no chessboard grid, no typography, no watermark. Tileable at all edges. It will be used behind chess pieces, so keep it restrained and calm. Fresh original texture; do not copy any existing chess software texture or assets.

Generation revision: `exec-ca011e0b-d44a-4b18-8aa4-4c7d29f844e0`.
