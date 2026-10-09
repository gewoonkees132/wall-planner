// One unit for grid, snap and scale (pass 5 of the Aicher loop,
// docs/specs/configurator-demonstrator-ux-aicher.md, part 13.1, rule 3).
// The grid is the material's unit: it stands on the start point, along the
// first stretch, in the smallest step the drawing gives 8 px or more: half
// a block, else a block, else two blocks, and on a longer wall (Kees,
// 2026-10-08: no maximum length) twice that, and so on. A drag lands on its
// crossings, and the scale is a whole number of its steps. Pure: no browser
// objects.

import { HALF_LENGTH } from './block.js';

export const MIN_CELL = 8; // px: a finer grid turns grey
const MIN_BAR = 32; // px, placeholder
const DOUBLINGS = 24; // at most, so a drawing of no size still gets a step

// Half a block, doubled until a cell is 8 px or more.
export function gridStep(pxPerMetre) {
  let step = HALF_LENGTH;
  for (let i = 0; i < DOUBLINGS && step * pxPerMetre < MIN_CELL - 1e-9; i++) step *= 2;
  return step;
}

// The shortest scale of whole steps that is a readable bar: two blocks,
// doubled until it is as long as a step and 32 px or more.
export function scaleLength(step, pxPerMetre) {
  let length = 4 * HALF_LENGTH;
  for (let i = 0; i < DOUBLINGS && (length < step - 1e-9 || length * pxPerMetre < MIN_BAR); i++) length *= 2;
  return length;
}

// The grid's frame: its origin on the start point, level with the drawing.
// Laid along the first stretch, as first built, an old link's slanted first
// stretch turned the grid into a hatch, and a later fit could turn it away
// from the points set on it (part 13.5).
export function gridFrame(points) {
  return { origin: points[0].slice(), angle: 0 };
}

export function toGrid({ origin, angle }, [x, y]) {
  const dx = x - origin[0];
  const dy = y - origin[1];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [dx * c + dy * s, -dx * s + dy * c];
}

export function fromGrid({ origin, angle }, [u, v]) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [origin[0] + u * c - v * s, origin[1] + u * s + v * c];
}

export function nearestCrossing(frame, step, at) {
  const [u, v] = toGrid(frame, at);
  return fromGrid(frame, [Math.round(u / step) * step, Math.round(v / step) * step]);
}

// The crossings round a place, nearest first: where a point may land.
export function crossingsNear(frame, step, at) {
  const [u, v] = toGrid(frame, at);
  const out = [];
  for (const i of [Math.floor(u / step), Math.ceil(u / step)]) {
    for (const j of [Math.floor(v / step), Math.ceil(v / step)]) out.push(fromGrid(frame, [i * step, j * step]));
  }
  return out.sort((a, b) => Math.hypot(a[0] - at[0], a[1] - at[1]) - Math.hypot(b[0] - at[0], b[1] - at[1]));
}
