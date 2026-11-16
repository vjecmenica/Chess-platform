import { openingData, maxOpeningPly } from './opening-data.js';
import { canonicalPositionKey } from './position-key.js';

export interface OpeningName { readonly eco: string | null; readonly name: string }
interface NamedPosition extends OpeningName { readonly depth: number }

const index = new Map<string, NamedPosition>();
for (const row of openingData.trimEnd().split('\n')) {
  const [key, depth, eco, name] = row.split('\t');
  index.set(key!, { depth: Number(depth), eco: eco!, name: name! });
}

/** The caller supplies a position key already normalized by the chess domain. */
export function namedOpeningAt(key: string): OpeningName | null {
  const opening = index.get(key);
  return opening ? { eco: opening.eco, name: opening.name } : null;
}

const historyOpenings = new WeakMap<readonly { afterFen: string }[], OpeningName | null>();

/** Use only the recorded main line. Saved FENs are canonical chess-domain output. */
export function identifyOpening(history: readonly { afterFen: string }[]): OpeningName | null {
  const cached = historyOpenings.get(history);
  if (cached !== undefined) return cached;
  let best: NamedPosition | undefined;
  for (let ply = 0; ply < Math.min(history.length, maxOpeningPly); ply++) {
    const opening = index.get(canonicalPositionKey(history[ply]!.afterFen));
    if (opening && (!best || opening.depth >= best.depth)) best = opening;
  }
  const result = best ? { eco: best.eco, name: best.name } : null;
  historyOpenings.set(history, result);
  return result;
}
