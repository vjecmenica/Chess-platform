import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createPosition } from '@chess/domain';
import type { GameReadResponse } from '@chess/contracts';
import { createAnalysisTree, deleteVariation, playAnalysisMove, promoteVariation,
  selectBranch, selectMain, setMoveNote } from '../src/analysis-model';
import { MoveTree } from '../src/MoveTree';
import { buildMoveTree, moveNotation } from '../src/move-tree-model';
import { buildGameReview, reviewPositions, type GameReview } from '../src/game-review';

function savedGame(plies = 2): GameReadResponse {
  const position = createPosition();
  const moves = [['white', 'e2', 'e4'], ['black', 'e7', 'e5'], ['white', 'g1', 'f3']] as const;
  for (const [side, from, to] of moves.slice(0, plies)) position.submitMove({ side, from, to });
  return { id: 'finished', version: plies, status: 'finished', yourSeat: 'white',
    position: position.getPosition(), history: position.getHistory(),
    result: { outcome: 'draw', reason: 'agreement' }, clocks: null,
    clockStatus: 'not_integrated', timeControl: { initialMs: 300_000, incrementMs: 3_000 },
    rated: false };
}

type Tree = ReturnType<typeof createAnalysisTree>;
function play(game: GameReadResponse, tree: Tree, from: string, to: string): Tree {
  const result = playAnalysisMove(tree, game, from, to);
  if (!result.accepted) throw new Error(`Expected ${from}${to} to be legal.`);
  return result.tree;
}

function markup(game: GameReadResponse, tree: Tree | null, interactive = true,
  review?: GameReview): string {
  return renderToStaticMarkup(createElement(MoveTree, { game, tree,
    selected: tree?.cursor ?? { kind: 'main', ply: game.history.length }, interactive,
    onSelect: () => {}, onDelete: () => {}, review }));
}

describe('analysis move list', () => {
  it('shows engine labels on saved moves without replacing a manual NAG or comment', () => {
    const game = savedGame(3);
    const fens = reviewPositions(game);
    const scores = [100, 0, 200, 100];
    const review = buildGameReview(game, fens.map((fen, index) => ({ fen, depth: 14,
      score: { kind: 'cp' as const, value: scores[index]! }, bestMove: null, variation: [] })));
    let tree = setMoveNote(createAnalysisTree(game), { kind: 'main', ply: 1 },
      { nag: 1, comment: 'Prepared opening choice' });
    tree = play(game, selectMain(tree, game, 0), 'd2', 'd4');
    const html = markup(game, tree, true, review);
    expect(html).toContain('PGN $1');
    expect(html).toContain('Prepared opening choice');
    expect(html).toContain('Engine: Inaccuracy, 100 centipawn loss');
    expect(html).toContain('engine-glyph engine-inaccuracy');
    expect(html).toContain('engine-glyph engine-mistake');
    expect(html).toContain('engine-glyph engine-blunder');
    expect((html.match(/engine-glyph/g) ?? [])).toHaveLength(3);
    expect(html).toContain('1. d4');
    expect(game.history.map(move => move.san)).toEqual(['e4', 'e5', 'Nf3']);
    const quiet = buildGameReview(game, fens.map(fen => ({ fen, depth: 14,
      score: { kind: 'cp' as const, value: 0 }, bestMove: null, variation: [] })));
    expect(markup(game, tree, true, quiet)).not.toContain('engine-glyph');
    expect(markup(game, tree, true, quiet)).not.toContain('Engine: Strong');
    const mate = buildGameReview(game, quiet.evaluations.map((evaluation, index) => index === 1
      ? { ...evaluation, score: { kind: 'mate' as const, value: 1 } } : evaluation));
    expect(markup(game, tree, true, mate)).toContain('Engine: Mate score, no numeric centipawn loss');
    expect(markup(game, tree, true, mate)).toContain('>Mate eval</span>');
  });
  it('groups saved half-moves into White and Black columns, including an incomplete pair', () => {
    const complete = markup(savedGame(2), null);
    expect((complete.match(/class="move-pair"/g) ?? [])).toHaveLength(1);
    expect(complete).toMatch(/move-number">1\.<\/span>[\s\S]*move-cell[\s\S]*>e4<\/button>[\s\S]*move-cell[\s\S]*>e5<\/button>/);
    const incomplete = markup(savedGame(3), null);
    expect((incomplete.match(/class="move-pair"/g) ?? [])).toHaveLength(2);
    expect(incomplete).toContain('>Nf3</button>');
    expect(moveNotation(2, 'e5')).toBe('1... e5');
  });

  it('keeps consecutive variation moves inline and indents only real forks', () => {
    const game = savedGame();
    const d4 = play(game, selectMain(createAnalysisTree(game), game, 0), 'd2', 'd4');
    const d5 = play(game, d4, 'd7', 'd5');
    const nc3 = play(game, d5, 'b1', 'c3');
    const html = markup(game, nc3);
    expect((html.match(/class="variation-list"/g) ?? [])).toHaveLength(1);
    expect(html).toMatch(/aria-label="1\. d4"[\s\S]*aria-label="1\.\.\. d5"[\s\S]*aria-label="2\. Nc3"/);
    expect(html).toContain('aria-current="step" aria-label="2. Nc3"');
    expect(html).not.toContain('delete-variation');
    expect(html).not.toContain('move-options');
    expect(html).not.toContain('⋯');
    const nf6 = play(game, nc3, 'g8', 'f6');
    const fork = play(game, selectBranch(nf6, 3), 'c7', 'c6');
    const forkHtml = markup(game, fork);
    expect((forkHtml.match(/class="variation-list"/g) ?? [])).toHaveLength(2);
    expect(forkHtml).toContain('2... Nf6');
    expect(forkHtml).toContain('2... c6');
  });

  it('renders a Black-first variation, comments, and standard PGN glyphs', () => {
    const game = savedGame();
    const c5 = play(game, selectMain(createAnalysisTree(game), game, 1), 'c7', 'c5');
    const noted = setMoveNote(c5, c5.cursor, { comment: 'Sicilian Defense', nag: 5 });
    const html = markup(game, noted);
    expect(html).toContain('1...');
    expect(html).toContain('c5');
    expect(html).toContain('Sicilian Defense');
    expect(html).toContain('Speculative move (PGN $5)');
    expect(html).toContain('!?');
  });

  it('shows a less familiar PGN value after its move with a readable description', () => {
    const game = savedGame();
    const branch = play(game, selectMain(createAnalysisTree(game), game, 1), 'c7', 'c5');
    const noted = setMoveNote(branch, branch.cursor, { comment: 'Time trouble', nag: 139 });
    const html = markup(game, noted);
    expect(html).toContain('Black has severe time control pressure, PGN $139');
    expect(html).toContain('>B:time!</span>');
    expect(html).toContain('Time trouble');
  });

  it('keeps a long assessment compact beside its move and retains the full accessible meaning', () => {
    const game = savedGame();
    const tree = setMoveNote(createAnalysisTree(game), { kind: 'main', ply: 2 }, { nag: 35 });
    const html = markup(game, tree);
    expect(html).toContain('aria-label="1... e5, Black has a decisive time (development) advantage, PGN $35"');
    expect(html).toContain('>e5<span class="nag-symbol"');
    expect(html).toContain('>B:dev!</span>');
    expect(html).not.toContain('>B: development decisive</span>');
  });

  it('marks analysis moves for quiet styling without changing live move markup', () => {
    const game = savedGame();
    const branch = play(game, selectMain(createAnalysisTree(game), game, 1), 'c7', 'c5');
    expect(markup(game, branch)).toContain('class="moves analysis-moves"');
    expect(markup(game, branch)).toContain('aria-keyshortcuts="Shift+F10"');
    expect(markup(game, branch)).toContain('Right-click, long-press, or press Shift+F10 for analysis options');
    expect(markup({ ...game, status: 'active', result: null }, null, false))
      .toContain('class="moves live-moves"');
  });

  it('keeps the current saved move and its path free of green fills and borders', () => {
    const position = createPosition();
    for (const [side, from, to] of [
      ['white', 'd2', 'd4'], ['black', 'd7', 'd5'],
      ['white', 'c2', 'c4'], ['black', 'e7', 'e6'],
    ] as const) position.submitMove({ side, from, to });
    const game = { ...savedGame(0), version: 4, position: position.getPosition(),
      history: position.getHistory() };
    const html = markup(game, null);
    expect(html).toContain('class="moves saved-replay-moves"');
    expect(html).toContain('aria-current="step" aria-label="2... e6"');
    expect(html).toContain('class="move-entry saved-move on-path"');
    expect(html).toContain('>e6</button>');

    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const replayRule = css.match(/\.saved-replay-moves \.move-link\[aria-current="step"\],\s*\.saved-replay-moves \.move-entry\.on-path > \.move-link\s*\{([^}]*)\}/)?.[1];
    expect(replayRule).toMatch(/background:\s*transparent/);
    expect(replayRule).toMatch(/box-shadow:\s*none/);
    expect(replayRule).toMatch(/border:\s*0/);
  });

  it('aligns live, replay, and analysis move text at the same row inset', () => {
    const game = savedGame();
    const live = markup({ ...game, status: 'active', result: null }, null, false);
    const replay = markup(game, null);
    const analysis = markup(game, createAnalysisTree(game));
    expect(live).toMatch(/move-pair-row[\s\S]*class="move-text">e4<\/span>/);
    expect(replay).toMatch(/move-pair-row[\s\S]*class="move-link"[\s\S]*>e4<\/button>/);
    expect(analysis).toContain('class="moves analysis-moves"');

    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.move-pair-row \.move-text,\s*\.move-pair-row \.move-link\s*\{\s*padding-inline:\s*5px;/);
    expect(css).not.toMatch(/\.analysis-moves \.move-pair-row \.move-link\s*\{[^}]*padding-inline:/);
  });

  it('promotes an alternative locally while retaining the saved continuation and other branches', () => {
    const game = savedGame();
    const d4 = play(game, selectMain(createAnalysisTree(game), game, 0), 'd2', 'd4');
    const d5 = play(game, d4, 'd7', 'd5');
    const c4 = play(game, selectMain(d5, game, 0), 'c2', 'c4');
    const promoted = promoteVariation(c4, 1);
    const view = buildMoveTree(game, promoted, promoted.cursor);
    expect(view.main.moves.map(move => move.san)).toEqual(['d4', 'd5']);
    expect(view.main.moves[0]?.alternatives.map(line => line.moves[0]?.san)).toEqual(['e4', 'c4']);
    const remaining = deleteVariation(promoted, 1);
    expect(buildMoveTree(game, remaining, remaining.cursor).main.moves.map(move => move.san))
      .toEqual(['e4', 'e5']);
    expect(remaining.nodes.map(node => node.san)).toEqual(['c4']);
    expect(game.history.map(move => move.san)).toEqual(['e4', 'e5']);
  });

  it('renders a live move list as noninteractive paired text', () => {
    const html = markup({ ...savedGame(), status: 'active', result: null }, null, false);
    expect(html).toContain('>e4</span>');
    expect(html).toContain('>e5</span>');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('aria-current');
  });
});
