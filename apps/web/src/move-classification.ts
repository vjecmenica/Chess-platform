// Original symbols and a shared palette for every board and interface theme.
export const moveClassifications = {
  brilliant: { label: 'Brilliant', color: '#38b9b0', glyph: '!!' },
  great: { label: 'Great', color: '#54a9d8', glyph: '!' },
  best: { label: 'Best move', color: '#5ead71', path: 'm12 2 2.8 6 6.6.8-4.9 4.7 1.3 6.6-5.8-3.3-5.8 3.3 1.3-6.6-4.9-4.7 6.6-.8Z', solid: true },
  excellent: { label: 'Excellent', color: '#81b77a', path: 'm2.8 12.8 4 4 9-10m-4 10 2.2 2.2 8-9' },
  good: { label: 'Good', color: '#a2b76a', path: 'm4 12 5 5 11-10' },
  book: { label: 'Book', color: '#a493c6', path: 'M12 7v12m0 0c-3-2-5-2.5-9-2V5c4-.5 6 0 9 2 3-2 5-2.5 9-2v12c-4-.5-6 0-9 2Z' },
  inaccuracy: { label: 'Inaccuracy', color: '#ddbb55', glyph: '?!' },
  mistake: { label: 'Mistake', color: '#df904b', glyph: '?' },
  miss: { label: 'Miss', color: '#d97864', path: 'm6 6 12 12M18 6 6 18' },
  blunder: { label: 'Blunder', color: '#cf5a5a', glyph: '??' },
  mate: { label: 'Mate score', color: '#b2b9c1', glyph: 'M' },
} as const;

export type MoveClassification = keyof typeof moveClassifications;
