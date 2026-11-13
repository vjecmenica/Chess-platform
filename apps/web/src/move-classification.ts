// The same colors and original 24-unit glyphs are used on every board and interface theme.
export const moveClassifications = {
  brilliant: { label: 'Brilliant', color: '#38b9b0', path: 'M8 5v9m8-9v9m-8 5h.01m7.99 0h.01' },
  great: { label: 'Great', color: '#54a9d8', path: 'M12 5v9m0 5h.01' },
  best: { label: 'Best move', color: '#5ead71', path: 'm12 3 2.6 5.7 6.2.7-4.6 4.3 1.2 6.2-5.4-3.1-5.4 3.1 1.2-6.2-4.6-4.3 6.2-.7Z' },
  excellent: { label: 'Excellent', color: '#81b77a', path: 'm3 12 4 4 8-9m-4 9 2 2 8-9' },
  good: { label: 'Good', color: '#a2b76a', path: 'm5 12 5 5 9-10' },
  book: { label: 'Book', color: '#a493c6', path: 'M12 6v13m0 0c-2-2-5-3-9-2V5c4-1 7 0 9 2 2-2 5-3 9-2v12c-4-1-7 0-9 2Z' },
  inaccuracy: { label: 'Inaccuracy', color: '#ddbb55', path: 'M3 8a4 4 0 1 1 7 2c-2 2-3 2-3 4m0 4h.01M17 5v9m0 4h.01' },
  mistake: { label: 'Mistake', color: '#df904b', path: 'M7 8a5 5 0 1 1 9 3c-2 2-4 2-4 4m0 4h.01' },
  miss: { label: 'Miss', color: '#d97864', path: 'm6 6 12 12M18 6 6 18' },
  blunder: { label: 'Blunder', color: '#cf5a5a', path: 'M2 8a4 4 0 1 1 7 2c-2 2-3 2-3 4m0 4h.01M13 8a4 4 0 1 1 7 2c-2 2-3 2-3 4m0 4h.01' },
  mate: { label: 'Mate score', color: '#b2b9c1', path: 'M5 18V6l7 8 7-8v12' },
} as const;

export type MoveClassification = keyof typeof moveClassifications;
