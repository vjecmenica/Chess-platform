import { describe, expect, it } from 'vitest';
import { resultDisplay } from '../src/result-display';

describe('finished game result display', () => {
  it('shows the score and names the resignation winner', () => {
    expect(resultDisplay({ outcome: 'win', winner: 'white', reason: 'resignation' }))
      .toEqual({ score: '1-0', explanation: 'White won by resignation.' });
    expect(resultDisplay({ outcome: 'win', winner: 'black', reason: 'resignation' }))
      .toEqual({ score: '0-1', explanation: 'Black won by resignation.' });
  });

  it('shows a draw score and no final score while a ruling is pending', () => {
    expect(resultDisplay({ outcome: 'draw', reason: 'resignation_no_mating_possibility' }))
      .toEqual({ score: '½–½', explanation: 'Draw: the opponent cannot possibly checkmate.' });
    expect(resultDisplay(null)).toBeNull();
  });

  it('names an aborted game without awarding a score', () => {
    expect(resultDisplay({ outcome: 'aborted', reason: 'first_move_deadline',
      missedSide: 'black', deadlineMs: 30_000 })).toEqual({ score: 'Aborted',
      explanation: 'Black did not make a first move in time. No win or loss was recorded.' });
  });
});
