// Courses and units along the line, and their heights (design, 6.1).
// Pure: no browser objects.

import {
  BLOCK, HALF_LENGTH, LENGTH_STEP, MIN_LENGTH, MAX_LENGTH,
  BASE_HEIGHT, CAP_HEIGHT, MAX_ANGLE,
} from './block.js';

const EPS = 1e-9;

// 6.1 step 1. Snap a length to a whole number of half blocks, then clamp
// it to the shortest and the longest wall. Works in whole millimetres, so
// 3.00 m stays 3.00 m.
export function snapLength(value) {
  const step = Math.round(LENGTH_STEP * 1000);
  const v = Number(value);
  let k = Number.isFinite(v) ? Math.round((v * 1000) / step) : 0;
  const kMin = Math.round((MIN_LENGTH * 1000) / step);
  const kMax = Math.round((MAX_LENGTH * 1000) / step);
  k = Math.min(kMax, Math.max(kMin, k));
  return (k * step) / 1000;
}

// 6.1 step 2. The room one full unit takes along a course, p, and half of
// it, h. A turned block needs more room: p = L cos(a) + D sin(a).
export function pitchOf({ rotation = false } = {}) {
  const L = BLOCK.length;
  if (!rotation) return { p: L, h: HALF_LENGTH };
  const a = (MAX_ANGLE * Math.PI) / 180;
  const D = BLOCK.depth / 1000;
  const p = L * Math.cos(a) + D * Math.sin(a);
  return { p, h: p / 2 };
}

// 6.1 step 3. The number of half slots along the usable length.
export function halfSlots(lambda, h) {
  return Math.floor(lambda / h + EPS);
}

// 6.1 step 4. The units of course r, from the start: odd courses start
// with full units, even courses (base course and cap included) with a half.
export function courseSequence(r, m) {
  const seq = [];
  if (r % 2 === 1) {
    for (let i = 0; i < Math.floor(m / 2); i++) seq.push('full');
    if (m % 2 === 1) seq.push('half');
  } else {
    seq.push('half');
    for (let i = 0; i < Math.floor((m - 1) / 2); i++) seq.push('full');
    if (m % 2 === 0) seq.push('half');
  }
  return seq;
}

// 6.1 step 6. The whole wall: base course, n earth courses and the cap.
export function wallHeight(n) {
  return BASE_HEIGHT + n * BLOCK.height + CAP_HEIGHT;
}

// The kind, height and centre height of course r of a wall of n earth courses.
export function courseLevel(r, n) {
  if (r === 0) return { kind: 'base', height: BASE_HEIGHT, z: BASE_HEIGHT / 2 };
  if (r === n + 1) {
    return { kind: 'cap', height: CAP_HEIGHT, z: BASE_HEIGHT + n * BLOCK.height + CAP_HEIGHT / 2 };
  }
  return { kind: 'earth', height: BLOCK.height, z: BASE_HEIGHT + (r - 0.5) * BLOCK.height };
}

export function makeUnit({ course, index, size, n, position, span, x, y, bearing }) {
  const level = courseLevel(course, n);
  return {
    course,
    index,
    size,
    kind: level.kind,
    position,
    span,
    length: size === 'full' ? BLOCK.length : HALF_LENGTH,
    height: level.height,
    z: level.z,
    x,
    y,
    bearing,
  };
}

// 6.1 in full, for a straight line from (0, 0) along the x axis.
export function layStraight({ length, courses, rotation = false }) {
  const lambda = snapLength(length);
  const { p, h } = pitchOf({ rotation });
  const m = halfSlots(lambda, h);
  const n = courses;
  const units = [];
  for (let r = 0; r <= n + 1; r++) {
    let run = 0;
    courseSequence(r, m).forEach((size, i) => {
      const span = size === 'full' ? p : h;
      const position = run + span / 2;
      run += span;
      units.push(makeUnit({ course: r, index: i + 1, size, n, position, span, x: position, y: 0, bearing: 0 }));
    });
  }
  return { lambda, p, h, m, n, height: wallHeight(n), units };
}

// 6.2 step 4. The courses laid along a line: each unit faces along the
// line at its centre, and after each unit the spacing grows by the amount
// that keeps the next unit touching on the inner face of a bend: the
// unit's reach on that side times the change in bearing, in radians. A
// course stops when the next unit would pass the usable length; a half
// unit is placed if one fits. On a straight line this is 6.1 exactly.
export function layOnLine(line, { courses, rotation = false, depthMm = BLOCK.depth }) {
  if (line.runs && line.runs.length > 1) return layRuns(line, { courses, rotation, depthMm });
  const lambda = line.usable;
  const { p, h } = pitchOf({ rotation });
  const m = halfSlots(lambda, h);
  const n = courses;
  // Back faces are in line, so a deeper unit reaches further to the front
  // (the left) than to the back. A turned block reaches further on both sides.
  const half = depthMm / 2000;
  const shift = (depthMm - BLOCK.depth) / 2000;
  let reachLeft = half + shift;
  let reachRight = half - shift;
  if (rotation) {
    const a = (MAX_ANGLE * Math.PI) / 180;
    const turned = (BLOCK.length / 2) * Math.sin(a) + (BLOCK.depth / 2000) * Math.cos(a);
    reachLeft = Math.max(reachLeft, turned);
    reachRight = Math.max(reachRight, turned);
  }

  function fit(previous, size) {
    const span = size === 'full' ? p : h;
    let position = previous ? previous.position + (previous.span + span) / 2 : span / 2;
    if (previous) {
      for (let k = 0; k < 4; k++) {
        const turn = line.pointAt(position).bearing - previous.bearing;
        const reach = turn >= 0 ? reachLeft : reachRight;
        position = previous.position + (previous.span + span) / 2 + reach * Math.abs(turn);
      }
    }
    if (position + span / 2 > lambda + EPS) return null;
    return { size, span, position };
  }

  const units = [];
  for (let r = 0; r <= n + 1; r++) {
    let previous = null;
    let size = r % 2 === 1 ? 'full' : 'half';
    let index = 0;
    for (;;) {
      let next = fit(previous, size);
      if (!next && size === 'full') next = fit(previous, 'half');
      if (!next) break;
      index++;
      const point = line.pointAt(next.position);
      units.push(makeUnit({
        course: r, index, size: next.size, n, position: next.position, span: next.span,
        x: point.x, y: point.y, bearing: point.bearing,
      }));
      if (next.size === 'half' && index > 1) break;
      previous = { position: next.position, span: next.span, bearing: point.bearing };
      size = 'full';
    }
  }
  return { lambda, p, h, m, n, height: wallHeight(n), units };
}

// Pass 3 (part 11.3). The reach of a unit on either side of the line, for
// the spacing on a bend: back faces are in line, so a deeper unit reaches
// further to the front (the left) than to the back; a turned block reaches
// further on both sides.
function reaches(rotation, depthMm) {
  const half = depthMm / 2000;
  const shift = (depthMm - BLOCK.depth) / 2000;
  let left = half + shift;
  let right = half - shift;
  if (rotation) {
    const a = (MAX_ANGLE * Math.PI) / 180;
    const turned = (BLOCK.length / 2) * Math.sin(a) + (BLOCK.depth / 2000) * Math.cos(a);
    left = Math.max(left, turned);
    right = Math.max(right, turned);
  }
  return { left, right };
}

// At a sharp corner one leg runs through: its last unit reaches over the
// other leg's thickness, half the wall's depth with its joint, 0.06 m
// (placeholder: half of a half block [A]); the other leg starts as far on
// the far side.
export const HALF_JOINT = HALF_LENGTH / 2;

// The point of a run at t, run along in straight lines past its ends.
function runPoint(run, t) {
  if (t < 0) return { x: run.first[0] + Math.cos(run.startBearing) * t, y: run.first[1] + Math.sin(run.startBearing) * t, bearing: run.startBearing };
  if (t > run.line.length) {
    const over = t - run.line.length;
    return { x: run.last[0] + Math.cos(run.endBearing) * over, y: run.last[1] + Math.sin(run.endBearing) * over, bearing: run.endBearing };
  }
  return run.line.pointAt(t);
}

// One course of one run, between a and b: full units from the chosen end,
// a half unit at the far end where one fits; on a bend the spacing grows
// with the turn, as in layOnLine.
function layRun(run, a, b, backward, { p, h, reach }) {
  const out = [];
  let previous = null;
  let size = 'full';
  const fit = (span) => {
    const sign = backward ? -1 : 1;
    const start = backward ? b - span / 2 : a + span / 2;
    let t = previous ? previous.t + sign * (previous.span + span) / 2 : start;
    if (previous) {
      for (let k = 0; k < 4; k++) {
        const turn = sign * (runPoint(run, t).bearing - previous.bearing);
        const extra = (turn >= 0 ? reach.left : reach.right) * Math.abs(turn);
        t = previous.t + sign * ((previous.span + span) / 2 + extra);
      }
    }
    const inside = backward ? t - span / 2 >= a - EPS : t + span / 2 <= b + EPS;
    return inside ? t : null;
  };
  for (;;) {
    let span = size === 'full' ? p : h;
    let t = fit(span);
    if (t === null && size === 'full') {
      size = 'half';
      span = h;
      t = fit(span);
    }
    if (t === null) break;
    const point = runPoint(run, t);
    out.push({ size, span, position: run.start + t, x: point.x, y: point.y, bearing: point.bearing });
    if (size === 'half' && out.length > 1) break;
    previous = { t, span, bearing: point.bearing };
    size = 'full';
  }
  return out;
}

// The courses of a line with sharp corners, run by run (part 11.3). A run
// that starts at a corner is laid from it; one that only ends at a corner
// is laid from that end; what is left over falls at a free end. At the
// k-th corner the leg before it runs through in course r when r + k is odd.
export function layRuns(line, { courses, rotation = false, depthMm = BLOCK.depth }) {
  const { p, h } = pitchOf({ rotation });
  const reach = reaches(rotation, depthMm);
  const n = courses;
  const limit = Math.min(line.length, MAX_LENGTH);
  const runs = line.runs.filter((run) => run.start < limit - EPS).map((run) => {
    const cut = run.start + run.length > limit + EPS;
    return cut ? { ...run, length: limit - run.start, endCorner: 0 } : run;
  });
  const offset = (r, k) => (((r + k) % 2 === 1) ? HALF_JOINT : -HALF_JOINT);
  const units = [];
  let lambda = 0;
  for (let r = 0; r <= n + 1; r++) {
    const course = [];
    for (const run of runs) {
      const a = run.startCorner ? offset(r, run.startCorner) : 0;
      const b = run.length + (run.endCorner ? offset(r, run.endCorner) : 0);
      course.push(...layRun(run, a, b, !run.startCorner && Boolean(run.endCorner), { p, h, reach }));
    }
    course.sort((u, v) => u.position - v.position);
    course.forEach((u, i) => {
      units.push(makeUnit({ course: r, index: i + 1, size: u.size, n, position: u.position, span: u.span, x: u.x, y: u.y, bearing: u.bearing }));
      lambda = Math.max(lambda, u.position + u.span / 2);
    });
  }
  lambda = Math.min(lambda, limit);
  return { lambda, p, h, m: halfSlots(lambda, h), n, height: wallHeight(n), units };
}
