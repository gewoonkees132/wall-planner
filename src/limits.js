// Every limit of the planner and its message (design, parts 5, 6 and 10).
// Pure: no browser objects.

import { BLOCK, MAX_GAP, MAX_WALL_HEIGHT } from './block.js';
import { wallHeight } from './bond.js';
import { TEXTS } from './texts.js';
import { refusals } from './fillet.js';

export const MIN_COURSES = 1;

// The whole wall, base course and cap included, stays within 2.0 m.
export function fitsHeight(n) {
  return wallHeight(n) <= MAX_WALL_HEIGHT + 1e-9;
}

// The most earth courses: the largest n that fits, 16 [A].
export const MAX_COURSES = (() => {
  let n = MIN_COURSES;
  while (fitsHeight(n + 1)) n++;
  return n;
})();

// 6.2 step 6. The centreline radius at which the gap on the outer face
// reaches the widest gap: R = (L / tan(g / 2D) + D) / 2, with D the
// deepest unit in use. About 1.43 m for 115 mm, 2.19 m for 175 mm [A].
// Turned blocks take the room p instead of L, about 1.53 m [A].
export function minRadius(depthMm, room = BLOCK.length) {
  const D = depthMm / 1000;
  return (room / Math.tan(MAX_GAP / (2 * D)) + D) / 2;
}

// 6.2 step 5. For each pair of neighbours in a course, the gap on the outer
// face is the unit depth times the change in bearing between them. A pair
// wider than the widest gap fails, and the message names the limit.
export function checkBends(layout, { depthMm }) {
  const D = depthMm / 1000;
  const failing = [];
  let worstGap = 0;
  const { units } = layout;
  for (let i = 1; i < units.length; i++) {
    const a = units[i - 1];
    const b = units[i];
    if (a.course !== b.course) continue;
    const gap = D * Math.abs(b.bearing - a.bearing);
    if (gap > worstGap) worstGap = gap;
    if (gap > MAX_GAP + 1e-12) failing.push({ course: a.course, s: (a.position + b.position) / 2, gap });
  }
  const minimum = minRadius(depthMm, Math.max(BLOCK.length, layout.p || 0));
  const ok = failing.length === 0;
  return { ok, worstGap, failing, minimum, message: ok ? null : TEXTS.wall.tooTight(minimum) };
}

// Pass 3 (part 11.2). The corners of a polyline with fillets: a round or
// free corner under the minimum bend, or a sharp corner that is not
// square, is refused; each refusal marks its arc, or the line beside its corner.
export function checkCorners(line, { depthMm, room = BLOCK.length }) {
  const minimum = minRadius(depthMm, Math.max(BLOCK.length, room));
  const refused = refusals(line.corners || [], minimum);
  const ok = refused.length === 0;
  const square = refused.some((c) => c.reason === 'square');
  const failing = refused.map((c) => ({
    corner: c.index, reason: c.reason,
    from: c.kind === 'sharp' ? c.s - 0.2 : c.from, to: c.kind === 'sharp' ? c.s + 0.2 : c.to,
  }));
  return {
    ok, minimum, failing, reason: ok ? null : square ? 'square' : 'tight',
    message: ok ? null : square ? TEXTS.wall.squareHint : TEXTS.wall.tooTight(minimum),
  };
}
