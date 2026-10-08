// Typed distances and radii (pass 3 of the Aicher loop, part 11.4): a
// dimension on the drawing is the place where its number is typed. A
// stretch's length moves the points after it along the stretch, so the
// other stretches keep their lengths and turns; a radius sets the corner,
// 0 makes it sharp. Pure: no browser objects.

import { HALF_LENGTH } from './block.js';

const centimetre = (v) => Math.round(v * 100) / 100;

// A number as a visitor types it: a point or a comma, with or without its
// unit, a radius with or without its R.
export function readNumber(text) {
  const cleaned = String(text ?? '').trim().replace(/^r\s*/i, '').replace(/\s*m$/i, '').replace(',', '.').trim();
  if (!/^\d*\.?\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

// A typed length, rounded to whole half blocks, never under one.
export function roundStretch(value) {
  const step = Math.round(HALF_LENGTH * 1000);
  const k = Math.max(1, Math.round((value * 1000) / step));
  const rounded = (k * step) / 1000;
  return { value: rounded, rounded: Math.abs(rounded - value) > 1e-9 };
}

// The stretch from point k to point k + 1 set to a length.
export function withStretchLength(points, k, length) {
  if (k < 0 || k + 1 >= points.length || !(length > 0)) return points;
  const [x0, y0] = points[k];
  const [x1, y1] = points[k + 1];
  const d = Math.hypot(x1 - x0, y1 - y0);
  let ux = 1;
  let uy = 0;
  if (d > 1e-9) {
    ux = (x1 - x0) / d;
    uy = (y1 - y0) / d;
  } else if (k > 0) {
    const [xp, yp] = points[k - 1];
    const dp = Math.hypot(x0 - xp, y0 - yp);
    if (dp > 1e-9) {
      ux = (x0 - xp) / dp;
      uy = (y0 - yp) / dp;
    }
  }
  const dx = ux * (length - d);
  const dy = uy * (length - d);
  return points.map(([x, y], i) => (i > k ? [centimetre(x + dx), centimetre(y + dy)] : [x, y]));
}

// The corner at point i (an inner point) set to a radius in m; 0 is sharp.
export function withCornerRadius(corners, i, radius) {
  if (i < 1 || i > corners.length || !(radius >= 0) || !Number.isFinite(radius)) return corners;
  const next = corners.slice();
  next[i - 1] = centimetre(radius);
  return next;
}
