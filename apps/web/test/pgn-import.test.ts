import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAnalysisTree, nextPosition, playAnalysisMove, selectMain } from '../src/analysis-model';
import { replayFen } from '../src/board-model';
import { importPgn, importPgnFile, importedResultDisplay } from '../src/pgn-import';
import { reviewPositions } from '../src/game-review';

describe('local PGN analysis', () => {
  it('reads a real .pgn file and opens its legal main line for analysis', async () => {
    const bytes = readFileSync(new URL('./fixtures/club-match.pgn', import.meta.url));
    const file = new File([bytes], 'club-match.pgn', { type: 'application/x-chess-pgn' });
    const imported = await importPgnFile(file, 'from-file');
    expect(imported.headers).toMatchObject({ White: 'Ada', Black: 'Ben', WhiteElo: '1820' });
    expect(imported.game.history.map(move => move.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(imported.game.status).toBe('finished');
    expect(replayFen(imported.game, 0)).toBe(imported.game.history[0]?.beforeFen);
    expect(replayFen(imported.game, 4)).toBe(imported.game.position.fen);
    expect(createAnalysisTree(imported.game).cursor).toEqual({ kind: 'main', ply: 4 });
  });

  it('reports unreadable, oversized, and invalid files without hiding parser errors', async () => {
    await expect(importPgnFile({ size: 1, text: async () => { throw new Error('disk failure'); } }, 'bad'))
      .rejects.toThrow('Could not read this PGN file.');
    await expect(importPgnFile({ size: 1_000_001, text: async () => '' }, 'large'))
      .rejects.toThrow('smaller than 1 MB');
    await expect(importPgnFile(new File(['1. e4 {comment} *'], 'annotated.pgn'), 'unsupported'))
      .rejects.toThrow('one main line only');
  });

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
