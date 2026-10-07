# Masters opening explorer

The first phase runs only in finished-game Analysis. It asks the official
[Lichess Masters Explorer endpoint](https://github.com/lichess-org/api/blob/master/doc/specs/tags/openingexplorer/masters.yaml)
for the selected position, using the saved starting FEN and selected move path. It shows
candidate moves, supporting game counts, White/draw/Black percentages, and an ECO code and
opening name when the response contains them. Choosing a move uses the local analysis tree;
it never changes the saved game. No lookup runs during live play.

**Book** means that a lookup for the position before the played move returned that exact legal
UCI move with at least one supporting master game. The endpoint returns a limited candidate
list, so an unmarked move is not proof that it never appeared in Masters data. Book is a
source-presence marker, separate from Stockfish move-quality labels and manual PGN annotations.
It appears once the preceding position has been checked in Analysis, not from an automatic
whole-game classification pass.

The browser requests at most 12 moves and no top-game records. Requests are serialized, have a
five-second timeout, and pause for at least one minute after a 429 response. A 32-position,
five-minute memory-only cache avoids repeated lookups while the page is open. No Masters
response is saved to local storage or the database; no corpus is downloaded, mirrored, or
redistributed. Service failure does not block the rest of Analysis.

The [Lichess Terms of Service](https://lichess.org/terms-of-service) explicitly allow API use in
applications, including commercial applications, subject to applicable licenses and fair-play
rules. The [API tips](https://lichess.org/page/api-tips) call for one request at a time and a full
minute's pause after a 429. The [official response schema](https://github.com/lichess-org/api/blob/master/doc/specs/schemas/OpeningExplorerMasters.yaml)
defines these statistics. The underlying Masters corpus is not described here as CC0; the Terms
distinguish licenses by component. The UI attributes the statistics to Lichess Masters Explorer.
