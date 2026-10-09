import type { GameReadResponse } from '@chess/contracts';
import { parsePgn } from '@chess/domain';

export interface ImportedGame {
  readonly game: GameReadResponse;
  readonly headers: Readonly<Record<string, string>>;
  readonly result: '1-0' | '0-1' | '1/2-1/2' | '*';
}

export function importPgn(text: string, id: string): ImportedGame {
  const parsed = parsePgn(text);
  const result = parsed.result === '*' ? null : parsed.result === '1/2-1/2'
    ? { outcome: 'draw' as const, reason: 'pgn_import' }
    : { outcome: 'win' as const, reason: 'pgn_import',
      winner: parsed.result === '1-0' ? 'white' as const : 'black' as const };
  return {
    headers: parsed.headers, result: parsed.result,
    game: {
      id, version: 1, status: 'finished', position: {
        fen: parsed.finalFen, sideToMove: parsed.sideToMove }, result,
      drawOffer: null, claimDrawOffer: null, availableDrawClaims: [],
      timeoutAdjudication: null, drawOfferNextEligiblePly: { white: 2, black: 2 },
      clocks: null, clockStatus: 'not_integrated',
      timeControl: { initialMs: 300_000, incrementMs: 3_000 },
      rated: false, yourSeat: 'white',
      history: parsed.moves.map(move => ({ ...move, remainingMsAfterMove: null })),
    },
  };
}

export function importedResultDisplay(imported: ImportedGame): { score: string; explanation: string } {
  switch (imported.result) {
    case '1-0': return { score: '1-0', explanation: 'White won.' };
    case '0-1': return { score: '0-1', explanation: 'Black won.' };
    case '1/2-1/2': return { score: '½–½', explanation: 'Draw.' };
    case '*': return { score: '—', explanation: 'Result not recorded in PGN.' };
  }
}
