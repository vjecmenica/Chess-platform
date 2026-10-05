import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { EvaluationBar, evaluationFillPercent } from '../src/EvaluationBar';
import { availableAnalysisBoardWidth, evaluationBarState,
  resizedBoardSize } from '../src/analysis-workspace';
import type { EngineEvaluation } from '../src/engine-analysis';

function evaluation(fen = STANDARD_STARTING_FEN, kind: 'cp' | 'mate' = 'cp', value = 50):
  EngineEvaluation {
  return { fen, depth: 14, score: { kind, value }, bestMove: null, variation: [] };
}

describe('analysis workspace sizing', () => {
  it('follows a diagonal drag and clamps to desktop and mobile space', () => {
    expect(availableAnalysisBoardWidth(1140, false)).toBe(768);
    expect(availableAnalysisBoardWidth(390, true)).toBe(356);
    expect(resizedBoardSize(500, 60, 40, 680)).toBe(550);
    expect(resizedBoardSize(500, -80, -40, 680)).toBe(440);
    expect(resizedBoardSize(500, 1000, 1000, 680)).toBe(680);
    expect(resizedBoardSize(500, -1000, -1000, 680)).toBe(240);
    expect(resizedBoardSize(500, 1000, 1000, 320)).toBe(320);
    expect(resizedBoardSize(500, -1000, -1000, 220)).toBe(220);
    expect(resizedBoardSize(700, 400, 400, 1000, 900)).toBe(900);
    expect(resizedBoardSize(700, 400, 400, 1200, 1200)).toBe(1080);
    // The limit comes from the workspace, so shrinking the board cannot trap it at that size.
    expect(resizedBoardSize(300, 200, 200, availableAnalysisBoardWidth(1140, false))).toBe(500);
  });

  it('keeps the engine beneath both columns and scrolls moves within a board-height sidebar', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(css).toMatch(/\.analysis-workspace \.engine-panel\s*\{[^}]*grid-column: 1 \/ -1/);
    expect(css).toMatch(/\.game-sidebar\s*\{[^}]*height: var\(--board-row-height/);
    expect(css).toMatch(/\.moves\s*\{[^}]*overflow-y: auto/);
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.move-panel\s*\{[^}]*height: var\(--board-row-height/);
    expect(css).toMatch(/\.board-resize-grip\s*\{[^}]*touch-action: none/);
    expect(css).toMatch(/\.board-stage \.board-frame\s*\{[^}]*var\(--board-size/);
    expect(app).toContain('setBoardSize(Math.round(boardFrameRef.current?.getBoundingClientRect().width');
    expect(app).not.toContain('analysisBoardSize');
  });
});

describe('White-perspective evaluation bar', () => {
  it('converts both sides, clamps extreme scores, and ignores a different position', () => {
    expect(evaluationBarState(evaluation(), STANDARD_STARTING_FEN))
      .toEqual({ whitePercent: 52.5, label: 'White perspective +0.50' });
    const blackToMove = STANDARD_STARTING_FEN.replace(' w ', ' b ');
    expect(evaluationBarState(evaluation(blackToMove, 'cp', 200), blackToMove))
      .toEqual({ whitePercent: 40, label: 'White perspective -2.00' });
    expect(evaluationBarState(evaluation(STANDARD_STARTING_FEN, 'cp', 5000), STANDARD_STARTING_FEN)
      ?.whitePercent).toBe(100);
    expect(evaluationBarState(evaluation(), blackToMove)).toBeNull();
    const html = renderToStaticMarkup(createElement(EvaluationBar,
      { evaluation: evaluation(), fen: blackToMove }));
    expect(html).toContain('No evaluation for this position');
    expect(html).not.toContain('+0.50');
    expect(html).toContain('evaluation-track unevaluated');
    expect(html).toContain('height:50%');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('class="evaluation-tooltip"');
    expect(html).not.toContain('evaluation-score');
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.evaluation-tooltip\s*\{[^}]*visibility: hidden/);
    expect(css).toMatch(/\.evaluation-bar:focus-visible \.evaluation-tooltip\s*\{[^}]*visibility: visible/);
    expect(css).toMatch(/\.evaluation-white\s*\{[^}]*transition: height 250ms cubic-bezier\(\.2, \.8, \.2, 1\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/\.evaluation-track\.unevaluated::after\s*\{[^}]*background: repeating-linear-gradient/);
    expect(evaluationFillPercent(72, 50)).toBe(72);
    expect(evaluationFillPercent(null, 72)).toBe(72);
    expect(evaluationFillPercent(35, 72)).toBe(35);
    const current = renderToStaticMarkup(createElement(EvaluationBar,
      { evaluation: evaluation(), fen: STANDARD_STARTING_FEN }));
    expect(current).toContain('White perspective +0.50');
  });

  it('places mate at the correct edge, including a checkmated side to move', () => {
    const blackToMove = STANDARD_STARTING_FEN.replace(' w ', ' b ');
    expect(evaluationBarState(evaluation(blackToMove, 'mate', 3), blackToMove))
      .toEqual({ whitePercent: 0, label: 'White perspective Mate -3' });
    expect(evaluationBarState(evaluation(blackToMove, 'mate', 0), blackToMove))
      .toEqual({ whitePercent: 100, label: 'White wins by mate' });
    expect(evaluationBarState(evaluation(STANDARD_STARTING_FEN, 'mate', 0), STANDARD_STARTING_FEN))
      .toEqual({ whitePercent: 0, label: 'Black wins by mate' });
  });
});
