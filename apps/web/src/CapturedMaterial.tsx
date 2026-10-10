import type { GameSide } from '@chess/contracts';
import type { ReactNode } from 'react';
import { pieceImage } from './board-interaction';
import type { CapturedPiece } from './board-display';

const names: Readonly<Record<CapturedPiece, string>> = {
  q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn',
};

export function PlayerMaterialPanel({ side, pieces, advantage, placement, children }: {
  side: GameSide; pieces: readonly CapturedPiece[];
  advantage: { side: GameSide; points: number } | null;
  placement: 'top' | 'bottom'; children: ReactNode;
}) {
  const row = <div className="player-material-row">
    <CapturedRow side={side} pieces={pieces} placement={placement} />
    <MaterialTotal advantage={advantage} bottomSide={side} />
  </div>;
  return <div className={`player-material-panel player-material-${placement}`}>
    {placement === 'top' && row}
    {children}
    {placement === 'bottom' && row}
  </div>;
}

export function CapturedRow({ side, pieces, placement }: {
  side: GameSide; pieces: readonly CapturedPiece[]; placement: 'top' | 'bottom';
}) {
  const opponent = side === 'white' ? 'black' : 'white';
  return <div className={`captured-row captured-${placement} captured-${opponent}`}
    aria-label={pieces.length > 0 ? `${side === 'white' ? 'White' : 'Black'} captured pieces` : undefined}>
    {pieces.map((piece, index) => <img key={`${piece}-${index}`}
      src={pieceImage((opponent === 'white' ? piece.toUpperCase() : piece) as Parameters<typeof pieceImage>[0])}
      alt={`Captured ${opponent} ${names[piece]}`} draggable={false} />)}
  </div>;
}

export function signedMaterial(advantage: { side: GameSide; points: number } | null,
  bottomSide: GameSide): number | null {
  return advantage === null ? null : advantage.side === bottomSide ? advantage.points : -advantage.points;
}

export function MaterialTotal({ advantage, bottomSide }: {
  advantage: { side: GameSide; points: number } | null;
  bottomSide: GameSide;
}) {
  const balance = signedMaterial(advantage, bottomSide);
  return balance === null ? null : <span className={`material-total ${balance > 0 ? 'material-positive' : 'material-negative'}`}
    aria-label={`${bottomSide === 'white' ? 'White' : 'Black'} material balance ${balance > 0 ? '+' : ''}${balance}`}>
    {balance > 0 ? '+' : ''}{balance}
  </span>;
}
