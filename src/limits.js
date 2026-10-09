// Every limit of the planner and its message (design, parts 5, 6 and 10).
// Pure: no browser objects.

import {
  BLOCK, MAX_GAP, MAX_WALL_HEIGHT, MAX_LENGTH, HAND_RADIUS, ROBOT_RADIUS, TEMPLATE_FACTOR,
} from './block.js';
import { wallHeight, reaches, pitchOf } from './bond.js';
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

// The robot split (docs/specs/configurator-demonstrator-robot-split.md,
// part 3.2 and reading 2). The three bands of an arc's radius: under robot
// it is refused; from robot up to hand it is the robot's, in cut blocks;
// from hand up to template it asks for a template; from template on it is
// a person's. Kees's numbers hold for the wall as it opens (115 mm, turned
// blocks); a deeper unit or a wider room scales them all by the old rule's
// minimum radius, which keeps the outer joint at the people's limit.
export function bendBands(depthMm = BLOCK.depth, room = BLOCK.length) {
  const factor = minRadius(depthMm, Math.max(BLOCK.length, room)) / minRadius(BLOCK.depth, pitchOf({ rotation: true }).p);
  const hand = HAND_RADIUS * factor;
  return { robot: ROBOT_RADIUS * factor, hand, template: TEMPLATE_FACTOR * hand, factor };
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
// free corner under the minimum bend is refused, and its arc marked. Since
// the robot split (2026-10-09) the minimum is the robot's, 0.80 m on the
// wall as it opens, and a sharp corner is allowed at any angle.
export function checkCorners(line, { depthMm, room = BLOCK.length }) {
  const minimum = bendBands(depthMm, room).robot;
  const refused = refusals(line.corners || [], minimum);
  const ok = refused.length === 0;
  const failing = refused.map((c) => ({ corner: c.index, reason: c.reason, from: c.from, to: c.to }));
  return { ok, minimum, failing, reason: ok ? null : 'tight', message: ok ? null : TEXTS.wall.tooTight(minimum) };
}

// Pass 4 (part 12.1, rule 3; a reading of open decision 26). A wall never
// meets itself: no two places of the line closer than the wall's thickness
// and a joint, D, when they lie further apart along the line than 2 D (so a
// square corner never counts). The thickness is twice the wider reach of a
// unit, as two fronts may face each other. Returns the stretch of the line
// that comes too near, or null.
export const SELF_JOINT = 0.01; // m, placeholder
export function nearItself(line, { rotation = false, depthMm = BLOCK.depth, step = 0.02 } = {}) {
  const reach = reaches(rotation, depthMm);
  const D = 2 * Math.max(reach.left, reach.right) + SELF_JOINT;
  const along = 2 * D;
  const limit = Math.min(line.length, MAX_LENGTH);
  const at = [];
  for (let s = 0; s <= limit + 1e-9; s += step) {
    const p = line.pointAt(Math.min(s, limit));
    at.push([s, p.x, p.y]);
  }
  // The samples in square cells of D, so each one looks only at the cells
  // round it: the check grows with the wall's length, not with its square.
  const cells = new Map();
  const cellKey = (cx, cy) => `${cx},${cy}`;
  at.forEach(([, x, y], i) => {
    const key = cellKey(Math.floor(x / D), Math.floor(y / D));
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  });
  const nearEarlier = (j) => {
    const [s, x, y] = at[j];
    const cx = Math.floor(x / D);
    const cy = Math.floor(y / D);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of cells.get(cellKey(cx + dx, cy + dy)) || []) {
          if (i < j && s - at[i][0] > along && Math.hypot(x - at[i][1], y - at[i][2]) < D) return true;
        }
      }
    }
    return false;
  };
  let from = null;
  let to = null;
  for (let j = 0; j < at.length; j++) {
    if (nearEarlier(j)) {
      if (from === null) from = at[j][0];
      to = at[j][0];
    }
  }
  return from === null ? null : { from: Math.max(0, from - 0.1), to: Math.min(limit, to + 0.1), distance: D };
}

// Pass 4 (part 12.1, rules 1 to 3). Everything that refuses a line, in one
// answer: a bend too tight, a wall that comes too near itself, a stretch
// between two corners that no whole blocks fill.
export function checkWall(line, layout, { depthMm, rotation = false }) {
  const corners = checkCorners(line, { depthMm, room: layout.p });
  const near = nearItself(line, { rotation, depthMm });
  const whole = layout.refused || [];
  const failing = [
    ...corners.failing,
    ...(near ? [{ reason: 'near', from: near.from, to: near.to }] : []),
    ...whole.map((w) => ({ reason: 'whole', from: w.from, to: w.to })),
  ];
  const ok = failing.length === 0;
  const reason = ok ? null : ['tight', 'near', 'whole'].find((r) => failing.some((f) => f.reason === r));
  const message = { tight: TEXTS.wall.tooTight(corners.minimum), near: TEXTS.wall.nearHint, whole: TEXTS.wall.wholeHint }[reason] ?? null;
  return { ok, minimum: corners.minimum, failing, reason, message };
}
