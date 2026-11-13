import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DrawOfferControl } from '../src/DrawOfferControl';

const render = (ply: number, nextEligiblePly: number, busy = false) => renderToStaticMarkup(
  createElement(DrawOfferControl, { ply, nextEligiblePly, busy, onOffer: () => {} }));

it.each([
  [1, 2, 'Both players must make a move before offering a draw.'],
  [8, 25, 'You can offer another draw after 17 more half-moves.'],
  [24, 25, 'You can offer another draw after 1 more half-move.'],
] as const)('describes the disabled offer at ply %i through a focusable tooltip trigger', (ply, nextEligiblePly, reason) => {
  const html = render(ply, nextEligiblePly);
  const id = html.match(/id="([^"]+)" role="tooltip"/)?.[1];
  expect(id).toBeTruthy();
  expect(html).toContain(`aria-describedby="${id}" tabindex="0"`);
  expect(html).toContain(`<button type="button" class="secondary" disabled="" aria-describedby="${id}"><svg aria-hidden="true"`);
  expect(html).toContain('</svg>Offer draw</button>');
  expect(html).toContain(`hidden="">${reason}</span>`);
});

it('enables offers at the first eligible ply and preserves pending-request disabling', () => {
  expect(render(25, 25)).toMatch(/^<button type="button" class="secondary">.*Offer draw<\/button>$/);
  expect(render(25, 25, true)).toMatch(/^<button type="button" class="secondary" disabled="">.*Offer draw<\/button>$/);
});
