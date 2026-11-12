import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { STANDARD_STARTING_FEN } from '@chess/domain';
import { engineBestMove } from '../src/engine-board';
import { EngineController, EngineCache, type EngineEvaluation, type EngineState, type EngineWorker } from '../src/engine-analysis';
import { BoardArrows, EngineBestMoveArrow } from '../src/BoardArrows';
import { clearPositionAnnotations, createAnalysisBoard, positionAnnotations, serializeAnalysisBoard, toggleAnalysisArrow } from '../src/analysis-board';
import { EnginePanel } from '../src/EnginePanel';
import { importPgn } from '../src/pgn-import';

const fen = STANDARD_STARTING_FEN;
const evaluation: EngineEvaluation = { fen, depth: 18, score: { kind: 'cp', value: 20 }, bestMove: 'd2d4', variation: ['d2d4'] };
const done = (value = evaluation): EngineState => ({ kind: 'done', evaluation: value, cached: false });

it('uses the current first PV, including intermediate rank updates, rather than another candidate or old bestmove', () => {
  expect(engineBestMove(done(), fen, 'game', true)).toEqual({ gameId: 'game', fen, from: 'd2', to: 'd4' });
  const state: EngineState = { kind: 'searching', fen, evaluation, lines: [
    { rank: 2, score: { kind: 'cp', value: 10 }, variation: ['g1f3'] },
    { rank: 1, score: { kind: 'cp', value: 30 }, variation: ['c2c4'] },
  ] };
  expect(engineBestMove(state, fen, 'game', true)).toMatchObject({ from: 'c2', to: 'c4' });
  expect(engineBestMove({ ...state, lines: [state.lines![0]!] }, fen, 'game', true)).toBeNull();
  expect(engineBestMove(done({ ...evaluation, bestMove: 'e2e4', lines: [
    { rank: 1, score: evaluation.score, variation: [] },
  ] }), fen, 'game', true)).toMatchObject({ from: 'e2', to: 'e4' });
});
it('clears for disabled, unavailable, invalid, empty or different-position output', () => {
  expect(engineBestMove(done(), fen, 'game', false)).toBeNull();
  for (const state of [{ kind: 'off' }, { kind: 'loading' }, { kind: 'error', message: 'Worker failed' }] as EngineState[])
    expect(engineBestMove(state, fen, 'game', true)).toBeNull();
  expect(engineBestMove(done({ ...evaluation, fen: fen.replace(' w ', ' b ') }), fen, 'game', true)).toBeNull();
  expect(engineBestMove({ kind: 'searching', fen: fen.replace(' w ', ' b '), evaluation }, fen, 'game', true)).toBeNull();
  for (const move of ['c2c5', 'e2e4q', '0000', 'not-a-move'])
    expect(engineBestMove(done({ ...evaluation, variation: [move] }), fen, 'game', true)).toBeNull();
  expect(engineBestMove(done({ ...evaluation, variation: [], bestMove: null }), fen, 'game', true)).toBeNull();
});
it('validates promotion, en passant and castling with the existing domain rules', () => {
  for (const [position, uci, from, to] of [
    ['4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8n', 'a7', 'a8'],
    ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1', 'e1', 'g1'],
    ['4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2', 'e5d6', 'e5', 'd6'],
  ]) expect(engineBestMove(done({ ...evaluation, fen: position!, variation: [uci!] }), position!, 'game', true))
    .toMatchObject({ from, to });
});
it('renders a separate noninteractive arrow in either orientation, unaffected by annotation edits or serialization', () => {
  const move = engineBestMove(done({ ...evaluation, variation: ['e2e4'] }), fen, 'game', true)!;
  const render = (orientation: 'white' | 'black') => renderToStaticMarkup(createElement(EngineBestMoveArrow, { move, orientation }));
  expect(render('white')).toContain('L 450 450'); expect(render('black')).toContain('L 350 350');
  expect(render('white')).toContain('class="board-arrows engine-best-move"');
  expect(render('white')).toContain('aria-hidden="true" focusable="false"');
  let annotations = toggleAnalysisArrow(createAnalysisBoard('game'), fen, 'g1', 'f3');
  annotations = clearPositionAnnotations(annotations, fen);
  expect(positionAnnotations(annotations, fen).arrows).toHaveLength(0);
  expect(renderToStaticMarkup(createElement(BoardArrows, { arrows: [], orientation: 'white' }))).not.toContain('<path');
  expect(render('white')).toContain('data-from="e2" data-to="e4"');
  expect(serializeAnalysisBoard(annotations)).not.toContain('e2');
});
it('tracks actual engine updates, position replacement and stop without persisting suggestions', () => {
  let message: EngineWorker['onmessage'] = null;
  const worker: EngineWorker = { postMessage() {}, terminate() {}, onerror: null,
    get onmessage() { return message; }, set onmessage(next) { message = next; } };
  const arrows: ReturnType<typeof engineBestMove>[] = [];
  let position = fen;
  const controller = new EngineController(() => worker, state => arrows.push(engineBestMove(state, position, 'game', true)), new EngineCache());
  const emit = (text: string) => message?.({ data: text } as MessageEvent<string>);
  controller.start(fen); emit('uciok'); emit('readyok');
  emit('info depth 8 score cp 20 pv e2e4'); expect(arrows.at(-1)).toMatchObject({ from: 'e2', to: 'e4' });
  emit('info depth 9 score cp 25 pv d2d4'); expect(arrows.at(-1)).toMatchObject({ from: 'd2', to: 'd4' });
  position = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  controller.setPosition(position); expect(arrows.at(-1)).toBeNull();
  emit('bestmove d2d4'); emit('readyok'); emit('info depth 8 score cp 0 pv e7e5');
  expect(arrows.at(-1)).toMatchObject({ fen: position, from: 'e7', to: 'e5' });
  controller.stop(); expect(arrows.at(-1)).toBeNull();
});
it('keeps the switch, depth, continuous control and settings together without a duplicate Analysis heading', () => {
  const game = importPgn('[Result "*"]\n\n*', 'blank-game').game;
  const html = renderToStaticMarkup(createElement(EnginePanel, { game, fen, selectedPly: 0,
    onSelectPly() {}, onReviewChange() {}, onEvaluationChange() {} }));
  expect(html).not.toContain('>Analysis</strong>');
  expect(html).not.toContain('class="engine-heading"');
  expect(html.slice(html.indexOf('class="engine-depth-row"'))).toMatch(
    /role="switch"[\s\S]*Depth[\s\S]*aria-label="Continuous analysis"[\s\S]*class="engine-build"[\s\S]*aria-label="Engine settings"/);
});

it('shares identical user, best and threat geometry in both orientations, with only color differing', () => {
  const move={gameId:'game',fen,from:'e2' as const,to:'e4' as const};
  for(const orientation of ['white','black'] as const) {
    const user=renderToStaticMarkup(createElement(BoardArrows,{arrows:[{from:move.from,to:move.to}],orientation}));
    const best=renderToStaticMarkup(createElement(EngineBestMoveArrow,{move,orientation}));
    const threat=renderToStaticMarkup(createElement(EngineBestMoveArrow,{move,orientation,threat:true}));
    const path=(html:string)=>/ d="([^"]*)"/.exec(html)?.[1];
    expect(path(best)).toBe(path(user)); expect(path(threat)).toBe(path(user));
    expect(best).toContain('fill="#70bcee"'); expect(threat).toContain('fill="#dd4941"');
    expect(best).toContain('fill-opacity=".72"');
  }
});
