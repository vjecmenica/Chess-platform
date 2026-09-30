import { describe, expect, it } from 'vitest';
import type { GameReadResponse } from '@chess/contracts';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { analysisFen, analysisSideToMove, navigateAnalysis, playAnalysisMove,
  startAnalysis } from '../src/analysis-model';

function finishedAt(fen: string): GameReadResponse {
  return { id: 'saved', version: 7, status: 'finished', yourSeat: 'white',
    position: { fen, sideToMove: fen.split(' ')[1] === 'w' ? 'white' : 'black' },
    result: { outcome: 'draw', reason: 'agreement' }, history: [], clocks: null,
    clockStatus: 'not_integrated', timeControl: { initialMs: 300_000, incrementMs: 3_000 },
    rated: false };
}

describe('local analysis line', () => {
  it('cannot enter analysis from an active game', () => {
    expect(() => startAnalysis({ ...finishedAt(STANDARD_STARTING_FEN), status: 'active' }, 0))
      .toThrow('finished game');
  });

  it('accepts legal moves for either side without changing the saved game', () => {
    const saved = finishedAt(STANDARD_STARTING_FEN);
    const first = playAnalysisMove(startAnalysis(saved, 0), 'e2', 'e4');
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    expect(first.move.san).toBe('e4');
    expect(analysisSideToMove(first.line)).toBe('black');
    const second = playAnalysisMove(first.line, 'e7', 'e5');
    expect(second.accepted).toBe(true);
    if (!second.accepted) return;
    expect(second.line.moves.map(move => move.san)).toEqual(['e4', 'e5']);
    expect(second.line.moves.map(move => move.ply)).toEqual([1, 2]);
    expect(saved.position.fen).toBe(STANDARD_STARTING_FEN);
    expect(saved.history).toEqual([]);
    expect(saved.result).toEqual({ outcome: 'draw', reason: 'agreement' });
    expect(saved.version).toBe(7);
  });

  it('rejects illegal moves without changing position or variation', () => {
    const line = startAnalysis(finishedAt(STANDARD_STARTING_FEN), 0);
    const bad = playAnalysisMove(line, 'e2', 'e5');
    expect(bad).toMatchObject({ accepted: false, result: { reason: 'illegal_move' } });
    expect(analysisFen(line)).toBe(STANDARD_STARTING_FEN);
    expect(line.moves).toEqual([]);
    const good = playAnalysisMove(line, 'e2', 'e4');
    expect(good.accepted).toBe(true);
    if (!good.accepted) return;
    expect(playAnalysisMove(good.line, 'd2', 'd4'))
      .toMatchObject({ accepted: false, result: { reason: 'illegal_move' } });
    expect(good.line.moves).toHaveLength(1);
  });

  it('navigates within boundaries and replaces only a local continuation', () => {
    const first = playAnalysisMove(startAnalysis(finishedAt(STANDARD_STARTING_FEN), 0), 'e2', 'e4');
    if (!first.accepted) throw new Error('Expected e4 to be legal.');
    const second = playAnalysisMove(first.line, 'e7', 'e5');
    if (!second.accepted) throw new Error('Expected e5 to be legal.');
    expect(navigateAnalysis(second.line, -1).cursor).toBe(0);
    expect(navigateAnalysis(second.line, 99).cursor).toBe(2);
    const rewind = navigateAnalysis(second.line, 1);
    expect(analysisFen(rewind)).toBe(first.move.afterFen);
    const branch = playAnalysisMove(rewind, 'd7', 'd5');
    if (!branch.accepted) throw new Error('Expected d5 to be legal.');
    expect(branch.line.moves.map(move => move.san)).toEqual(['e4', 'd5']);
    expect(second.line.moves.map(move => move.san)).toEqual(['e4', 'e5']);
    expect(analysisFen(navigateAnalysis(branch.line, 0))).toBe(STANDARD_STARTING_FEN);
  });

  it('uses domain rules for castling and en passant', () => {
    const castles = startAnalysis(finishedAt('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 0);
    const castle = playAnalysisMove(castles, 'e1', 'g1');
    expect(castle).toMatchObject({ accepted: true, move: { san: 'O-O' } });
    if (castle.accepted) expect(castle.move.afterFen.split(' ')[0]).toContain('R4RK1');

    const enPassant = startAnalysis(finishedAt('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'), 0);
    const capture = playAnalysisMove(enPassant, 'e5', 'd6');
    expect(capture).toMatchObject({ accepted: true, move: { san: 'exd6' } });
    if (capture.accepted) {
      expect(capture.move.afterFen.split(' ')[0]).toContain('3P4');
      expect(capture.move.afterFen.split(' ')[0]).not.toContain('3pP3');
    }
  });

  it('requires and records a promotion choice', () => {
    const line = startAnalysis(finishedAt('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'), 0);
    expect(playAnalysisMove(line, 'a7', 'a8'))
      .toMatchObject({ accepted: false, result: { reason: 'promotion_required' } });
    const promoted = playAnalysisMove(line, 'a7', 'a8', 'q');
    expect(promoted).toMatchObject({ accepted: true, move: { promotion: 'q', uci: 'a7a8q' } });
    expect(line.moves).toEqual([]);
  });

  it('starts from a selected saved half-move, not from a new game', () => {
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const saved: GameReadResponse = { ...finishedAt(afterE4), history: [
      { ply: 1, side: 'white', from: 'e2', to: 'e4', san: 'e4', uci: 'e2e4',
        beforeFen: STANDARD_STARTING_FEN, afterFen: afterE4 },
    ] };
    const line = startAnalysis(saved, 1);
    expect(line.basePly).toBe(1);
    expect(analysisFen(line)).toBe(afterE4);
    expect(analysisSideToMove(line)).toBe('black');
    expect(playAnalysisMove(line, 'e7', 'e5')).toMatchObject({ accepted: true });
    expect(saved.history).toHaveLength(1);
  });
});
