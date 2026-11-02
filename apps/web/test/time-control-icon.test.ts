import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { timeControlPresets } from '@chess/contracts';
import { InfoTimeControl, infoTimeControl, timeCategory, TimeControlIcon, type TimeCategory } from '../src/TimeControlIcon';

it('uses the explicit product categories rather than a speed formula or a formatted display string', () => {
  expect(timeCategory(timeControlPresets['1+0'])).toBe('bullet');
  expect(timeCategory(timeControlPresets['5+3'])).toBe('blitz');
  expect(timeCategory(timeControlPresets['15+5'])).toBe('rapid');
  expect(timeCategory(timeControlPresets['20+0'])).toBe('classical');
  expect(timeCategory(timeControlPresets['30+10'])).toBe('classical');
  expect(timeCategory({ initialMs: 120000, incrementMs: 1000 })).toBeNull();
  expect(timeCategory({ initialMs: 0, incrementMs: 0 })).toBeNull();
});
it('keeps unknown and untimed controls honest without assigning a default category or icon', () => {
  expect(infoTimeControl({ timeControl: null, clockStatus: 'authoritative' }))
    .toEqual({ label: 'Unavailable', category: null, pgn: false });
  expect(infoTimeControl({ timeControl: null, clockStatus: 'not_integrated' }).label).toBe('Unavailable');
  const game = { timeControl: timeControlPresets['5+3'], clockStatus: 'not_integrated' as const };
  expect(infoTimeControl(game)).toEqual({ label: 'Untimed', category: null, pgn: false });
  const html = renderToStaticMarkup(createElement(InfoTimeControl, { game }));
  expect(html).toContain('Untimed'); expect(html).not.toContain('<svg');
});
it('preserves raw PGN metadata and identifies its source, classifying only simple controls matching supported presets', () => {
  const game = (raw: string) => ({ timeControl: { source: 'pgn' as const, raw }, clockStatus: 'not_integrated' as const });
  expect(infoTimeControl(game('300+3'))).toEqual({ label: '300+3', category: 'blitz', pgn: true });
  expect(infoTimeControl(game('40/7200:3600'))).toEqual({ label: '40/7200:3600', category: null, pgn: true });
  expect(infoTimeControl(game('-'))).toEqual({ label: 'Unavailable', category: null, pgn: true });
  expect(infoTimeControl(game('120+1')).category).toBeNull();
  const html = renderToStaticMarkup(createElement(InfoTimeControl, { game: game('300+3') }));
  expect(html).toContain('>300+3</span>'); expect(html).toContain('>Blitz</small>');
  expect(html).toContain('aria-label="PGN time control"');
});
it('keeps a visible category and numeric control beside decorative 20px symbols', () => {
  const html = renderToStaticMarkup(createElement(InfoTimeControl, { game: {
    timeControl: timeControlPresets['10+5'], clockStatus: 'authoritative' } }));
  expect(html).toContain('>10+5</span>'); expect(html).toContain('>Rapid</small>');
  expect(html).toContain('width="20" height="20"'); expect(html).toContain('aria-hidden="true"');
  const icons = (['bullet', 'blitz', 'rapid', 'classical'] as TimeCategory[])
    .map(category => renderToStaticMarkup(createElement(TimeControlIcon, { category })));
  expect(new Set(icons).size).toBe(4);
  for (const icon of icons) expect(icon).toContain('viewBox="0 0 24 24"');
});
