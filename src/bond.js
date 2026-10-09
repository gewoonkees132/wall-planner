// Courses and units along the line, and their heights (design, 6.1).
// Pure: no browser objects.

import {
  BLOCK, HALF_LENGTH, LENGTH_STEP, MIN_LENGTH, MAX_LENGTH,
  BASE_HEIGHT, CAP_HEIGHT, MAX_ANGLE, MAX_GAP,
} from './block.js';
import { cornerKind, legAngle, cutSpan, arcCut } from './cut.js';

const EPS = 1e-9;

// The robot split (part 4.3 of docs/specs/configurator-demonstrator-robot-
// split.md): the arcs laid in cut blocks, the free or round corners under
// cutBelow, as { from, to, radius, point } along the line, the point
// numbered as the drawer names it.
export function cutArcs(line, cutBelow = 0) {
  if (!(cutBelow > 0) || !line.corners) return [];
  return line.corners
    .filter((c) => (c.kind === 'free' || c.kind === 'round') && c.t > 1e-9 && c.radius < cutBelow - 1e-9)
    .map((c) => ({ from: c.from, to: c.to, radius: c.radius, point: c.index + 1 }));
}

// The arc a span from a to b lies on most, if it touches one.
function arcOver(arcs, a, b) {
  let best = null;
  let most = 1e-6;
  for (const arc of arcs) {
    const over = Math.min(b, arc.to) - Math.max(a, arc.from);
    if (over > most) {
      most = over;
      best = arc;
    }
  }
  return best;
}

// The next unit of a course cut to the line on an arc, after previous, one
// way along it (dir 1) or the other (-1). After a cut unit it touches on the
// centreline, so the two share their end plane; after a whole unit it keeps
// off that unit's square end, as a whole unit does on a bend.
function cutNext(pointAt, previous, size, start, wedge, reach, arc, dir) {
  const length = size === 'full' ? BLOCK.length : HALF_LENGTH;
  let s0 = previous ? previous.position + (dir * previous.span) / 2 : start;
  if (previous && !previous.arc) {
    const base = s0;
    for (let k = 0; k < 4; k++) {
      const turn = dir * (pointAt(s0).bearing - previous.face);
      s0 = base + dir * (turn >= 0 ? wedge.left : wedge.right) * Math.abs(turn);
    }
  }
  const span = cutSpan(pointAt, s0, length, reach, dir);
  return { size, span, position: s0 + (dir * span) / 2, arc };
}

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

export function makeUnit({ course, index, size, n, position, span, x, y, bearing, corner = false, plain = false, cut = null }) {
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
    // Pass 4 (part 12.1, rule 2): a unit at a sharp corner, and a unit of a
    // run laid plain between two corners, is never turned; a corner unit
    // keeps the base depth.
    ...(corner ? { corner: true } : {}),
    ...(plain ? { plain: true } : {}),
    // The robot split: a cut block carries its two ends (cut.js).
    ...(cut ? { cut } : {}),
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
    const course = courseSequence(r, m).map((size) => {
      const span = size === 'full' ? p : h;
      const position = run + span / 2;
      run += span;
      return { size, span, position };
    });
    // Pass 5 (part 13.1, rule 2): the course is spread to the wall's end.
    const shifts = spreadShifts(course, lambda - run);
    course.forEach(({ size, span, position }, i) => {
      const at = position + shifts[i];
      units.push(makeUnit({ course: r, index: i + 1, size, n, position: at, span, x: at, y: 0, bearing: 0 }));
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
// The robot split: an arc under cutBelow is laid in cut blocks (part 4.3);
// with cutBelow 0, as the tests' exact arcs are, every number is as before.
export function layOnLine(line, { courses, rotation = false, depthMm = BLOCK.depth, cutBelow = 0 }) {
  if (line.runs && line.runs.length > 1) return layRuns(line, { courses, rotation, depthMm, cutBelow });
  const arcs = cutArcs(line, cutBelow);
  const cutReach = reaches(false, depthMm);
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
        const turn = line.pointAt(position).bearing - previous.face;
        const reach = turn >= 0 ? reachLeft : reachRight;
        position = previous.position + (previous.span + span) / 2 + reach * Math.abs(turn);
      }
    }
    let unit = { size, span, position };
    // On an arc of the robot the unit is cut to the line instead, if its cut span still touches the arc.
    const arc = arcs.length ? arcOver(arcs, position - span / 2, position + span / 2) : null;
    if (arc) {
      const cut = cutNext(line.pointAt, previous, size, 0, { left: reachLeft, right: reachRight }, cutReach, arc, 1);
      if (arcOver([arc], cut.position - cut.span / 2, cut.position + cut.span / 2)) unit = cut;
    }
    if (unit.position + unit.span / 2 > lambda + EPS) return null;
    return unit;
  }

  const units = [];
  for (let r = 0; r <= n + 1; r++) {
    let previous = null;
    let size = r % 2 === 1 ? 'full' : 'half';
    const course = [];
    for (;;) {
      let next = fit(previous, size);
      if (!next && size === 'full') next = fit(previous, 'half');
      if (!next) break;
      course.push(next);
      if (next.size === 'half' && course.length > 1) break;
      const bearing = line.pointAt(next.position).bearing;
      // The bearing the unit's far end is square to: its own, or the line's there when it is cut.
      const face = next.arc ? line.pointAt(next.position + next.span / 2).bearing : bearing;
      previous = { position: next.position, span: next.span, bearing, face, arc: next.arc || null };
      size = 'full';
    }
    // Pass 5 (part 13.1, rule 2): the course is spread to the line's end.
    const shifts = spreadShifts(course, lambda - (course.length ? course.at(-1).position + course.at(-1).span / 2 : 0));
    course.forEach((u, i) => {
      const position = u.position + shifts[i];
      const point = line.pointAt(position);
      const cut = u.arc ? { ...arcCut(line.pointAt, position, u.span), at: { kind: 'arc', point: u.arc.point, radius: u.arc.radius } } : null;
      units.push(makeUnit({
        course: r, index: i + 1, size: u.size, n, position, span: u.span,
        x: point.x, y: point.y, bearing: point.bearing, plain: Boolean(cut), cut,
      }));
    });
  }
  return { lambda, p, h, m, n, height: wallHeight(n), units };
}

// Pass 5 (part 13.1, rule 2). The wall fills its line: what is left over at
// a free end is spread across the course's joints, each under the widest
// gap, the first unit kept where it is. Where it cannot be, it stays at the
// free end. Returns each unit's shift along the line, away from the first.
// The robot split: a cut block keeps the place it was cut for. The joints
// up to the last cut block on an arc take none of it, so those blocks stay
// where their faces were solved and their shared faces stay closed; nor
// does the joint after a cut corner unit, so the corner stays tight.
export function spreadShifts(course, left) {
  const joints = course.length - 1;
  let lastArc = -1;
  course.forEach((u, i) => { if (u.arc) lastArc = i; });
  const open = course.map((u, i) => i > 0 && i > lastArc && !(i === 1 && course[0].cutCorner));
  const free = open.filter(Boolean).length;
  if (free === joints) {
    if (joints < 1 || !(left > EPS) || left / joints > MAX_GAP + EPS) return course.map(() => 0);
    return course.map((_, i) => (left * i) / joints);
  }
  if (free < 1 || !(left > EPS) || left / free > MAX_GAP + EPS) return course.map(() => 0);
  let shift = 0;
  return course.map((_, i) => {
    if (open[i]) shift += left / free;
    return shift;
  });
}

// Pass 3 (part 11.3). The reach of a unit on either side of the line, for
// the spacing on a bend: back faces are in line, so a deeper unit reaches
// further to the front (the left) than to the back; a turned block reaches
// further on both sides.
export function reaches(rotation, depthMm) {
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

// The centre of a unit of span after the previous one, from a, along a run:
// on a bend the spacing grows with the turn, as in layOnLine.
function nextCentre(run, a, previous, span, reach) {
  let t = previous ? previous.t + (previous.span + span) / 2 : a + span / 2;
  if (previous) {
    for (let k = 0; k < 4; k++) {
      const turn = runPoint(run, t).bearing - previous.bearing;
      const extra = (turn >= 0 ? reach.left : reach.right) * Math.abs(turn);
      t = previous.t + (previous.span + span) / 2 + extra;
    }
  }
  return t;
}

// Pass 4 (part 12.1, rule 2). One course of a run between two sharp
// corners, from a to b: a full corner unit, plain; inner units of span p; a
// closing corner unit, full or half, plain. What is left over is spread
// across the joints, each under the widest gap; null when it cannot be.
// The robot split (part 4): at a corner that is not square the corner
// units are cut blocks, their spans the unit's less what the cut takes
// (start and end, { full, half }, half null where a half may not be cut);
// at a mitre the first unit's size alternates (firstSize); an inner unit
// on an arc of the robot is cut to the line.
const WHOLE_CORNER = Object.freeze({ full: BLOCK.length, half: HALF_LENGTH });
export function layBetween(run, a, b, { p, reach }, { start = WHOLE_CORNER, end = WHOLE_CORNER, firstSize, arcs = [], cutReach } = {}) {
  const units = [];
  const pointAt = (t) => runPoint(run, t);
  const add = (size, span, corner) => {
    const previous = units.at(-1);
    const face = previous ? runPoint(run, previous.arc ? previous.t + previous.span / 2 : previous.t).bearing : 0;
    const t = nextCentre(run, a, previous ? { t: previous.t, span: previous.span, bearing: face } : null, span, reach);
    const arc = !corner && arcs.length ? arcOver(arcs, t - span / 2, t + span / 2) : null;
    if (arc) {
      const cut = cutNext(pointAt, previous ? { position: previous.t, span: previous.span, face, arc: previous.arc } : null, size, a, reach, cutReach, arc, 1);
      if (arcOver([arc], cut.position - cut.span / 2, cut.position + cut.span / 2)) return { size, span: cut.span, t: cut.position, corner, arc };
    }
    return { size, span, t, corner, arc: null };
  };
  const fits = (u) => u.t + u.span / 2 <= b + EPS;
  const tryFirst = (size) => {
    const span = size === 'full' ? start.full : start.half;
    if (span === null) return null;
    const u = add(size, span, true);
    return fits(u) ? u : null;
  };
  const first = firstSize === 'half' ? tryFirst('half') || tryFirst('full') : tryFirst('full') || tryFirst('half');
  if (!first) return null;
  first.at = 'start';
  if (start !== WHOLE_CORNER) first.cutCorner = true;
  units.push(first);
  const least = end.half !== null ? ['half', end.half] : ['full', end.full];
  for (;;) {
    const inner = add('full', p, false);
    units.push(inner);
    const close = add(least[0], least[1], true);
    units.pop();
    if (!fits(close)) break;
    units.push(inner);
  }
  const fullClose = add('full', end.full, true);
  const halfClose = end.half !== null ? add('half', end.half, true) : null;
  if (fits(fullClose)) units.push({ ...fullClose, at: 'end' });
  else if (halfClose && fits(halfClose)) units.push({ ...halfClose, at: 'end' });
  const last = units.at(-1);
  let left = b - (last.t + last.span / 2);
  // At a cut corner the robot cuts the closing unit to the length the run
  // needs, up to a full unit's: what is left over goes into it first.
  if (end !== WHOLE_CORNER && last.at === 'end' && left > EPS && last.span < end.full - EPS) {
    const grow = Math.min(left, end.full - last.span);
    last.span += grow;
    last.t += grow / 2;
    if (end.half === null || last.span > end.half + EPS) last.size = 'full';
    left -= grow;
  }
  const joints = units.length - 1;
  if (left < -EPS) return null;
  if (joints === 0) {
    if (left > MAX_GAP + EPS) return null;
    units[0].t += left / 2;
  } else {
    const shifts = spreadShifts(units, left);
    if (left > EPS && shifts.at(-1) === 0) return null;
    units.forEach((u, i) => { u.t += shifts[i]; });
  }
  return units.map((u) => {
    const point = runPoint(run, u.t);
    return {
      size: u.size, span: u.span, position: run.start + u.t, x: point.x, y: point.y, bearing: point.bearing, corner: u.corner,
      ...(u.corner && u.at ? { cornerAt: u.at } : {}), ...(u.arc ? { arc: u.arc } : {}),
    };
  });
}

// One course of one run, between a and b: full units from the chosen end,
// a half unit at the far end where one fits; on a bend the spacing grows
// with the turn, as in layOnLine. Laid from a corner, the first unit is a
// corner unit: plain, of the plain span (pass 4).
// The robot split: the corner unit's spans (cornerSpan), the first unit's
// size at a mitre (firstSize), and the arcs of the robot, as layBetween.
function layRun(run, a, b, backward, { p, h, reach }, fromCorner = false, { cornerSpan = WHOLE_CORNER, firstSize, arcs = [], cutReach } = {}) {
  const out = [];
  let previous = null;
  let size = fromCorner && firstSize === 'half' && cornerSpan.half !== null ? 'half' : 'full';
  const sign = backward ? -1 : 1;
  const pointAt = (t) => runPoint(run, t);
  const fit = (span, unitSize, corner) => {
    if (span === null) return null;
    const start = backward ? b - span / 2 : a + span / 2;
    let t = previous ? previous.t + sign * (previous.span + span) / 2 : start;
    if (previous) {
      for (let k = 0; k < 4; k++) {
        const turn = sign * (runPoint(run, t).bearing - previous.face);
        const extra = (turn >= 0 ? reach.left : reach.right) * Math.abs(turn);
        t = previous.t + sign * ((previous.span + span) / 2 + extra);
      }
    }
    let unit = { t, span, arc: null };
    const arc = !corner && arcs.length ? arcOver(arcs, t - span / 2, t + span / 2) : null;
    if (arc && previous) {
      const cut = cutNext(pointAt, { position: previous.t, span: previous.span, face: previous.face, arc: previous.arc }, unitSize, backward ? b : a, reach, cutReach, arc, sign);
      if (arcOver([arc], cut.position - cut.span / 2, cut.position + cut.span / 2)) unit = { t: cut.position, span: cut.span, arc };
    }
    const inside = backward ? unit.t - unit.span / 2 >= a - EPS : unit.t + unit.span / 2 <= b + EPS;
    return inside ? unit : null;
  };
  for (;;) {
    const corner = fromCorner && !previous;
    let span = size === 'full' ? (corner ? cornerSpan.full : p) : (corner ? cornerSpan.half : h);
    let unit = fit(span, size, corner);
    if (unit === null && size === 'full') {
      size = 'half';
      span = corner ? cornerSpan.half : h;
      unit = fit(span, size, corner);
    }
    if (unit === null) break;
    const { t } = unit;
    const point = runPoint(run, t);
    out.push({
      size, span: unit.span, position: run.start + t, x: point.x, y: point.y, bearing: point.bearing, corner,
      ...(corner ? { cornerAt: backward ? 'end' : 'start' } : {}), ...(unit.arc ? { arc: unit.arc } : {}),
      ...(corner && cornerSpan !== WHOLE_CORNER ? { cutCorner: true } : {}),
    });
    if (size === 'half' && out.length > 1) break;
    const face = unit.arc ? runPoint(run, t + (sign * unit.span) / 2).bearing : point.bearing;
    previous = { t, span: unit.span, bearing: point.bearing, face, arc: unit.arc };
    size = 'full';
  }
  return out;
}

// Pass 5 (part 13.1, rule 2). A run laid from a corner to a free end, or
// back from one, is spread to that end; its corner unit stays.
function fillToEnd(run, laid, a, b, backward) {
  if (!laid.length) return laid;
  const last = laid.at(-1);
  const t = last.position - run.start;
  const shifts = spreadShifts(laid, backward ? t - last.span / 2 - a : b - (t + last.span / 2));
  const sign = backward ? -1 : 1;
  return laid.map((u, j) => {
    if (!shifts[j]) return u;
    const at = u.position - run.start + sign * shifts[j];
    const point = runPoint(run, at);
    return { ...u, position: run.start + at, x: point.x, y: point.y, bearing: point.bearing };
  });
}

// The courses of a line with sharp corners, run by run (part 11.3). A run
// that starts at a corner is laid from it; one that only ends at a corner
// is laid from that end; what is left over falls at a free end. At the
// k-th corner the leg before it runs through in course r when r + k is odd.
export function layRuns(line, { courses, rotation = false, depthMm = BLOCK.depth, cutBelow = 0 }) {
  const { p, h } = pitchOf({ rotation });
  const reach = reaches(rotation, depthMm);
  const cutReach = reaches(false, depthMm);
  const n = courses;
  const limit = Math.min(line.length, MAX_LENGTH);
  const runs = line.runs.filter((run) => run.start < limit - EPS).map((run) => {
    const cut = run.start + run.length > limit + EPS;
    return cut ? { ...run, length: limit - run.start, endCorner: 0 } : run;
  });
  // The robot split (part 4.1 and 4.2): each sharp corner's kind. A square
  // one reaches HALF_JOINT, exactly as before; a lap reaches e; a mitre
  // meets on the corner, its first units alternating full and half.
  const sharp = (line.corners || []).filter((c) => c.kind === 'sharp');
  const kinds = sharp.map((c) => cornerKind(c.turn));
  const kindOf = (k) => (k ? kinds[k - 1] : null);
  const offset = (r, k) => {
    const kind = kindOf(k);
    const reachOf = !kind || kind.kind === 'square' ? HALF_JOINT : kind.e;
    return ((r + k) % 2 === 1) ? reachOf : -reachOf;
  };
  const ends = (run, r) => [run.startCorner ? offset(r, run.startCorner) : 0, run.length + (run.endCorner ? offset(r, run.endCorner) : 0)];
  const spansAt = (k) => {
    const kind = kindOf(k);
    if (!kind || kind.kind === 'square') return WHOLE_CORNER;
    return { full: BLOCK.length - kind.c, half: kind.half ? HALF_LENGTH - kind.c : null };
  };
  const firstAt = (r, k) => {
    const kind = kindOf(k);
    if (!kind || kind.kind !== 'mitre') return undefined;
    return (r + k) % 2 === 1 ? 'full' : 'half';
  };
  // The arcs of the robot that touch a run, along it.
  const arcs = cutArcs(line, cutBelow);
  const arcsOf = (run) => arcs
    .filter((arc) => arc.to > run.start + EPS && arc.from < run.start + run.length - EPS)
    .map((arc) => ({ ...arc, from: arc.from - run.start, to: arc.to - run.start }));
  // Pass 4 (part 12.1, rule 2). A run between two corners: turned units
  // where every course spreads what is left over under the widest gap;
  // else plain units, which a leg of whole half blocks fills; else the
  // stretch is refused, and laid plain as far as it goes.
  const plainRoom = { p: BLOCK.length, h: HALF_LENGTH, reach: reaches(false, depthMm) };
  const between = new Map();
  const refused = [];
  for (const run of runs) {
    if (!run.startCorner || !run.endCorner) continue;
    const options = (r) => ({ start: spansAt(run.startCorner), end: spansAt(run.endCorner), firstSize: firstAt(r, run.startCorner), arcs: arcsOf(run), cutReach });
    const tryAll = (room) => {
      const courses = [];
      for (let r = 0; r <= n + 1; r++) {
        const [a, b] = ends(run, r);
        const laid = layBetween(run, a, b, room, options(r));
        if (!laid) return null;
        courses.push(laid);
      }
      return courses;
    };
    let laid = tryAll({ p, h, reach });
    let plain = false;
    if (!laid && p > BLOCK.length + EPS) {
      laid = tryAll(plainRoom);
      plain = true;
    }
    if (!laid) {
      refused.push({ from: run.start, to: run.start + run.length });
      laid = Array.from({ length: n + 2 }, (_, r) => layRun(run, ...ends(run, r), false, plainRoom, true, {
        cornerSpan: spansAt(run.startCorner), firstSize: firstAt(r, run.startCorner), arcs: arcsOf(run), cutReach,
      }));
      plain = true;
    }
    between.set(run, { laid, plain });
  }
  // A unit's cut, at a corner that is not square or on an arc of the robot.
  const cutOf = (run, u) => {
    if (u.arc) {
      const at = { kind: 'arc', point: u.arc.point, radius: u.arc.radius };
      return { ...arcCut((s) => runPoint(run, s - run.start), u.position, u.span), at };
    }
    if (!u.corner || !u.cornerAt) return null;
    const k = u.cornerAt === 'start' ? run.startCorner : run.endCorner;
    const kind = kindOf(k);
    if (!kind || kind.kind === 'square') return null;
    const c = sharp[k - 1];
    return {
      xs: -u.span / 2, ks: u.cornerAt === 'start' ? kind.kStart : 0,
      xe: u.span / 2, ke: u.cornerAt === 'end' ? kind.kEnd : 0,
      at: { kind: 'corner', point: c.index + 1, degrees: legAngle(c.turn) },
    };
  };
  const units = [];
  let lambda = 0;
  for (let r = 0; r <= n + 1; r++) {
    const course = [];
    for (const run of runs) {
      const both = between.get(run);
      if (both) {
        course.push(...both.laid[r].map((u) => ({ ...u, plain: both.plain, cut: cutOf(run, u) })));
        continue;
      }
      const [a, b] = ends(run, r);
      const backward = !run.startCorner && Boolean(run.endCorner);
      const k = backward ? run.endCorner : run.startCorner;
      const laid = layRun(run, a, b, backward, { p, h, reach }, true, { cornerSpan: spansAt(k), firstSize: firstAt(r, k), arcs: arcsOf(run), cutReach });
      course.push(...fillToEnd(run, laid, a, b, backward).map((u) => ({ ...u, cut: cutOf(run, u) })));
    }
    course.sort((u, v) => u.position - v.position);
    course.forEach((u, i) => {
      units.push(makeUnit({
        course: r, index: i + 1, size: u.size, n, position: u.position, span: u.span, x: u.x, y: u.y, bearing: u.bearing,
        corner: Boolean(u.corner), plain: Boolean(u.plain) || Boolean(u.cut), cut: u.cut,
      }));
      lambda = Math.max(lambda, u.position + u.span / 2);
    });
  }
  lambda = Math.min(lambda, limit);
  return { lambda, p, h, m: halfSlots(lambda, h), n, height: wallHeight(n), units, refused };
}
