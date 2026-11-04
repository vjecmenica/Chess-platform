import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { defaultAppearance, restoreAppearance, pieceSets, boardThemes } from '@chess/contracts';
import { pieceImage } from '../src/board-interaction';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppearanceSettings } from '../src/AppearanceSettings';
it('restores old, unknown and malicious preferences without changing defaults or accepting CSS injection', () => {
    expect(restoreAppearance(null)).toEqual(defaultAppearance);
    expect(restoreAppearance({ version: 2, theme: 'green' })).toEqual(defaultAppearance);
    expect(restoreAppearance({ version: 1, pieceSet: '../../secret', theme: 'future', scale: 1000, offset: NaN, light: 'url(https://bad)', shadow: -1 })).toEqual(defaultAppearance);
    expect(restoreAppearance({ ...defaultAppearance, pieceSet: 'kosal', theme: 'slate', scale: 105, offset: -4 })).toMatchObject({ pieceSet: 'kosal', theme: 'slate', scale: 105, offset: -4 });
    expect(Object.keys(boardThemes)).toHaveLength(6);
});
it('previews all twelve themed pieces and keeps advanced controls bounded and individually resettable', () => {
    const html = renderToStaticMarkup(createElement(AppearanceSettings));
    for (const side of ['w', 'b']) for (const piece of 'KQRBNP')
        expect(html).toContain(`/pieces/chessnut/${side}${piece}.svg`);
    expect(html).toContain('Piece artwork credits and licenses');
    expect(html).toContain('Guest preferences stay in this browser');
    expect(html).toMatch(/aria-label="Piece scale" min="80" max="110"/);
    expect(html).toMatch(/aria-label="Vertical offset" min="-8" max="8"/);
    expect(html).toContain('aria-label="Reset Piece scale"');
    expect(html).toContain('aria-label="Reset Vertical offset"');
    expect(html).toContain('>Advanced</summary>');
});
it('bundles complete pinned sets with matching hashes and full license texts, without remote SVG resources', () => {
    const root = new URL('../public/pieces/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
    expect(manifest.map((x: any) => x.id)).toEqual([...pieceSets]);
    for (const set of manifest) {
        expect(set.files).toHaveLength(12);
        expect(readFileSync(new URL(set.id + '/LICENSE.txt', root), 'utf8').length).toBeGreaterThan(500);
        for (const file of set.files) {
            const bytes = readFileSync(new URL(set.id + '/' + file.file, root));
            expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
            expect(bytes.toString()).not.toMatch(/<script|(?:href|src)=["']https?:/i);
        }
        expect(pieceImage('N', set.id)).toBe('/pieces/' + set.id + '/wN.svg');
        expect(pieceImage('q', set.id)).toBe('/pieces/' + set.id + '/bQ.svg');
    }
});
