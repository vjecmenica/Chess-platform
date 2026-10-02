import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardArrows } from '../src/BoardArrows';
import { analysisBoardStorageKey, boardOrientation, clearPositionAnnotations,
  createAnalysisBoard, positionAnnotations, restoreAnalysisBoard, serializeAnalysisBoard,
  toggleAnalysisArrow, toggleAnalysisMark } from '../src/analysis-board';
import { arrowCenter } from '../src/board-arrows';
import { boardCoordinates } from '../src/board-display';
import { boardRows } from '../src/board-model';

const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('browser-local analysis board controls', () => {
  it('flips pieces, coordinates, and arrows without changing square identity', () => {
    expect(boardOrientation('white', false)).toBe('white');
    expect(boardOrientation('white', true)).toBe('black');
    expect(boardOrientation('black', true)).toBe('white');
    expect(boardRows(afterE4, 'white')[0]?.[0]?.square).toBe('a8');
    expect(boardRows(afterE4, 'black')[0]?.[0]?.square).toBe('h1');
    expect(boardRows(afterE4, 'black')[3]?.[3]?.square).toBe('e4');
    expect(boardCoordinates('black').files[0]).toBe('h');
    expect(arrowCenter('e2', 'white')).toEqual({ x: 450, y: 650 });
    expect(arrowCenter('e2', 'black')).toEqual({ x: 350, y: 150 });
  });

  it('keeps multiple colored arrows and square marks with their displayed position', () => {
    const original = createAnalysisBoard('game');
    const first = toggleAnalysisMark(toggleAnalysisArrow(original, start, 'e2', 'e4'), start, 'd4');
    const green = { ...first, color: 'green' as const };
    const next = toggleAnalysisMark(toggleAnalysisArrow(green, start, 'g1', 'f3'), start, 'e4');
    expect(positionAnnotations(next, start)).toEqual({
      arrows: [{ from: 'e2', to: 'e4', color: 'orange' },
        { from: 'g1', to: 'f3', color: 'green' }],
      marks: [{ square: 'd4', color: 'orange' }, { square: 'e4', color: 'green' }],
    });
    expect(positionAnnotations(next, afterE4)).toEqual({ arrows: [], marks: [] });
    expect(toggleAnalysisArrow(next, start, 'e2', 'e4').positions[start]?.arrows)
      .toEqual([{ from: 'g1', to: 'f3', color: 'green' }]);
    expect(toggleAnalysisMark(next, start, 'd4').positions[start]?.marks)
      .toEqual([{ square: 'e4', color: 'green' }]);
    expect(clearPositionAnnotations(next, start).positions).toEqual({});
    expect(original.positions).toEqual({});
  });

  it('renders chosen arrow colors and restores preferences without changing game data', () => {
    const game = { id: 'game', position: { fen: afterE4 }, history: [{ san: 'e4' }] };
    const state = toggleAnalysisMark(toggleAnalysisArrow({ ...createAnalysisBoard(game.id),
      flipped: true, color: 'blue' }, afterE4, 'e2', 'e4'), afterE4, 'e4');
    const html = renderToStaticMarkup(createElement(BoardArrows, {
      arrows: positionAnnotations(state, afterE4).arrows, orientation: 'black',
    }));
    expect(html).toContain('fill="rgba(47, 101, 154, .8)"');
    expect(html).toContain('L 350 350');
    const raw = serializeAnalysisBoard(state);
    expect(analysisBoardStorageKey(game.id)).toBe('chess-analysis-board:game:v1');
    expect(restoreAnalysisBoard(game.id, raw)).toEqual(state);
    expect(game).toEqual({ id: 'game', position: { fen: afterE4 }, history: [{ san: 'e4' }] });
  });

  it('rejects stale or malformed local data safely', () => {
    const raw = serializeAnalysisBoard(createAnalysisBoard('game'));
    expect(restoreAnalysisBoard('other-game', raw)).toBeNull();
    expect(restoreAnalysisBoard('game', JSON.stringify({ ...JSON.parse(raw), version: 0 }))).toBeNull();
    expect(restoreAnalysisBoard('game', '{bad json')).toBeNull();
    const invalid = { ...createAnalysisBoard('game'), positions: {
      [start]: { arrows: [{ from: 'a0', to: 'e4', color: 'orange' }], marks: [] },
    } };
    expect(restoreAnalysisBoard('game', serializeAnalysisBoard(invalid as never))).toBeNull();
  });
});
