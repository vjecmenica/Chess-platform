const paths = {
  new: 'M12 4v16M4 12h16',
  rematch: 'M4 10a8 8 0 1 1 1 8M4 4v6h6',
  analysis: 'M4 19V5m0 14h16M7 15l4-5 4 3 5-8',
  draw: 'm2 11 4-6 4 2m12 4-4-6-3 1-3-.5-5 4a1.5 1.5 0 0 0 2 2l2-1.5 6 5a1.4 1.4 0 0 1-2 2l-4-3m-8-3 2 4 5 4a1.5 1.5 0 0 0 2-2m-2-2 3 2.5a1.4 1.4 0 0 0 2-2m6-4-3 4',
  resign: 'M5 21V3m0 2c5-5 9 4 14 0v10c-5 4-9-5-14 0',
};

export function ActionIcon({ kind }: { kind: keyof typeof paths }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]} /></svg>;
}
