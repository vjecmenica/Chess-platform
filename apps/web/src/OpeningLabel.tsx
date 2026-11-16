import { useEffect, useMemo, useState } from 'react';
import type { SavedMove } from '@chess/contracts';
import type { OpeningName } from '@chess/domain/openings';

export function recordedOpening(headers: Readonly<Record<string, string>> | undefined): OpeningName | null {
  const name = headers?.Opening?.trim();
  const eco = headers?.ECO?.trim();
  return name && name !== '?' && name !== '-' && name !== '*'
    ? { name, eco: eco && /^[A-E]\d{2}$/.test(eco) ? eco : null } : null;
}

export function useGameOpening(history: readonly SavedMove[] | undefined,
  headers: Readonly<Record<string, string>> | undefined): OpeningName | null {
  const [index, setIndex] = useState<typeof import('@chess/domain/openings') | null>(null);
  const recorded = useMemo(() => recordedOpening(headers), [headers]);
  const needsLookup = !recorded && !!history?.length;
  useEffect(() => {
    if (!needsLookup || index) return;
    let current = true;
    void import('@chess/domain/openings').then(module => { if (current) setIndex(module); }).catch(() => {});
    return () => { current = false; };
  }, [needsLookup, index]);
  const detected = useMemo(() => needsLookup && history ? index?.identifyOpening(history) ?? null : null,
    [index, history, needsLookup]);
  const eco = headers?.ECO?.trim();
  return recorded ?? detected ?? (eco && /^[A-E]\d{2}$/.test(eco)
    ? { eco, name: 'Opening not identified' } : null);
}

export function OpeningLabel({ opening }: { opening: OpeningName | null }) {
  return <p className="opening-label" title={opening ? [opening.eco, opening.name].filter(Boolean).join(' · ') : undefined}>
    {opening?.eco && <small>{opening.eco} <span aria-hidden="true">·</span></small>}
    <span>{opening?.name ?? 'Opening not identified'}</span>
  </p>;
}
