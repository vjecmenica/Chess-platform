import type { GameReadResponse } from '@chess/contracts';

export function canExportGame(game: GameReadResponse): boolean {
  return (game.status === 'finished' || game.status === 'aborted')
    && game.history.length > 0 && !game.id.startsWith('blank-')
    && !game.id.startsWith('explorer-');
}

export function exportGamePgn(game: GameReadResponse,
  sourceHeaders: Readonly<Record<string, string>> = {}): string {
  if (!canExportGame(game)) throw new Error('This game is not available for PGN download.');
  const result = game.result?.outcome === 'draw' ? '1/2-1/2'
    : game.result?.outcome === 'win' ? game.result.winner === 'white' ? '1-0' : '0-1' : '*';
  const headers: Record<string, string> = { ...sourceHeaders };
  if (Object.keys(sourceHeaders).length === 0) {
    headers.Site = 'Chess Platform';
    if (game.timeControl !== null) headers.TimeControl = 'source' in game.timeControl
      ? game.timeControl.raw
      : `${game.timeControl.initialMs / 1000}+${game.timeControl.incrementMs / 1000}`;
  }
  headers.Result = result;
  const tags = Object.entries(headers).map(([key, value]) =>
    `[${key} "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join('\n');
  const moves = game.history.map((move, index) =>
    `${index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ` : ''}${move.san}`).join(' ');
  return `${tags}\n\n${moves ? `${moves} ` : ''}${result}\n`;
}

export function pgnFile(text: string): Blob {
  return new Blob([text], { type: 'application/x-chess-pgn;charset=utf-8' });
}
