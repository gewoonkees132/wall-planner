// sRGB to CIELAB, for sorting colours by lightness (design, 6.3 step 4).
// Pure: no browser objects. D65 white point.

export function normaliseHex(value) {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

export function hexToRgb(hex) {
  const h = normaliseHex(hex);
  if (!h) throw new TypeError(`not a colour: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function rgbToHex(rgb) {
  return `#${rgb
    .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
    .join('')}`;
}

function toLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

const WHITE = [0.95047, 1.0, 1.08883];
const DELTA = 6 / 29;

function f(t) {
  return t > DELTA ** 3 ? Math.cbrt(t) : t / (3 * DELTA * DELTA) + 4 / 29;
}

export function srgbToLab([r, g, b]) {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = 0.0193339 * R + 0.119192 * G + 0.9503041 * B;
  const fx = f(X / WHITE[0]);
  const fy = f(Y / WHITE[1]);
  const fz = f(Z / WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// CIELAB lightness L*, from 0 (black) to 100 (white).
export function lightness(hex) {
  return srgbToLab(hexToRgb(hex))[0];
}

// A colour scaled toward black: factor 1 keeps it, 0 gives black.
export function shade(hex, factor) {
  return rgbToHex(hexToRgb(hex).map((c) => c * factor));
}
