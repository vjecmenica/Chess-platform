import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { identifyOpening } from '@chess/domain/openings';
import { parsePgn } from '@chess/domain';
import { OpeningLabel, openingAtPosition, recordedOpening } from '../src/OpeningLabel';
import { createAnalysisTree, mainAncestorPly, playAnalysisMove, selectMain } from '../src/analysis-model';
import { importPgn } from '../src/pgn-import';
import { MoveTree } from '../src/MoveTree';

it('recognizes ordinary opening names and keeps a more specific name beyond theory', () => {
  const line = parsePgn('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Rb1 *').moves;
  expect(identifyOpening(line, 0)).toBeNull();
  expect(identifyOpening(line, 2)).toEqual({ eco: 'B20', name: 'Sicilian Defense' });
  expect(identifyOpening(line, 10)).toEqual({ eco: 'B90', name: 'Sicilian Defense: Najdorf Variation' });
  expect(identifyOpening(line)).toEqual(identifyOpening(line, 10));
  expect(identifyOpening(line, 2)?.name).toBe('Sicilian Defense');
  expect(identifyOpening([])).toBeNull();
});

it('classifies only the ancestors of the selected variation and restores the main line on return', () => {
  const { game } = importPgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0', 'branches');
  const main = createAnalysisTree(game);
  const root = selectMain(main, game, 1);
  const sicilian = playAnalysisMove(root, game, 'c7', 'c5');
  if (!sicilian.accepted) throw new Error('Expected a legal variation.');
  const french = playAnalysisMove(selectMain(sicilian.tree, game, 1), game, 'e7', 'e6');
  if (!french.accepted) throw new Error('Expected another legal variation.');
  const opening = (tree: typeof main) => openingAtPosition(identifyOpening, game.history, mainAncestorPly(tree), tree, undefined)?.name;
  expect(opening(sicilian.tree)).toBe('Sicilian Defense');
  expect(opening(french.tree)).toBe('French Defense');
  expect(opening(main)).toBe('Ruy Lopez: Morphy Defense');
});

it('only falls back to supplied PGN metadata at the end of an unidentified saved main line', () => {
  const { game, headers } = importPgn('[Opening "Club study"]\n[ECO "A00"]\n\n1. f3 *', 'metadata');
  const unknown: typeof identifyOpening = () => null;
  expect(openingAtPosition(unknown, game.history, 0, null, headers)).toBeNull();
  expect(openingAtPosition(unknown, game.history, 1, null, headers)).toEqual({ eco: 'A00', name: 'Club study' });
  expect(openingAtPosition(identifyOpening, game.history, 1, null, headers)?.name).not.toBe('Club study');
  const tree = playAnalysisMove(createAnalysisTree(game), game, 'e7', 'e5');
  if (!tree.accepted) throw new Error('Expected a legal variation.');
  expect(openingAtPosition(unknown, game.history, 1, tree.tree, headers)).toBeNull();
});

it('puts the opening label directly before the moves in Play and Analysis', () => {
  const { game } = importPgn('1. e4 *', 'heading');
  for (const tree of [null, createAnalysisTree(game)]) {
    const html = renderToStaticMarkup(createElement(MoveTree, {
      game, tree, selected: { kind: 'main', ply: 1 }, interactive: true, onSelect: () => {}, onDelete: () => {},
      opening: identifyOpening(game.history, 1),
    }));
    expect(html).not.toContain('>Moves</h3>');
    expect(html).toMatch(/opening-label.*<\/p><ol class="main-line"/);
  }
});

it('identifies a transposition by position and shows a neutral label without evidence', () => {
  const a = parsePgn('1. d4 d5 2. c4 e6 *').moves;
  const b = parsePgn('1. c4 e6 2. d4 d5 *').moves;
  expect(identifyOpening(a)).toEqual(identifyOpening(b));
  expect(identifyOpening(a)?.name).toContain("Queen's Gambit Declined");
  expect(renderToStaticMarkup(createElement(OpeningLabel, { opening: null }))).toContain('Opening not identified');
});

it('preserves supplied PGN names and valid codes while treating placeholders as unavailable', () => {
  const headers = { Opening: ' Club line ', ECO: ' C20 ' };
  expect(recordedOpening(headers)).toEqual({ name: 'Club line', eco: 'C20' });
  expect(headers.Opening).toBe(' Club line ');
  expect(recordedOpening({ Opening: 'Known line', ECO: '?' })).toEqual({ name: 'Known line', eco: null });
  expect(recordedOpening({ Opening: '?', ECO: '?' })).toBeNull();
});
