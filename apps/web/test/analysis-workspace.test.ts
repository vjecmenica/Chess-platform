import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { EvaluationBar, evaluationFillPercent } from '../src/EvaluationBar';
import { defaultAnalysisBoardSize, availableAnalysisBoardWidth, evaluationBarState,
  resizedBoardSize } from '../src/analysis-workspace';
import type { EngineEvaluation } from '../src/engine-analysis';

function evaluation(fen = STANDARD_STARTING_FEN, kind: 'cp' | 'mate' = 'cp', value = 50):
  EngineEvaluation {
  return { fen, depth: 14, score: { kind, value }, bestMove: null, variation: [] };
}

describe('analysis workspace sizing', () => {
  it('reserves desktop height for player strips, controls, and a completed report', () => {
    // A 900px viewport with 48px above the workspace, 170px of board chrome,
    // a 334px completed report, and 28px of gaps leaves a 320px board.
    expect(defaultAnalysisBoardSize(650, 900, 48, 170, 334, false)).toBe(320);
    expect(defaultAnalysisBoardSize(850, 1080, 48, 170, 334, false)).toBe(500);
    // The idle report button must still reserve space for the later graph/summary.
    expect(defaultAnalysisBoardSize(650, 900, 48, 170, 70, false)).toBe(334);
    expect(defaultAnalysisBoardSize(280, 1080, 48, 170, 334, false)).toBe(280);
  });

  it('allows natural scrolling on short screens and after an explicit enlargement', () => {
    expect(defaultAnalysisBoardSize(650, 600, 48, 170, 334, false)).toBe(240);
    expect(defaultAnalysisBoardSize(340, 844, 48, 170, 600, true)).toBe(340);
    expect(resizedBoardSize(320, 300, 300, 900)).toBe(620);
    // A viewport resize recomputes the automatic default, independently of the manual size.
    expect(defaultAnalysisBoardSize(650, 900, 48, 170, 334, false)).toBe(320);
  });

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
    expect(css).toMatch(/\.evaluation-white\s*\{[^}]*transition: height 900ms cubic-bezier\(\.16, 1, \.3, 1\)/);
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
