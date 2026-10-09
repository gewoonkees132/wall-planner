// A radius the hand can feel (pass 5 of the Aicher loop,
// docs/specs/configurator-demonstrator-ux-aicher.md, part 13.1, rules 7 and
// 8): the radii a corner can take, the radius under a handle at the arc's
// middle, and one step from a tight bend to a wall that fits. Corners are
// numbered by their point, as in fillet.js. Pure: no browser objects.

import { cornersOf, refusals } from './fillet.js';

export const ceilCm = (v) => Math.ceil(v * 100 - 1e-6) / 100;
export const floorCm = (v) => Math.floor(v * 100 + 1e-6) / 100;
const centimetre = (v) => Math.round(v * 100) / 100;

// The radii corner i can take without the overlap rule scaling it: from
// the minimum of the blocks to the largest its stretches leave room for,
// an end stretch whole, an inner one less the arc of its other corner as
// drawn. Null where the line runs straight on.
export function radiusRange(points, kinds, i, minimum) {
  const { stretches, corners } = cornersOf(points, kinds);
  const c = corners[i - 1];
  if (!c || c.kind === 'none') return null;
  const before = i >= 2 ? corners[i - 2].t : 0;
  const after = i < corners.length ? corners[i].t : 0;
  const room = Math.min(stretches[i - 1].length - before, stretches[i].length - after);
  return { min: ceilCm(minimum), max: c.k > 0 ? floorCm(room / c.k) : Infinity, set: c.set, drawn: c.radius, kind: c.kind };
}

// The radius whose arc at corner i passes through a place, taken on the
// corner's bisector toward the arc's centre; negative beyond the point.
export function radiusThrough(points, i, [x, y]) {
  const [ax, ay] = points[i - 1];
  const [px, py] = points[i];
  const [bx, by] = points[i + 1];
  const unit = (dx, dy) => { const d = Math.hypot(dx, dy) || 1; return [dx / d, dy / d]; };
  const u1 = unit(px - ax, py - ay);
  const u2 = unit(bx - px, by - py);
  const inward = unit(u2[0] - u1[0], u2[1] - u1[1]);
  const half = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]))) / 2;
  const per = 1 / Math.cos(half) - 1;
  const d = (x - px) * inward[0] + (y - py) * inward[1];
  return per > 1e-9 ? d / per : Infinity;
}

const tightAt = (points, kinds, i, minimum) => {
  const c = cornersOf(points, kinds).corners[i - 1];
  return Boolean(c) && (c.kind === 'free' || c.kind === 'round') && c.radius < minimum - 1e-9;
};

// Corner i's point moved straight toward its chord, by whole centimetres,
// to the first place where its bend fits; null if none does.
function towardChord(points, kinds, i, minimum) {
  const [ax, ay] = points[i - 1];
  const [qx, qy] = points[i];
  const [bx, by] = points[i + 1];
  const len = Math.hypot(bx - ax, by - ay);
  if (!(len > 1e-9)) return null;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const along = (qx - ax) * ux + (qy - ay) * uy;
  const fx = ax + ux * along;
  const fy = ay + uy * along;
  const gap = Math.hypot(qx - fx, qy - fy);
  const steps = Math.ceil(gap * 100);
  for (let k = 1; k <= steps; k++) {
    const f = Math.min(1, k / (gap * 100));
    const next = points.map((p) => p.slice());
    next[i] = [centimetre(qx + (fx - qx) * f), centimetre(qy + (fy - qy) * f)];
    if (!tightAt(next, kinds, i, minimum)) return next;
  }
  return null;
}

// One step from a tight bend to a wall that fits: the tightest refused
// corner first, a set radius lifted to the minimum, its point moved toward
// its chord where that is not enough; then the next. Null when nothing is
// tight, or when no such step makes every bend fit.
export function fitBend(points, kinds, minimum) {
  let P = points.map((p) => p.slice());
  const K = kinds.slice();
  for (let round = 0; round < 12; round++) {
    const tight = refusals(cornersOf(P, K).corners, minimum).filter((c) => c.reason === 'tight');
    if (!tight.length) return round ? { points: P, corners: K } : null;
    const { index: i, kind } = tight.reduce((a, b) => (b.radius < a.radius ? b : a));
    if (kind === 'round') K[i - 1] = Math.max(K[i - 1], ceilCm(minimum));
    if (tightAt(P, K, i, minimum)) {
      const moved = towardChord(P, K, i, minimum);
      if (!moved) return null;
      P = moved;
    }
  }
  return null;
}
