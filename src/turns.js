// The brush (revision 1, part 5 "The angles"): a tap at a block is a
// stamp, kept in metres along the line from the start and in a course,
// so a turned patch stays put when the wall grows, shrinks or bends. A
// stamp turns the block under it one step and its neighbours less, to
// nothing at the brush radius; taps add up. Pure: no browser objects.

import { BRUSH_STEP, BRUSH_RADIUS, MAX_ANGLE, MAX_TURNS } from './block.js';

const toCentimetre = (v) => Math.round(v * 100) / 100;

// A new list with the stamp added, or the same list and refused when the
// wall carries the most it may.
export function addTurn(turns, { x, course, dir }) {
  if (turns.length >= MAX_TURNS) return { turns, refused: true };
  const d = dir < 0 ? -1 : 1;
  return { turns: [...turns, { x: toCentimetre(x), course: Math.round(course), dir: d }], refused: false };
}

export function clearTurns() {
  return [];
}

// How much of a stamp reaches a unit: 1 under the tap, 0 at the radius,
// with the distance measured in cells along the course and in courses.
export function reach(stamp, unit, p) {
  const along = (unit.position - stamp.x) / p;
  const up = unit.course - stamp.course;
  const d2 = along * along + up * up;
  const r2 = BRUSH_RADIUS * BRUSH_RADIUS;
  return d2 >= r2 ? 0 : 1 - d2 / r2;
}

// The angle of a unit after the stamps, from the angle its motif gave it,
// clamped to the largest angle either way.
export function applyTurns(angle, turns, unit, p) {
  let a = angle;
  for (const stamp of turns) {
    const f = reach(stamp, unit, p);
    if (f > 0) a += stamp.dir * BRUSH_STEP * f;
  }
  return Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, a));
}
