# Stockfish browser engine

This directory distributes the unmodified **Stockfish.js 19.0.0 lite single-threaded WebAssembly build**:

- `stockfish-19-lite-single.js` — SHA-256 `d3344124ab067fb0b90ee77873bb8e9fbf5fc01bc525fe714b0f942581e889e6`
- `stockfish-19-lite-single.wasm` — SHA-256 `57ac2d72312aba346760e3f173f687a8c211208e97a87268436f7f0e10bb5387`

The files came from the `stockfish@19.0.0` npm package, published from [Stockfish.js by Nathan Rugg](https://github.com/nmrugg/stockfish.js/tree/v19.0.0). Stockfish.js credits Chess.com, LLC, the Stockfish team, and other contributors in its [AUTHORS file](https://github.com/nmrugg/stockfish.js/blob/v19.0.0/AUTHORS). The exact release source is available at [the v19.0.0 tag](https://github.com/nmrugg/stockfish.js/archive/refs/tags/v19.0.0.tar.gz). The build is licensed under **GNU GPL version 3**; the full license accompanies it in [COPYING.txt](COPYING.txt).

This first browser integration uses one worker, one principal variation, a 16 MB hash table, and a bounded search. It is intended for self-analysis of finished games. The lite build is smaller and less strong than the full build. CPU use and battery drain can still be noticeable on mobile devices; stop the engine when finished. Engine output is an estimate, not an automatic move-quality label or whole-game review.
