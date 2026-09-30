import type { GameReadResponse, GameSide, MoveAcceptedResponse, SavedMove } from '@chess/contracts';

export type Square = `${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h'}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export type Piece = 'p' | 'n' | 'b' | 'r' | 'q' | 'k' | 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';
export interface BoardSquare { square: Square; piece: Piece | null; dark: boolean }

const files = 'abcdefgh';
const pieces = new Set('pnbrqkPNBRQK');

export function boardRows(fen: string, seat: GameSide): BoardSquare[][] {
  const ranks = fen.split(' ')[0]?.split('/');
  if (ranks?.length !== 8) throw new Error('The saved position has an invalid board.');
  const bySquare = new Map<Square, Piece>();
  for (const [rankIndex, rank] of ranks.entries()) {
    let fileIndex = 0;
    for (const char of rank) {
      if (/^[1-8]$/.test(char)) fileIndex += Number(char);
      else if (pieces.has(char)) {
        if (fileIndex >= 8) throw new Error('The saved position has an invalid board.');
        bySquare.set(`${files[fileIndex]}${8 - rankIndex}` as Square, char as Piece);
        fileIndex += 1;
      } else throw new Error('The saved position has an invalid board.');
    }
    if (fileIndex !== 8) throw new Error('The saved position has an invalid board.');
  }
  const visibleFiles = seat === 'white' ? [...files] : [...files].reverse();
  const visibleRanks = seat === 'white' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  return visibleRanks.map(rank => visibleFiles.map(file => {
    const square = `${file}${rank}` as Square;
    return { square, piece: bySquare.get(square) ?? null,
      dark: (files.indexOf(file) + rank) % 2 === 1 };
  }));
}

export function pieceBelongsTo(piece: Piece | null, side: GameSide): boolean {
  return piece !== null && (side === 'white' ? piece === piece.toUpperCase() : piece === piece.toLowerCase());
}

export function needsPromotion(piece: Piece | null, destination: Square): boolean {
  return (piece === 'P' && destination.endsWith('8'))
    || (piece === 'p' && destination.endsWith('1'));
}

export function replayPly(ply: number, moveCount: number): number {
  return Math.max(0, Math.min(moveCount, ply));
}

export function replayFen(game: GameReadResponse, ply: number): string {
  const history = game.history;
  if (history.length === 0) return game.position.fen;
  if (history[history.length - 1]?.afterFen !== game.position.fen
    || history.some((move, index) => move.ply !== index + 1
      || (index > 0 && move.beforeFen !== history[index - 1]?.afterFen))) {
    throw new Error('Saved move history does not match the confirmed position.');
  }
  const index = replayPly(ply, history.length);
  return index === 0 ? history[0]!.beforeFen : history[index - 1]!.afterFen;
}

export function mergeConfirmedGame(current: GameReadResponse | null,
  incoming: GameReadResponse): GameReadResponse {
  return current !== null && incoming.version < current.version ? current : incoming;
}

export function applyAcceptedMove(current: GameReadResponse | null,
  response: MoveAcceptedResponse): GameReadResponse | null {
  if (current === null || response.game.version !== current.version + 1
    || response.move.ply !== current.history.length + 1) return current;
  const history: SavedMove[] = [...current.history, response.move];
  return { ...response.game, history };
}
