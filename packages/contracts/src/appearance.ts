export const pieceSets = ['chessnut', 'kosal', 'celtic', 'fantasy', 'spatial', 'rhosgfx'] as const;
export const boardThemes = { default: ['#f0dfbd', '#aa7953'], classic: ['#f0d9b5', '#b58863'], wood: ['#e8cc9e', '#956b45'], green: ['#e7ead5', '#7e9472'], slate: ['#e0e5e8', '#7b8c9d'], contrast: ['#ffffff', '#767676'] } as const;
export interface BoardAppearance {
    version: 1;
    pieceSet: typeof pieceSets[number];
    theme: keyof typeof boardThemes;
    light: string | null;
    dark: string | null;
    scale: number;
    offset: number;
    frame: boolean;
    frameColor: string;
    frameWidth: number;
    grid: boolean;
    shadow: number;
}
export const defaultAppearance: BoardAppearance = { version: 1, pieceSet: 'chessnut', theme: 'default', light: null, dark: null, scale: 100, offset: 0, frame: true, frameColor: '#755740', frameWidth: 2, grid: false, shadow: 0 };
export const appearanceSchema = { type: 'object', additionalProperties: false, required: Object.keys(defaultAppearance), properties: { version: { const: 1 }, pieceSet: { enum: pieceSets }, theme: { enum: Object.keys(boardThemes) }, light: { anyOf: [{ type: 'null' }, { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }] }, dark: { anyOf: [{ type: 'null' }, { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }] }, scale: { type: 'integer', minimum: 80, maximum: 110 }, offset: { type: 'integer', minimum: -8, maximum: 8 }, frame: { type: 'boolean' }, frameColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, frameWidth: { type: 'integer', minimum: 1, maximum: 5 }, grid: { type: 'boolean' }, shadow: { type: 'integer', minimum: 0, maximum: 30 } } } as const;
export function restoreAppearance(value: unknown): BoardAppearance { const v = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; const out = { ...defaultAppearance }; if (v.version !== 1)
    return out; for (const key of Object.keys(out) as (keyof BoardAppearance)[]) {
    const x = v[key];
    let valid = false;
    if (key === 'pieceSet')
        valid = pieceSets.includes(x as never);
    else if (key === 'theme')
        valid = typeof x === 'string' && Object.hasOwn(boardThemes, x);
    else if (key === 'light' || key === 'dark')
        valid = x === null || typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x);
    else if (key === 'frameColor')
        valid = typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x);
    else if (key === 'frame' || key === 'grid')
        valid = typeof x === 'boolean';
    else if (key === 'version')
        continue;
    else {
        const bounds = { scale: [80, 110], offset: [-8, 8], frameWidth: [1, 5], shadow: [0, 30] }[key];
        valid = typeof x === 'number' && Number.isInteger(x) && x >= bounds[0]! && x <= bounds[1]!;
    }
    if (valid)
        Object.assign(out, { [key]: x });
} return out; }
