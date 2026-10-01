// Values and meanings follow section 10 of the PGN Standard.
// https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm#c10
export const nagGroups = [
  { label: 'Move quality', options: [
    { value: 3, glyph: '!!', description: 'Very good move' },
    { value: 1, glyph: '!', description: 'Good move' },
    { value: 5, glyph: '!?', description: 'Speculative move' },
    { value: 6, glyph: '?!', description: 'Questionable move' },
    { value: 2, glyph: '?', description: 'Poor move' },
    { value: 4, glyph: '??', description: 'Very poor move' },
  ] },
  { label: 'Position', options: [
    { value: 10, glyph: '=', description: 'Drawish position' },
    { value: 11, glyph: '= quiet', description: 'Equal chances, quiet position' },
    { value: 12, glyph: '= active', description: 'Equal chances, active position' },
    { value: 13, glyph: '∞', description: 'Unclear position' },
    { value: 14, glyph: '+=', description: 'White has a slight advantage' },
    { value: 15, glyph: '=+', description: 'Black has a slight advantage' },
    { value: 16, glyph: '+/-', description: 'White has a moderate advantage' },
    { value: 17, glyph: '-/+', description: 'Black has a moderate advantage' },
    { value: 18, glyph: '+-', description: 'White has a decisive advantage' },
    { value: 19, glyph: '-+', description: 'Black has a decisive advantage' },
  ] },
  { label: 'Other', options: [
    { value: 7, glyph: '□', description: 'Forced move' },
    { value: 22, glyph: '⊙', description: 'White is in zugzwang' },
    { value: 23, glyph: '⊙', description: 'Black is in zugzwang' },
  ] },
] as const;

export function nagDetails(value: number | undefined) {
  for (const group of nagGroups) {
    for (const option of group.options) if (option.value === value) return option;
  }
  return undefined;
}
