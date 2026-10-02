import { describe, expect, it } from 'vitest';
import { createPositionFromFen } from '@chess/domain';
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
    expect(addPremove([first], replacement, true)).toEqual([replacement]);
    expect(consumePremove([first, replacement], 'one')).toEqual([replacement]);
    expect(nextPremove(whiteWaiting, 'white', [])).toBeNull();
    expect(premoveChoice(whiteWaiting, 'white', [first], 'e2', 'e3')).toEqual({ kind: 'invalid' });
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
});
