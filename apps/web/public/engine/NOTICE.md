# Stockfish browser engines

We distribute unmodified **Stockfish.js 19.0.0** WebAssembly builds from the pinned
`stockfish@19.0.0` npm release. Full assets are copied into `stockfish-19.0.0/`
by `npm run prepare:engines --workspace=@chess/web` (also run before dev/build).
They are served from our own origin; no runtime CDN or third-party engine request is used.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `stockfish-19.0.0/stockfish-19.js` | 32718 | `227b9317cb8fc347da722b3f6694c5f57eafe17842a8a1afbfe08c3aeeae5671` |
| `stockfish-19.0.0/stockfish-19.wasm` | 99065439 | `e0ef90031a310479e5b0c3692a9839118ed785535c306252e68ed3300a45b02d` |
| `stockfish-19.0.0/stockfish-19-single.js` | 21315 | `72772f8bdd7353e4e24245d946bb831f56bcccf02fa16a779c1b92a6c00e5cc2` |
| `stockfish-19.0.0/stockfish-19-single.wasm` | 99102793 | `8725c26572762617fd96b2ea83ff130e6640b85815890d682bf8c49db0820721` |
| `stockfish-19-lite-single.js` | 21415 | `d3344124ab067fb0b90ee77873bb8e9fbf5fc01bc525fe714b0f942581e889e6` |
| `stockfish-19-lite-single.wasm` | 1787571 | `57ac2d72312aba346760e3f173f687a8c211208e97a87268436f7f0e10bb5387` |

Stockfish.js is maintained by **Nathan Rugg**, copyright **2026 Chess.com, LLC**.
It includes Stockfish by Tord Romstad, Marco Costalba, Joona Kiiski, Gary Linscott,
the Stockfish team and other contributors. See the release's
[AUTHORS](https://github.com/nmrugg/stockfish.js/blob/v19.0.0/AUTHORS).
All these builds are licensed under **GNU GPL version 3**; a complete copy is
provided alongside them as [COPYING.txt](COPYING.txt).

**Exact corresponding source and build instructions:**
[Stockfish.js v19.0.0 source archive](https://github.com/nmrugg/stockfish.js/archive/refs/tags/v19.0.0.tar.gz),
[release source tree](https://github.com/nmrugg/stockfish.js/tree/v19.0.0), and
[build instructions](https://github.com/nmrugg/stockfish.js/blob/v19.0.0/README.md#how-do-i-compile-the-engine).
The tagged source contains the engine, browser adaptations and build scripts;
the build instructions identify Emscripten and the network retrieval steps.
Keep the license and these source directions available with deployed object files.
If upstream source availability changes, host the corresponding source archive too.

Interactive analysis defaults to Full (multithread-capable when isolated, otherwise
single-threaded), with Lite selectable for lower download/memory cost. Each Full WASM
is about 99 MB before HTTP compression; a browser loads only the selected variant.
Computer Analysis deliberately uses Lite, one thread, a 16 MB Hash, depth 14 / 1.2s
per position. The interactive Hash is also 16 MB. These are engine estimates, not
official ratings. Long searches can heat devices and drain batteries; Stop remains available.
