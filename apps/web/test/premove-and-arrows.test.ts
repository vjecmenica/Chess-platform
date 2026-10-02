import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createPositionFromFen } from '@chess/domain';
import { arrowPath, BoardArrows } from '../src/BoardArrows';
import { isLeftPointerPress, keepsPremovesOnLeftPress } from '../src/board-interaction';
import { arrowCenter, toggleArrow } from '../src/board-arrows';
import { addPremove, consumePremove, nextPremove, premoveChoice, projectedPieces,
  type Premove } from '../src/premove-model';

const whiteWaiting = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
const blackWaiting = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('client-side premoves', () => {
  it('queues consecutive plans without changing the confirmed position', () => {
    const first = premoveChoice(whiteWaiting, 'white', [], 'e2', 'e4');
    expect(first).toEqual({ kind: 'move', from: 'e2', to: 'e4' });
    const queue: Premove[] = [{ id: 'one', from: 'e2', to: 'e4' }];
    expect(premoveChoice(whiteWaiting, 'white', queue, 'e4', 'e5'))
      .toEqual({ kind: 'move', from: 'e4', to: 'e5' });
    expect(projectedPieces(whiteWaiting, 'white', queue).get('e4')).toBe('P');
    expect(projectedPieces(whiteWaiting, 'white', queue).has('e2')).toBe(false);
    expect(createPositionFromFen(whiteWaiting).getPosition().fen).toBe(whiteWaiting);
  });

  it('executes only the head after the confirmed turn changes, then waits for the next turn', () => {
    const queue: Premove[] = [
      { id: 'one', from: 'e7', to: 'e5' }, { id: 'two', from: 'g8', to: 'f6' },
    ];
    expect(nextPremove(blackWaiting, 'black', queue)).toBeNull();
    const position = createPositionFromFen(blackWaiting);
    expect(position.submitMove({ side: 'white', from: 'd2', to: 'd4' }).accepted).toBe(true);
    expect(nextPremove(position.getPosition().fen, 'black', queue)).toEqual(queue[0]);
    expect(position.submitMove({ side: 'black', from: 'e7', to: 'e5' }).accepted).toBe(true);
    const remaining = consumePremove(queue, 'one');
    expect(nextPremove(position.getPosition().fen, 'black', remaining)).toBeNull();
    expect(position.submitMove({ side: 'white', from: 'g1', to: 'f3' }).accepted).toBe(true);
    expect(nextPremove(position.getPosition().fen, 'black', remaining)).toEqual(queue[1]);
  });

  it('rejects an invalid head after an opponent reply instead of applying later plans', () => {
    const queue: Premove[] = [
      { id: 'one', from: 'e4', to: 'e5' }, { id: 'two', from: 'g1', to: 'f3' },
    ];
    const afterBlackE5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
    expect(nextPremove(afterBlackE5, 'white', queue)).toBeNull();
    expect(consumePremove(queue, 'wrong-id')).toEqual(queue);
  });

  it('cancels or replaces the queue independently of the saved board', () => {
    const first: Premove = { id: 'one', from: 'e2', to: 'e4' };
    const replacement: Premove = { id: 'two', from: 'd2', to: 'd4' };
    expect(addPremove([first], replacement)).toEqual([first, replacement]);
    expect(addPremove([], replacement)).toEqual([replacement]);
    expect(consumePremove([first, replacement], 'one')).toEqual([replacement]);
    expect(nextPremove(whiteWaiting, 'white', [])).toBeNull();
    expect(premoveChoice(whiteWaiting, 'white', [first], 'e2', 'e3')).toEqual({ kind: 'invalid' });
  });

  it('uses the cleared queue when the same left gesture creates a replacement premove', () => {
    const old: Premove[] = [{ id: 'old', from: 'e2', to: 'e4' }];
    expect(premoveChoice(whiteWaiting, 'white', old, 'e4', 'e5').kind).toBe('move');
    const afterLeftPress: Premove[] = [];
    expect(premoveChoice(whiteWaiting, 'white', afterLeftPress, 'e4', 'e5'))
      .toEqual({ kind: 'invalid' });
    const replacement = premoveChoice(whiteWaiting, 'white', afterLeftPress, 'd2', 'd4');
    expect(replacement).toEqual({ kind: 'move', from: 'd2', to: 'd4' });
    expect(addPremove(afterLeftPress, { id: 'new', from: 'd2', to: 'd4' }))
      .toEqual([{ id: 'new', from: 'd2', to: 'd4' }]);
    expect(old).toHaveLength(1);
  });

  it('keeps the queue for another board premove but cancels it on an outside click', () => {
    const first: Premove = { id: 'one', from: 'e2', to: 'e4' };
    expect(keepsPremovesOnLeftPress(true, false, true)).toBe(true);
    expect(premoveChoice(whiteWaiting, 'white', [first], 'g1', 'f3'))
      .toEqual({ kind: 'move', from: 'g1', to: 'f3' });
    const second: Premove = { id: 'two', from: 'g1', to: 'f3' };
    expect(addPremove([first], second)).toEqual([first, second]);
    expect(keepsPremovesOnLeftPress(false, false, true)).toBe(false);
    expect(keepsPremovesOnLeftPress(true, false, false)).toBe(false);
    expect(keepsPremovesOnLeftPress(false, true, true)).toBe(true);
    expect(addPremove([], second)).toEqual([second]);
  });

  it('keeps promotion and king-on-rook gestures tentative until turn-time validation', () => {
    const promotion = '4k3/P7/8/8/8/8/8/4K3 b - - 0 1';
    expect(premoveChoice(promotion, 'white', [], 'a7', 'a8'))
      .toEqual({ kind: 'promotion', from: 'a7', to: 'a8' });
    const castle = 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1';
    expect(premoveChoice(castle, 'white', [], 'e1', 'h1'))
      .toEqual({ kind: 'move', from: 'e1', to: 'g1' });
  });
});

describe('board arrows', () => {
  it('clears on a left mouse press, not on right-arrow or touch input', () => {
    expect(isLeftPointerPress(0, 'mouse')).toBe(true);
    expect(isLeftPointerPress(2, 'mouse')).toBe(false);
    expect(isLeftPointerPress(0, 'touch')).toBe(false);
  });

  it('adds multiple arrows and toggles only an exact repeated arrow', () => {
    const first = toggleArrow([], 'e2', 'e4');
    const both = toggleArrow(first, 'g1', 'f3');
    expect(both).toHaveLength(2);
    expect(toggleArrow(both, 'e2', 'e4')).toEqual([{ from: 'g1', to: 'f3' }]);
    expect(toggleArrow(first, 'e2', 'e2')).toEqual(first);
  });

  it('positions arrows by square coordinates under either board orientation', () => {
    expect(arrowCenter('a1', 'white')).toEqual({ x: 50, y: 750 });
    expect(arrowCenter('a1', 'black')).toEqual({ x: 750, y: 50 });
    expect(arrowCenter('h8', 'white')).toEqual({ x: 750, y: 50 });
    expect(arrowCenter('h8', 'black')).toEqual({ x: 50, y: 750 });
  });

  it('joins one opaque shaft and head at the destination in either orientation', () => {
    const arrows = toggleArrow(toggleArrow([], 'e2', 'e4'), 'g1', 'f3');
    const html = renderToStaticMarkup(createElement(BoardArrows, { arrows, orientation: 'white' }));
    expect(html).not.toContain('<marker');
    expect(html).not.toContain('<line');
    expect((html.match(/<path /g) ?? [])).toHaveLength(2);
    expect((html.match(/stroke="none"/g) ?? [])).toHaveLength(2);
    const straight = arrowPath({ x: 450, y: 650 }, { x: 450, y: 450 });
    expect(straight).toContain('L 474.00 502.00 L 450 450 L 426.00 502.00');
    expect(straight).toContain('M 456.00 650.00 L 456.00 489.00');
    expect(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'))
      .toContain('fill: rgba(162, 77, 31, .8); stroke: rgba(162, 77, 31, .8);');
    expect(renderToStaticMarkup(createElement(BoardArrows, {
      arrows: toggleArrow(arrows, 'e2', 'e4'), orientation: 'white',
    })).match(/<path /g)).toHaveLength(1);
    const flipped = renderToStaticMarkup(createElement(BoardArrows, {
      arrows: [{ from: 'e2', to: 'e4' }], orientation: 'black',
    }));
    expect(flipped).toContain('L 350 350');
    expect(flipped).toContain('M 344.00 150.00');
  });
});
