import { describe, expect, it } from 'vitest';
import { filterNagGroups, moveNagLabel, nagDetails, nagGroups } from '../src/pgn-nags';

describe('PGN annotation catalog', () => {
  it('covers every defined non-null value exactly once and excludes reserved values', () => {
    const values = nagGroups.flatMap(group => group.options.map(option => option.value));
    expect(values.toSorted((a, b) => a - b)).toEqual(Array.from({ length: 139 }, (_, i) => i + 1));
    expect(nagDetails(0)).toBeUndefined();
    expect(nagDetails(140)).toBeUndefined();
  });

  it('describes representative move, position, rook-placement, and time-pressure values', () => {
    expect(nagDetails(8)).toMatchObject({ glyph: 'only move', description: 'Singular move; no reasonable alternatives' });
    expect(nagDetails(20)?.glyph).toBe('W: crushing');
    expect(nagDetails(23)?.glyph).toBe('B: zugzwang');
    expect(nagDetails(94)?.description).toBe('White has poor rook placement');
    expect(nagDetails(135)?.description).toBe('Black has decisive counterplay');
    expect(nagDetails(139)?.description).toBe('Black has severe time control pressure');
    expect(nagGroups.flatMap(group => group.options).every(item => !item.glyph.startsWith('$'))).toBe(true);
  });

  it('filters by meaning, PGN value, and group without listing unrelated values', () => {
    expect(filterNagGroups('rook placement').flatMap(group => group.options.map(item => item.value)))
      .toEqual([94, 95, 96, 97]);
    expect(filterNagGroups('139').flatMap(group => group.options.map(item => item.value))).toEqual([139]);
    expect(filterNagGroups('$139').flatMap(group => group.options.map(item => item.value))).toEqual([139]);
    expect(filterNagGroups('time pressure').map(group => group.label)).toContain('Time pressure');
    expect(filterNagGroups('no such annotation')).toEqual([]);
  });

  it('uses compact move-list labels while retaining descriptive picker labels', () => {
    expect(nagDetails(35)).toMatchObject({ glyph: 'B: development decisive',
      description: 'Black has a decisive time (development) advantage' });
    expect(moveNagLabel(35)).toBe('B:dev!');
    expect(moveNagLabel(139)).toBe('B:time!');
    expect(moveNagLabel(5)).toBe('!?');
    expect(moveNagLabel(140)).toBeUndefined();
    for (let value = 1; value <= 139; value++) {
      expect(moveNagLabel(value), `NAG ${value}`).toBeTruthy();
      expect(moveNagLabel(value)!.length, `NAG ${value}`).toBeLessThanOrEqual(12);
    }
  });
});
