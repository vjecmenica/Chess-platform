import type { GameSide } from '@chess/contracts';
import { pieceImage } from './board-interaction';
import type { CapturedPiece } from './board-display';

const names: Readonly<Record<CapturedPiece, string>> = {
  q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn',
};

export function CapturedRow({ side, pieces, placement }: {
  side: GameSide; pieces: readonly CapturedPiece[]; placement: 'top' | 'bottom';
}) {
  if (pieces.length === 0) return null;
  const opponent = side === 'white' ? 'black' : 'white';
  return <div className={`captured-row captured-${placement}`}
    aria-label={`${side === 'white' ? 'White' : 'Black'} captured pieces`}>
    <span className="captured-player">{side === 'white' ? 'White' : 'Black'}</span>
    {pieces.map((piece, index) => <img key={`${piece}-${index}`}
      src={pieceImage((opponent === 'white' ? piece.toUpperCase() : piece) as Parameters<typeof pieceImage>[0])}
      alt={`Captured ${opponent} ${names[piece]}`} draggable={false} />)}
  </div>;
}

export function MaterialTotal({ advantage }: {
  advantage: { side: GameSide; points: number } | null;
}) {
  return advantage === null ? null : <span className="material-total"
    aria-label={`${advantage.side === 'white' ? 'White' : 'Black'} leads by ${advantage.points} material ${advantage.points === 1 ? 'point' : 'points'}`}>
    {advantage.side === 'white' ? 'White' : 'Black'} +{advantage.points}
  </span>;
}
