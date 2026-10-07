# Masters opening explorer

The Masters tab is currently unavailable while its data source and access policy are reviewed.
Opening it makes no external request, asks for no Lichess connection, and does not mark moves
Book. The analysis board, local variations, Stockfish, and game review continue to work.

An earlier prototype queried the official Lichess Masters endpoint from finished-game Analysis
and offered candidate moves as local variations. Its API and OAuth code remain in the repository
but are not mounted in the UI. Lichess's [Masters endpoint specification](https://github.com/lichess-org/api/blob/master/doc/specs/tags/openingexplorer/masters.yaml)
requires OAuth2. The project has guest sessions but no account-backed token vault. Re-enabling a
Masters source needs a deliberate access decision; a shared personal token is not acceptable.

If a future source supports this feature, a **Book** label should mean that the source returned
the exact legal played move for the preceding position with at least one supporting master game.
Book must stay separate from Stockfish quality labels and manual PGN annotations. A missing
result cannot prove that a move was never played in master games.
