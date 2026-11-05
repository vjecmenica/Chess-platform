import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { defaultAppearance, restoreAppearance, pieceSets, boardThemes } from '@chess/contracts';
import { pieceImage } from '../src/board-interaction';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppearanceSettings } from '../src/AppearanceSettings';
import { AppearanceLauncher } from '../src/AppearanceSettings';
import { appearanceVariables } from '../src/appearance-styles';
it('restores old, unknown and malicious preferences without changing defaults or accepting CSS injection', () => {
    expect(restoreAppearance(null)).toEqual(defaultAppearance);
    expect(restoreAppearance({ version: 2, theme: 'green' })).toEqual(defaultAppearance);
    expect(restoreAppearance({ version: 1, pieceSet: '../../secret', theme: 'future', scale: 1000, offset: NaN, light: 'url(https://bad)', shadow: -1 })).toEqual(defaultAppearance);
    expect(restoreAppearance({ ...defaultAppearance, pieceSet: 'kosal', theme: 'slate', scale: 105, offset: -4 })).toMatchObject({ pieceSet: 'kosal', theme: 'slate', scale: 105, offset: -4 });
    for (const theme of Object.keys(boardThemes))
        expect(restoreAppearance({ ...defaultAppearance, theme }).theme).toBe(theme);
    expect(defaultAppearance.theme).toBe('default');
    expect(boardThemes.default).toEqual(['#f0dfbd', '#aa7953']);
    expect(appearanceVariables(defaultAppearance)['--appearance-last-move-outline']).toBe('none');
    expect(appearanceVariables({ ...defaultAppearance, theme: 'goldenwood' })['--appearance-last-move-outline']).toContain('inset');
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
    const sets = manifest.filter((x: any) => x.kind !== 'board-texture');
    expect(sets.map((x: any) => x.id)).toEqual([...pieceSets]);
    for (const set of sets) {
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
it('removes only the eval border color when both border controls are off', () => {
    expect(appearanceVariables(defaultAppearance)['--appearance-evaluation-border']).toBe('#755740');
    const borderless = { ...defaultAppearance, frame: false, grid: false };
    const variables = appearanceVariables(borderless);
    expect(variables['--appearance-evaluation-border']).toBe('transparent');
    expect(variables['--appearance-frame-width']).toBe('0px');
    expect(appearanceVariables({ ...borderless, grid: true })['--appearance-evaluation-border']).toBe('#755740');
    expect(variables).not.toHaveProperty('width');
    expect(variables).not.toHaveProperty('height');
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.evaluation-bar\s*\{[^}]*border: 1px solid var\(--appearance-evaluation-border,/);
    expect(css).toMatch(/\.evaluation-bar\s*\{[^}]*background: transparent/);
});
it('uses bounded local textures in preview and play, clears them for solids, and preserves custom colors', () => {
    for (const theme of ['naturalwood', 'goldenwood'] as const) {
        const variables = appearanceVariables({ ...defaultAppearance, theme, light: '#eeeeff', dark: '#554466' });
        expect(variables['--appearance-light-texture']).toMatch(/^url\("\/boards\/[a-z0-9-]+\.jpg"\)$/);
        expect(variables['--appearance-dark-texture']).not.toBe(variables['--appearance-light-texture']);
        expect(variables['--appearance-texture-size']).toBe('400% 400%');
        expect(variables['--appearance-light-blend']).toBe('soft-light');
        expect(variables['--appearance-light']).toBe('#eeeeff');
        expect(variables['--appearance-dark']).toBe('#554466');
    }
    expect(appearanceVariables({ ...defaultAppearance, theme: 'naturalwood' })['--appearance-light-blend']).toBe('normal');
    expect(appearanceVariables({ ...defaultAppearance, theme: 'purple' })['--appearance-light-texture']).toBe('none');
    const root = new URL('../public/pieces/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
    const textures = manifest.filter((x: any) => x.kind === 'board-texture');
    expect(textures.map((x: any) => x.id)).toEqual(['naturalwood', 'goldenwood']);
    for (const texture of textures) {
        expect(texture.files).toHaveLength(2);
        for (const file of texture.files) {
        const bytes = readFileSync(new URL(file.file, root));
        expect(bytes.length).toBe(file.bytes);
        expect(bytes.length).toBeLessThan(65000);
        expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
        expect(readFileSync(new URL(texture.licenseEvidence, root), 'utf8')).toContain(file.revision);
        }
    }
});
it('preserves the exact pre-photographic wood assets and definitions outside production', () => {
    const backup = new URL('../../../assets/board-backups/paired-wood-v2-ee528fc/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', backup), 'utf8'));
    for (const texture of manifest.filter((x: any) => x.kind === 'board-texture')) {
        for (const file of texture.files) {
            const name = file.file.split('/').at(-1);
            expect(createHash('sha256').update(readFileSync(new URL(name, backup))).digest('hex')).toBe(file.sha256);
        }
    }
    expect(readFileSync(new URL('appearance.ts.snapshot', backup), 'utf8')).toContain("naturalwood: ['#e3cba7', '#896545']");
    expect(readFileSync(new URL('README.md', backup), 'utf8')).toContain('To restore');
});
it('uses a recognizable SVG art control with an accessible name', () => {
    const html = renderToStaticMarkup(createElement(AppearanceLauncher));
    expect(html).toContain('aria-label="Board and piece appearance"');
    expect(html).toContain('<svg'); expect(html).not.toContain('⚙');
});
