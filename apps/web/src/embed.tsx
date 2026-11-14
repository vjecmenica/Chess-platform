import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GameSide } from '@chess/contracts';
import type { ParsedPgn } from '@chess/domain';
import { boardRows, replayPly } from './board-model';
import { pieceImage } from './board-interaction';
import { publicReplay } from './public-replays';
import { readEmbedOptions } from './embed-links';
import './embed.css';

const names: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

function Replay({ game, orientation, ply: initialPly }: { game: ParsedPgn; orientation: GameSide; ply: number }) {
  const [ply, setPly] = useState(() => replayPly(initialPly, game.moves.length));
  const move = game.moves[ply - 1];
  const rows = boardRows(move?.afterFen ?? game.startingFen, orientation);
  const player = (side: GameSide) => side === 'white' ? game.headers.White ?? 'White' : game.headers.Black ?? 'Black';
  const top = orientation === 'white' ? 'black' : 'white';
  return <main className="embed-replay">
    <header><span>{player(top)}</span><strong aria-label="Game result">{game.result}</strong></header>
    <div className="embed-board" role="group" aria-label={`Chessboard, ${orientation} at the bottom`}>
      {rows.flat().map(({ square, piece, dark }) => <div key={square} data-square={square}
        className={`embed-square ${dark ? 'dark' : 'light'}`}
        data-last-move={square === move?.from || square === move?.to ? '' : undefined}>
        {piece && <img src={pieceImage(piece)} draggable={false} alt={`${square} ${piece === piece.toUpperCase()
          ? 'white' : 'black'} ${names[piece.toLowerCase()]}`} />}
      </div>)}
    </div>
    <p className="embed-player">{player(orientation)}</p>
    <div className="embed-controls" role="group" aria-label="Replay navigation" onKeyDown={event => {
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? game.moves.length
        : event.key === 'ArrowLeft' ? ply - 1 : event.key === 'ArrowRight' ? ply + 1 : null;
      if (target === null) return;
      event.preventDefault();
      setPly(replayPly(target, game.moves.length));
    }}>
      <button type="button" aria-label="First move" aria-disabled={ply === 0} onClick={() => setPly(0)}>Start</button>
      <button type="button" aria-label="Previous move" aria-disabled={ply === 0}
        onClick={() => setPly(value => replayPly(value - 1, game.moves.length))}>Previous</button>
      <button type="button" aria-label="Next move" aria-disabled={ply === game.moves.length}
        onClick={() => setPly(value => replayPly(value + 1, game.moves.length))}>Next</button>
      <button type="button" aria-label="Last move" aria-disabled={ply === game.moves.length}
        onClick={() => setPly(game.moves.length)}>End</button>
    </div>
    <p className="embed-status" role="status">{move ? `${Math.ceil(ply / 2)}${move.side === 'white' ? '.' : '…'} ${move.san} · ${ply}/${game.moves.length}`
      : 'Starting position'}</p>
  </main>;
}

const options = readEmbedOptions(new URL(location.href));
const game = publicReplay(options.id);
if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'minimalist-dark';
createRoot(document.getElementById('root')!).render(game ? <Replay game={game} {...options} />
  : <main className="embed-replay"><p role="alert">This game is unavailable for embedding.</p></main>);
