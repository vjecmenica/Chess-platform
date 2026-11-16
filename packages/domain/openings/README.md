# Opening names

The generated index in `src/opening-data.ts` uses the five Lichess Chess Openings TSV files at [revision 3ba6b20](https://github.com/lichess-org/chess-openings/tree/3ba6b20d31b2e6125cb0e6a2e792f400717d9d39) under [CC0-1.0](CC0-1.0.txt). The index contains 3,865 normalized positions. It contains no TWIC game records or statistics.

To regenerate, obtain `a.tsv` through `e.tsv` from that revision and run:

```sh
npm run build:packages
node packages/domain/scripts/generate-openings.mjs <directory-with-tsv-files>
```

The generator validates each line with chess.js and indexes the final normalized position. For a shared position, the deepest source line wins, followed by ECO and name in code-point order. The game label scans the first 36 confirmed plies, the longest source line, and keeps the deepest named match, taking the latest match on a tie. Transpositions share position keys. A later unrecognized move leaves the label in place. The browser loads the index as a separate chunk and uses the game’s main line or supplied PGN opening metadata.
