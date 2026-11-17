import { boardThemes, type BoardAppearance } from '@chess/contracts';

// Locally bundled, color-treated CC0 photographs; provenance is in public/boards.
const textures: Partial<Record<keyof typeof boardThemes, readonly [string, string]>> = {
  naturalwood: ['/boards/natural-oak-v4.jpg', '/boards/natural-oak-v4.jpg'],
  goldenwood: ['/boards/golden-light-v3.jpg', '/boards/golden-dark-v3.jpg'],
  oaksquares: ['/boards/oak-squares-v1.jpg', '/boards/oak-squares-v1.jpg'],
};

function luminance(hex: string): number {
  return [0.2126, 0.7152, 0.0722].reduce((total, weight, index) => {
    const channel = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return total + weight * (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  }, 0);
}

const coordinateInk = '#211912';
const coordinateIvory = '#fff9ef';
const coordinateContrastPivot = Math.sqrt((luminance(coordinateInk) + .05) * (luminance(coordinateIvory) + .05));
const coordinateColor = (surface: string) => luminance(surface) + .05 >= coordinateContrastPivot ? coordinateInk : coordinateIvory;

export function appearanceVariables(value: BoardAppearance): Record<string, string> {
  const colors = boardThemes[value.theme];
  const texture = textures[value.theme];
  const light = value.light ?? colors[0];
  const dark = value.dark ?? colors[1];
  return {
    '--appearance-light': light,
    '--appearance-dark': dark,
    '--appearance-coordinate-on-light': coordinateColor(light),
    '--appearance-coordinate-on-dark': coordinateColor(dark),
    '--appearance-light-texture': texture ? `url("${texture[0]}")` : 'none',
    '--appearance-dark-texture': texture ? `url("${texture[1]}")` : 'none',
    '--appearance-texture-size': ['naturalwood', 'oaksquares'].includes(value.theme) ? '800% 800%' : texture ? '400% 400%' : 'cover',
    '--appearance-oak-atlas': ['naturalwood', 'oaksquares'].includes(value.theme) ? '1' : '0',
    '--appearance-light-blend': value.light === null ? 'normal' : 'soft-light',
    '--appearance-dark-blend': value.dark === null ? 'normal' : 'soft-light',
    '--appearance-hint-shadow': texture ? '0 0 0 1px rgb(255 248 233 / .85)' : 'none',
    '--appearance-scale': String(value.scale / 100),
    '--appearance-offset': value.offset + '%',
    '--appearance-frame': value.frame ? value.frameColor : 'transparent',
    '--appearance-frame-width': value.frame ? value.frameWidth + 'px' : '0px',
    // Preserve the bar's reserved 1px border box even when both borders are off.
    '--appearance-evaluation-border': value.frame || value.grid ? value.frameColor : 'transparent',
    '--appearance-grid': value.grid ? 'inset 0 0 0 0.5px #5e4a3860' : 'none',
    // The existing yellow wash alone blends into warm materials. Keep its color
    // and add a quiet boundary only on the new warm presets.
    '--appearance-last-move-outline': ['amber', 'naturalwood', 'goldenwood', 'oaksquares'].includes(value.theme)
      ? 'inset 0 0 0 2px rgb(67 53 38 / .6)' : 'none',
    '--appearance-shadow': value.shadow
      ? `drop-shadow(0 1px 2px rgb(0 0 0 / ${value.shadow / 100}))` : 'none',
  };
}
