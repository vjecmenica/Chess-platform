import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultTimeControl, isTimeControlId, timeControlPresets } from '@chess/contracts';
import { TimeControlSelect, timeControlLabel } from '../src/TimeControlSelect';

describe('challenge time-control selection', () => {
  it('offers the agreed presets in order and preselects 5+3', () => {
    expect(Object.keys(timeControlPresets)).toEqual(['1+0', '3+0', '3+2', '5+3',
      '10+0', '10+2', '10+5', '15+0', '15+2', '15+5',
      '20+0', '20+10', '25+0', '25+10', '30+0', '30+10']);
    const html = renderToStaticMarkup(createElement(TimeControlSelect,
      { value: defaultTimeControl, disabled: false, onChange: () => {} }));
    expect(html).toContain('<option value="5+3" selected="">5+3</option>');
    expect(html.match(/<option /g)).toHaveLength(16);
  });

  it('renders a changed selection and keeps labels consistent with the preset durations', () => {
    const html = renderToStaticMarkup(createElement(TimeControlSelect,
      { value: '30+10', disabled: true, onChange: () => {} }));
    expect(html).toContain('<option value="30+10" selected="">30+10</option>');
    expect(html).toContain('<select disabled="">');
    for (const [id, preset] of Object.entries(timeControlPresets)) {
      expect(timeControlLabel(preset.initialMs, preset.incrementMs)).toBe(id);
      expect(isTimeControlId(id)).toBe(true);
    }
    for (const value of ['2+0', '5+0', '__proto__', 300000, null, undefined])
      expect(isTimeControlId(value)).toBe(false);
  });
});
