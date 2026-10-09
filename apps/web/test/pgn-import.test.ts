import { describe, expect, it } from 'vitest';
import { createAnalysisTree, nextPosition, playAnalysisMove, selectMain } from '../src/analysis-model';
import { replayFen } from '../src/board-model';
import { importPgn, importedResultDisplay } from '../src/pgn-import';
import { reviewPositions } from '../src/game-review';

describe('local PGN analysis', () => {
  it('navigates imported history and supports local variations and review positions', () => {
    const imported = importPgn('[White "Ada"]\n[Black "Ben"]\n\n1. e4 e5 2. Nf3 *', 'local-1');
    const game = imported.game;
    expect(game.status).toBe('finished');
    expect(game.history.map(move => move.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(replayFen(game, 0)).toBe(game.history[0]?.beforeFen);
    expect(replayFen(game, 3)).toBe(game.position.fen);
    const initial = selectMain(createAnalysisTree(game), game, 1);
    const alternative = playAnalysisMove(initial, game, 'c7', 'c5');
    expect(alternative.accepted).toBe(true);
    if (!alternative.accepted) return;
    expect(alternative.tree.nodes).toHaveLength(1);
    expect(nextPosition(initial, game).cursor).toEqual({ kind: 'main', ply: 2 });
    expect(game.history[1]?.san).toBe('e5');
    expect(reviewPositions(game)).toHaveLength(4);
    expect(importedResultDisplay(imported)).toEqual({ score: '—',
      explanation: 'Result not recorded in PGN.' });
  });

  it('retains decisive and drawn PGN results without changing saved game data', () => {
    expect(importedResultDisplay(importPgn('1. e4 1-0', 'white')))
      .toEqual({ score: '1-0', explanation: 'White won.' });
    expect(importedResultDisplay(importPgn('1. d4 0-1', 'black')))
      .toEqual({ score: '0-1', explanation: 'Black won.' });
    expect(importedResultDisplay(importPgn('1. c4 1/2-1/2', 'draw')))
      .toEqual({ score: '½–½', explanation: 'Draw.' });
  });
});
