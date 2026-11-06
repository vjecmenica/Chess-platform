# Photographic wood v3 backup (f004273)

This snapshot contains all four original `*-v3.jpg` files, the original manifest,
CC0 license, provenance, and preparation script. The `.snapshot` files preserve
the theme definitions, texture variables, settings preview and CSS from before
the continuous grain change. Vite serves the active assets from `public/boards`.

To restore v3 rendering:

1. Copy the four JPEGs into `apps/web/public/boards/`.
2. Restore the texture pairs and texture variables in `appearance-styles.ts` from
   `appearance-styles.ts.snapshot`. Restore the square background rules in
   `style.css.snapshot` in place of the board-wide grain layer and tints. Remove
   `--board-grain-size` from the appearance preview rule. The theme IDs and base
   colors in `appearance.ts.snapshot` are already in use.
3. Restore the wood entries in the asset manifest and the wood credits from this
   backup's `PROVENANCE.md`. Keep other asset and style changes in place.
