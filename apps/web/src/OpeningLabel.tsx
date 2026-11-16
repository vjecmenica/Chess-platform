import { useEffect, useMemo, useState } from 'react';
import type { SavedMove } from '@chess/contracts';
import type { OpeningName } from '@chess/domain/openings';
import { variationFens, type AnalysisTree } from './analysis-model';

export function recordedOpening(headers: Readonly<Record<string, string>> | undefined): OpeningName | null {
  const name = headers?.Opening?.trim();
  const eco = headers?.ECO?.trim();
  return name && name !== '?' && name !== '-' && name !== '*'
    ? { name, eco: eco && /^[A-E]\d{2}$/.test(eco) ? eco : null } : null;
}

export function openingAtPosition(identify: typeof import('@chess/domain/openings')['identifyOpening'],
  history: readonly SavedMove[], ply: number, tree: AnalysisTree | null,
  headers: Readonly<Record<string, string>> | undefined): OpeningName | null {
  const inVariation = tree?.cursor.kind === 'branch';
  const detected = identify(history, ply, inVariation ? variationFens(tree) : []);
  // PGN tags describe the finished main line. They cannot date the opening to an earlier ply or a branch.
  return detected ?? (!inVariation && ply > 0 && ply === history.length ? recordedOpening(headers) : null);
}

export function useGameOpening(history: readonly SavedMove[] | undefined, ply: number, tree: AnalysisTree | null,
  headers: Readonly<Record<string, string>> | undefined): OpeningName | null {
  const [index, setIndex] = useState<typeof import('@chess/domain/openings') | null>(null);
  const needsLookup = !!history?.length || tree?.cursor.kind === 'branch';
  useEffect(() => {
    if (!needsLookup || index) return;
    let current = true;
    void import('@chess/domain/openings').then(module => { if (current) setIndex(module); }).catch(() => {});
    return () => { current = false; };
  }, [needsLookup, index]);
  return useMemo(() => index && history ? openingAtPosition(index.identifyOpening, history, ply, tree, headers) : null,
    [index, history, ply, tree, headers]);
}

export function OpeningLabel({ opening }: { opening: OpeningName | null }) {
  if (!opening) return null;
  return <p className="opening-label" title={[opening.eco, opening.name].filter(Boolean).join(' · ')}>
    {opening.eco && <small>{opening.eco} <span aria-hidden="true">·</span></small>}
    <span>{opening.name}</span>
  </p>;
}
