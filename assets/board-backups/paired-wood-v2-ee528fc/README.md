# Paired wood v2 backup (ee528fc)

This directory preserves the exact four shipped JPEGs and theme/rendering definitions
before the photographic wood update. It is outside Vite's public directory and is not
bundled or downloaded by the application. The manifest and provenance are unchanged
snapshots, including the original generation prompts and checksums.

To restore just these wood themes (from the repository root):

1. Copy the four `*-v2.jpg` files into `apps/web/public/boards/`.
2. In `apps/web/src/appearance-styles.ts`, use the two texture pairs from
   `appearance-styles.ts.snapshot` (`natural-light-v2.jpg`, `natural-dark-v2.jpg`,
   `golden-light-v2.jpg`, `golden-dark-v2.jpg`). Restore the old texture variables
   and per-square backgrounds using the TypeScript and CSS snapshots. Set
   `--appearance-texture-size` to `cover` and omit the later crop selectors.
   The stored colors and IDs in `appearance.ts.snapshot` are unchanged.
3. Replace the two `kind: board-texture` manifest entries with those in this
   directory's `manifest.json`, and copy `PROVENANCE.md` back into public/boards.
4. Restore the texture credit paragraph to the wording in PROVENANCE, then run
   `npm run check` and rebuild. Do not replace whole live TypeScript/CSS files:
   their snapshots are references, not a reason to undo unrelated improvements.

The CSS snapshot records the original centered, cover-size square backgrounds.
