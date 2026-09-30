import { describe, expect, it } from 'vitest';
import type { GameReadResponse, SavedMove } from '@chess/contracts';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { analysisStorageKey, createAnalysisTree, cursorFen, deleteVariation,
  mainAncestorPly, nextPosition, playAnalysisMove, previousPosition, restoreAnalysis,
  selectBranch, selectMain, serializeAnalysis } from '../src/analysis-model';

const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
function finishedAt(fen: string, history: readonly SavedMove[] = []): GameReadResponse {
  return { id: 'saved-game', version: 7, status: 'finished', yourSeat: 'white',
    position: { fen, sideToMove: fen.split(' ')[1] === 'w' ? 'white' : 'black' },
    result: { outcome: 'draw', reason: 'agreement' }, history, clocks: null,
    clockStatus: 'not_integrated', timeControl: { initialMs: 300_000, incrementMs: 3_000 },
    rated: false };
}
const savedE4: SavedMove = { ply: 1, side: 'white', from: 'e2', to: 'e4', san: 'e4',
  uci: 'e2e4', beforeFen: STANDARD_STARTING_FEN, afterFen: afterE4 };

function play(game: GameReadResponse, tree: ReturnType<typeof createAnalysisTree>,
  from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n') {
  const result = playAnalysisMove(tree, game, from, to, promotion);
  if (!result.accepted) throw new Error(`Expected ${from}${to} to be legal: ${result.result.message}`);
  return result.tree;
}

describe('finished-game analysis tree', () => {
  it('keeps the saved continuation and sibling variations when branching', () => {
    const game = finishedAt(afterE4, [savedE4]);
    const initial = selectMain(createAnalysisTree(game), game, 0);
    const saved = play(game, initial, 'e2', 'e4');
    expect(saved.cursor).toEqual({ kind: 'main', ply: 1 });
    expect(saved.nodes).toEqual([]);
    const d4 = play(game, initial, 'd2', 'd4');
    const c4 = play(game, initial, 'c2', 'c4');
    expect(d4.nodes).toHaveLength(1);
    const both = play(game, selectMain(d4, game, 0), 'c2', 'c4');
    expect(both.nodes.map(node => node.san)).toEqual(['d4', 'c4']);
    expect(play(game, selectMain(both, game, 0), 'd2', 'd4').nodes).toHaveLength(2);
    expect(selectMain(both, game, 1).cursor).toEqual({ kind: 'main', ply: 1 });
    const blackAlternative = play(game, selectMain(both, game, 1), 'e7', 'e5');
    expect(blackAlternative.nodes[2]).toMatchObject({ parent: { kind: 'main', ply: 1 }, san: 'e5' });
    expect(game.history).toEqual([savedE4]);
    expect(game.position.fen).toBe(afterE4);
    expect(c4.nodes[0]?.san).toBe('c4');
  });

  it('navigates main and nested branches without removing either line', () => {
    const game = finishedAt(afterE4, [savedE4]);
    const d4 = play(game, selectMain(createAnalysisTree(game), game, 0), 'd2', 'd4');
    const reply = play(game, d4, 'd7', 'd5');
    expect(reply.nodes.map(node => node.san)).toEqual(['d4', 'd5']);
    expect(mainAncestorPly(reply)).toBe(0);
    expect(previousPosition(reply).cursor).toEqual({ kind: 'branch', id: 1 });
    expect(nextPosition(previousPosition(reply), game).cursor).toEqual({ kind: 'branch', id: 2 });
    expect(cursorFen(selectBranch(reply, 1), game)).toBe(reply.nodes[0]?.fen);
    expect(nextPosition(selectMain(reply, game, 0), game).cursor).toEqual({ kind: 'main', ply: 1 });
    expect(previousPosition(selectMain(reply, game, 0)).cursor).toEqual({ kind: 'main', ply: 0 });
    expect(game.history).toHaveLength(1);
  });

  it('deletes only a chosen subtree and moves the cursor to its parent', () => {
    const game = finishedAt(STANDARD_STARTING_FEN);
    const d4 = play(game, createAnalysisTree(game), 'd2', 'd4');
    const d5 = play(game, d4, 'd7', 'd5');
    const siblings = play(game, selectMain(d5, game, 0), 'e2', 'e4');
    const deleted = deleteVariation(selectBranch(siblings, 2), 1);
    expect(deleted.nodes.map(node => node.san)).toEqual(['e4']);
    expect(deleted.cursor).toEqual({ kind: 'main', ply: 0 });
    expect(game.position.fen).toBe(STANDARD_STARTING_FEN);
  });

  it('restores a branch tree after refresh and rejects older or altered storage', () => {
    const game = finishedAt(STANDARD_STARTING_FEN);
    const first = play(game, createAnalysisTree(game), 'e2', 'e4');
    const second = play(game, first, 'e7', 'e5');
    const withSibling = play(game, selectMain(second, game, 0), 'd2', 'd4');
    const saved = serializeAnalysis(withSibling);
    const freshRead = JSON.parse(JSON.stringify(game)) as GameReadResponse;
    expect(analysisStorageKey(game.id)).toBe('chess.analysis.v1.saved-game');
    expect(restoreAnalysis(freshRead, saved)).toEqual(withSibling);
    expect(restoreAnalysis(game, JSON.stringify({ ...JSON.parse(saved), version: 0 }))).toBeNull();
    const altered = JSON.parse(saved);
    altered.nodes[1].to = 'e4';
    expect(restoreAnalysis(game, JSON.stringify(altered))).toBeNull();
    expect(restoreAnalysis(game, '{bad json')).toBeNull();
    expect(restoreAnalysis({ ...game, id: 'different' }, saved)).toBeNull();
    expect(game.result).toEqual({ outcome: 'draw', reason: 'agreement' });
  });

  it('restores after deleting a branch, keeping unique future IDs', () => {
    const game = finishedAt(STANDARD_STARTING_FEN);
    const first = play(game, createAnalysisTree(game), 'd2', 'd4');
    const sibling = play(game, selectMain(first, game, 0), 'e2', 'e4');
    const pruned = deleteVariation(sibling, 1);
    const restored = restoreAnalysis(game, serializeAnalysis(pruned));
    expect(restored).toEqual(pruned);
    expect(play(game, selectMain(restored!, game, 0), 'c2', 'c4').nodes.map(node => node.id))
      .toEqual([2, 3]);
  });

  it('uses domain legality for invalid moves, castling, en passant, and promotion', () => {
    const start = finishedAt(STANDARD_STARTING_FEN);
    const tree = createAnalysisTree(start);
    expect(playAnalysisMove(tree, start, 'e2', 'e5'))
      .toMatchObject({ accepted: false, result: { reason: 'illegal_move' } });
    expect(tree.nodes).toEqual([]);
    const castleGame = finishedAt('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(play(castleGame, createAnalysisTree(castleGame), 'e1', 'g1').nodes[0]?.san).toBe('O-O');
    const epGame = finishedAt('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    expect(play(epGame, createAnalysisTree(epGame), 'e5', 'd6').nodes[0]?.san).toBe('exd6');
    const promotionGame = finishedAt('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const promotionTree = createAnalysisTree(promotionGame);
    expect(playAnalysisMove(promotionTree, promotionGame, 'a7', 'a8'))
      .toMatchObject({ accepted: false, result: { reason: 'promotion_required' } });
    expect(play(promotionGame, promotionTree, 'a7', 'a8', 'q').nodes[0]?.uci).toBe('a7a8q');
  });

  it('cannot start analysis from an active game', () => {
    expect(() => createAnalysisTree({ ...finishedAt(STANDARD_STARTING_FEN), status: 'active' }))
      .toThrow('finished game');
  });
});
