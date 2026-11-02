import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPositionFromFen, STANDARD_STARTING_FEN } from '@chess/domain';
import { boardMove } from '../src/board-interaction';
import { appendValidPremove, nextPremove, premoveChoice } from '../src/premove-model';
import { promotionIsCurrent, type PromotionRequest } from '../src/PromotionPicker';
import { applyEngineVariation, engineVariation } from '../src/engine-variation';
import { EngineVariation } from '../src/EngineVariation';
import { createAnalysisTree, cursorFen, playAnalysisMove, selectMain } from '../src/analysis-model';
import { importPgn } from '../src/pgn-import';
import { buildMoveTree } from '../src/move-tree-model';
import { capturedPieces } from '../src/board-display';

const game = importPgn('[Result "*"]\n\n1. a4 h5 2. a5 h4 3. a6 h3 4. axb7 hxg2 *', 'promotion').game;
const fen = game.position.fen;
const request: PromotionRequest = { gameId: game.id, fen, from: 'b7', to: 'a8', side: 'white', mode: 'analysis' };

describe('promotion completion and lifecycle', () => {
  it.each(['q', 'r', 'b', 'n'] as const)('requires a choice and completes a capture promotion to %s', piece => {
    expect(boardMove(fen, 'white', 'b7', 'a8')).toEqual({ kind: 'promotion', from: 'b7', to: 'a8' });
    const result = playAnalysisMove(createAnalysisTree(game), game, 'b7', 'a8', piece);
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(cursorFen(result.tree, game).split('/')[0]![0]).toBe(piece.toUpperCase());
    expect(game.position.fen).toBe(fen);
    const live = createPositionFromFen(fen).submitMove({ side: 'white', from: 'b7', to: 'a8', promotion: piece });
    expect(live.accepted).toBe(true);
  });
  it('supports black noncapture promotion and requires an explicit piece', () => {
    const position = '7k/8/8/8/8/8/p7/7K b - - 0 1';
    expect(boardMove(position, 'black', 'a2', 'a1').kind).toBe('promotion');
    expect(createPositionFromFen(position).submitMove({ side: 'black', from: 'a2', to: 'a1', promotion: 'n' }).accepted).toBe(true);
  });
  it('admits a delayed premove choice, rechecks the actual reply, and rejects a removed pawn', () => {
    const position = '7k/P7/8/8/8/8/8/7K b - - 0 1';
    expect(premoveChoice(position, 'white', [], 'a7', 'a8').kind).toBe('promotion');
    const move = { id: 'p', from: 'a7', to: 'a8', promotion: 'r' } as const;
    const queue = appendValidPremove(position, 'white', [], move)!;
    const opponent = createPositionFromFen(position);
    expect(opponent.submitMove({ side: 'black', from: 'h8', to: 'g8' }).accepted).toBe(true);
    expect(nextPremove(opponent.getPosition().fen, 'white', queue)).toEqual(move);
    expect(appendValidPremove('7k/8/8/8/8/8/8/7K w - - 0 2', 'white', [], move)).toBeNull();
  });
  it('retires a picker when leaving analysis, changing position/game, or ending live play', () => {
    expect(promotionIsCurrent(request, game.id, fen, true, false)).toBe(true);
    expect(promotionIsCurrent(request, game.id, STANDARD_STARTING_FEN, true, false)).toBe(false);
    expect(promotionIsCurrent(request, 'another-game', fen, true, false)).toBe(false);
    expect(promotionIsCurrent(request, game.id, fen, false, true)).toBe(false);
    expect(promotionIsCurrent({ ...request, mode: 'live' }, game.id, fen, false, false)).toBe(false);
    expect(promotionIsCurrent({ ...request, mode: 'premove' }, game.id, STANDARD_STARTING_FEN, false, true)).toBe(true);
  });
});

describe('navigable engine continuations', () => {
  const source = importPgn('[Result "*"]\n\n1. e4 e5 *', 'pv').game;
  const tree = selectMain(createAnalysisTree(source), source, 0);
  it('previews each occurrence after all preceding moves, without editing the tree', () => {
    const moves = engineVariation(STANDARD_STARTING_FEN, ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'e2e4']);
    expect(moves.map(move => move.san)).toEqual(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'e4']);
    expect(moves[3]!.fen.split(' ')[0]).toBe(STANDARD_STARTING_FEN.split(' ')[0]);
    expect(moves[4]!.fen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3');
    expect(tree.nodes).toEqual([]);
  });
  it('clicking a later PV move applies the entire prefix and selects its final position', () => {
    const next = applyEngineVariation(tree, source, STANDARD_STARTING_FEN, ['d2d4', 'd7d5', 'c2c4'])!;
    expect(next.nodes.map(move => move.san)).toEqual(['d4', 'd5', 'c4']);
    expect(cursorFen(next, source)).toBe(engineVariation(STANDARD_STARTING_FEN, ['d2d4', 'd7d5', 'c2c4'])[2]!.fen);
    expect(tree.nodes).toHaveLength(0);
    const reused = applyEngineVariation(tree, source, STANDARD_STARTING_FEN, ['e2e4', 'e7e5'])!;
    expect(reused.cursor).toEqual({ kind: 'main', ply: 2 });
    expect(reused.nodes).toHaveLength(0);
  });
  it('rejects stale roots or an illegal later move atomically', () => {
    expect(applyEngineVariation(tree, source, source.position.fen, ['g1f3'])).toBeNull();
    expect(applyEngineVariation(tree, { ...source, id: 'another-game' }, STANDARD_STARTING_FEN, ['g1f3'])).toBeNull();
    expect(applyEngineVariation(tree, source, STANDARD_STARTING_FEN, ['d2d4', 'e7e3'])).toBeNull();
    expect(tree.nodes).toHaveLength(0);
    expect(engineVariation(STANDARD_STARTING_FEN, ['e2e4', 'bad', 'g1f3']).map(move => move.san)).toEqual(['e4']);
  });
  it('uses legal castling, en passant, and promotion moves in previews', () => {
    expect(engineVariation('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['e1g1'])[0]?.san).toBe('O-O');
    const ep = engineVariation('7k/8/8/3pP3/8/8/8/7K w - d6 0 2', ['e5d6']);
    expect(ep[0]?.san).toBe('exd6');
    expect(ep[0]?.fen.split(' ')[0]).toBe('7k/8/3P4/8/8/8/8/7K');
    expect(engineVariation(fen, ['b7a8n'])[0]?.san).toBe('bxa8=N');
    expect(engineVariation(fen, ['b7a8'])).toEqual([]);
  });
  it('renders real move buttons for keyboard navigation without creating previews on render', () => {
    const html = renderToStaticMarkup(createElement(EngineVariation, { fen, moves: engineVariation(fen, ['b7a8q', 'g2h1q']), orientation: 'black' }));
    expect(html).toContain('Explore bxa8=Q');
    expect(html).toContain('move 2 of this engine line');
    expect(html).not.toContain('role="tooltip"');
  });
  it('retains nested paths, notes, and captures across repeated navigation', () => {
    const first = applyEngineVariation(tree, source, STANDARD_STARTING_FEN, ['d2d4', 'd7d5', 'c2c4'])!;
    const forkRoot = { ...first, cursor: { kind: 'branch' as const, id: first.nodes[0]!.id } };
    const nested = applyEngineVariation(forkRoot, source, cursorFen(forkRoot, source), ['g8f6', 'c2c4'])!;
    const view = buildMoveTree(source, nested, nested.cursor);
    expect(JSON.stringify(view)).toContain('Nf6');
    const taken = capturedPieces(source, 0, nested);
    expect(capturedPieces(source, 2, null)).toEqual({ white: [], black: [] });
    expect(capturedPieces(source, 0, nested)).toEqual(taken);
  });
});

