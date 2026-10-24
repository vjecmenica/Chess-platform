import type { GameReadResponse, GameSide } from '@chess/contracts';

export interface TimedMove {
  readonly ply: number;
  readonly side: GameSide;
  readonly san: string;
  readonly elapsedMs: number | null;
}

/** Only a single base time and Fischer increment have an unambiguous v1 meaning. */
export function simplePgnTimeControl(raw: string | undefined):
  { initialMs: number; incrementMs: number } | null {
  const match = /^(\d+)(?:\+(\d+))?$/.exec(raw?.trim() ?? '');
  if (!match) return null;
  const initialMs = Number(match[1]) * 1000;
  const incrementMs = Number(match[2] ?? 0) * 1000;
  return initialMs > 0 && Number.isSafeInteger(initialMs) && Number.isSafeInteger(incrementMs)
    ? { initialMs, incrementMs } : null;
}

export function moveTimes(game: GameReadResponse): readonly TimedMove[] {
  const control = game.timeControl === null ? null : 'source' in game.timeControl
    ? simplePgnTimeControl(game.timeControl.raw) : game.timeControl;
  const imported = game.timeControl !== null && 'source' in game.timeControl;
  const prior: Record<GameSide, number | null> = { white: null, black: null };
  const seen: Record<GameSide, boolean> = { white: false, black: false };
  return game.history.map(move => {
    const first = !seen[move.side];
    // This platform's first White move is free. Imported first-move clock
    // policies are unknown, even when their time control has a simple tag.
    const baseline = first && !imported && move.side === 'black'
      ? control?.initialMs ?? null : prior[move.side];
    const after = move.remainingMsAfterMove;
    const elapsed = control === null || after === null || baseline === null
      || first && (imported || move.side === 'white')
      ? null : baseline + control.incrementMs - after;
    seen[move.side] = true;
    prior[move.side] = after;
    return { ply: move.ply, side: move.side, san: move.san,
      elapsedMs: elapsed !== null && Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null };
  });
}
