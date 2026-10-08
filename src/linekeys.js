// The base line editor from the keyboard (quality pass; pass 3 of the
// Aicher loop, part 11.4): which point is picked, and what a key does to
// the points and their corners. Space picks the next point, the arrow keys
// move it, Enter adds a point in the middle of the stretch after it, a free
// corner, Delete removes an inner point and its corner. A digit or R opens
// a dimension's field (ui/line-editor.js). Pure: no browser objects.

import { TEXTS } from './texts.js';

export const STEP = 0.01; // m, an arrow key
export const BIG_STEP = 0.1; // m, an arrow key with Shift
export const MAX_POINTS = 10; // [R]

const ARROWS = Object.freeze({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] });
const centimetre = (v) => Math.round(v * 100) / 100;

// One key on the drawing. Returns the points, their corners, the picked
// point and, when a new point is refused, the design's words for why; null
// for a key the editor leaves alone, so Tab still moves on. minStretch is
// the shortest stretch, in m, that takes a new point: 88 px on screen.
export function lineKey({ points, corners = [], picked, key, shift = false, minStretch = 0 }) {
  const n = points.length;
  const at = Math.min(n - 1, Math.max(0, picked));
  const kinds = Array.from({ length: Math.max(0, n - 2) }, (_, i) => (corners[i] === undefined ? null : corners[i]));
  if (key === ' ' || key === 'Spacebar') return { points, corners: kinds, picked: (at + (shift ? n - 1 : 1)) % n };
  if (ARROWS[key]) {
    const [dx, dy] = ARROWS[key];
    const step = shift ? BIG_STEP : STEP;
    const next = points.map((p) => p.slice());
    next[at] = [centimetre(next[at][0] + dx * step), centimetre(next[at][1] + dy * step)];
    return { points: next, corners: kinds, picked: at };
  }
  if (key === 'Enter') {
    if (n >= MAX_POINTS) return { points, corners: kinds, picked: at, refused: TEXTS.wall.mostPoints };
    // The stretch after the picked point; after the last point there is none, so the one before it.
    const k = at < n - 1 ? at : at - 1;
    const [a, b] = [points[k], points[k + 1]];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minStretch) return { points, corners: kinds, picked: at, refused: TEXTS.wall.noRoom };
    const middle = [centimetre((a[0] + b[0]) / 2), centimetre((a[1] + b[1]) / 2)];
    kinds.splice(k, 0, null);
    return { points: [...points.slice(0, k + 1), middle, ...points.slice(k + 1)], corners: kinds, picked: k + 1 };
  }
  if (key === 'Delete' || key === 'Backspace') {
    if (at === 0 || at === n - 1) return { points, corners: kinds, picked: at };
    kinds.splice(at - 1, 1);
    return { points: [...points.slice(0, at), ...points.slice(at + 1)], corners: kinds, picked: at - 1 };
  }
  return null;
}
