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

type OpeningHistory = readonly { afterFen: string }[];
const historyOpenings = new WeakMap<OpeningHistory, readonly (NamedPosition | null)[]>();

function moreSpecificOpening(best: NamedPosition | null, fen: string): NamedPosition | null {
  const opening = index.get(canonicalPositionKey(fen));
  return opening && (!best || opening.depth >= best.depth) ? opening : best;
}

/** Use the selected main-line prefix and then its variation, if any. All FENs are canonical. */
export function identifyOpening(history: OpeningHistory, ply = history.length, variation: readonly string[] = []): OpeningName | null {
  let prefixes = historyOpenings.get(history);
  if (!prefixes) {
    const computed: (NamedPosition | null)[] = [null];
    for (let i = 0; i < Math.min(history.length, maxOpeningPly); i++) {
      computed.push(moreSpecificOpening(computed[i] ?? null, history[i]!.afterFen));
    }
    historyOpenings.set(history, computed);
    prefixes = computed;
  }
  const prefix = Math.max(0, Math.min(ply, prefixes.length - 1));
  let best = prefixes[prefix] ?? null;
  for (let i = 0; i < Math.min(variation.length, maxOpeningPly - prefix); i++) {
    best = moreSpecificOpening(best, variation[i]!);
  }
  return best ? { eco: best.eco, name: best.name } : null;
}
