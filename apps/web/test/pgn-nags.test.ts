import { describe, expect, it } from 'vitest';
import { filterNagGroups, nagDetails, nagGroups } from '../src/pgn-nags';

describe('PGN annotation catalog', () => {
  it('covers every defined non-null value exactly once and excludes reserved values', () => {
    const values = nagGroups.flatMap(group => group.options.map(option => option.value));
    expect(values.toSorted((a, b) => a - b)).toEqual(Array.from({ length: 139 }, (_, i) => i + 1));
    expect(nagDetails(0)).toBeUndefined();
    expect(nagDetails(140)).toBeUndefined();
  });

  it('describes representative move, position, rook-placement, and time-pressure values', () => {
    expect(nagDetails(8)).toMatchObject({ glyph: '$8', description: 'Singular move; no reasonable alternatives' });
    expect(nagDetails(94)?.description).toBe('White has poor rook placement');
    expect(nagDetails(135)?.description).toBe('Black has decisive counterplay');
    expect(nagDetails(139)?.description).toBe('Black has severe time control pressure');
  });

  it('filters by meaning, PGN value, and group without listing unrelated values', () => {
    expect(filterNagGroups('rook placement').flatMap(group => group.options.map(item => item.value)))
      .toEqual([94, 95, 96, 97]);
    expect(filterNagGroups('$139').flatMap(group => group.options.map(item => item.value))).toEqual([139]);
    expect(filterNagGroups('time pressure').map(group => group.label)).toContain('Time pressure');
    expect(filterNagGroups('no such annotation')).toEqual([]);
  });
});
