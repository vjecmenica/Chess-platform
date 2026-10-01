import type { GameState } from '@chess/contracts';

export function resultDisplay(result: GameState['result']): { score: string; explanation: string } | null {
  if (result === null) return null;
  if (result.outcome === 'draw') return { score: '½–½',
    explanation: result.reason === 'resignation_no_mating_possibility'
      ? 'Draw: the opponent cannot possibly checkmate.'
      : result.reason === 'timeout_no_mating_possibility'
        ? 'Draw: the opponent cannot possibly checkmate after the flag.'
        : `Draw by ${result.reason.replaceAll('_', ' ')}.` };
  return { score: result.winner === 'white' ? '1-0' : '0-1',
    explanation: `${result.winner === 'white' ? 'White' : 'Black'} won by ${result.reason.replaceAll('_', ' ')}.` };
}
