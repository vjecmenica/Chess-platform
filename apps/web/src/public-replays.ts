import { parsePgn } from '@chess/domain';

// Only intentionally published, redistributable games belong here. Site games,
// local imports and licensed Opening Explorer records have separate access rules.
const publicReplays = {
  'scholars-mate': '[Event "Scholar’s mate demonstration"]\n[White "White"]\n[Black "Black"]\n[Result "1-0"]\n\n'
    + '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0',
} as const;

export function publicReplay(id: string) {
  if (!Object.hasOwn(publicReplays, id)) return null;
  return parsePgn(publicReplays[id as keyof typeof publicReplays]);
}

export function publicReplayId(id: string): boolean {
  return Object.hasOwn(publicReplays, id);
}

export function publicReplayUrl(id: string, ply?: number): string {
  return `/analysis/public/${encodeURIComponent(id)}${ply === undefined ? '' : `?ply=${ply}`}`;
}
