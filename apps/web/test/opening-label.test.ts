import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { identifyOpening } from '@chess/domain/openings';
import { parsePgn } from '@chess/domain';
import { OpeningLabel, recordedOpening } from '../src/OpeningLabel';

it('recognizes ordinary opening names and keeps a more specific name beyond theory', () => {
  const line = parsePgn('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Rb1 *').moves;
  expect(identifyOpening(line.slice(0, 2))).toEqual({ eco: 'B20', name: 'Sicilian Defense' });
  expect(identifyOpening(line.slice(0, 10))).toEqual({ eco: 'B90', name: 'Sicilian Defense: Najdorf Variation' });
  expect(identifyOpening(line)).toEqual(identifyOpening(line.slice(0, 10)));
  expect(identifyOpening([])).toBeNull();
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
