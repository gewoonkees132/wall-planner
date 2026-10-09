// Cut blocks (the robot split, docs/specs/configurator-demonstrator-robot-
// split.md, part 4): "an earth block the robot cuts to an angle, for a
// corner that is not square or a curve tighter than people stack". A cut
// block is cut from one whole unit and keeps that unit's length on its
// longer face. Pure: no browser objects.
//
// A unit's ends, in the frame of its point on the line (x along its
// bearing, y to its left, the front): an end is the line x = X + k y. A
// whole unit has square ends at -length / 2 and length / 2 round its own
// centre; a cut unit carries cut = { xs, ks, xe, ke, at }.

import { BLOCK, HALF_LENGTH, MIN_CUT_FACE } from './block.js';
import { SQUARE_TOLERANCE } from './fillet.js';

const DEG = 180 / Math.PI;
// The corner bond's reach, half the wall's depth with its joint: bond.js's HALF_JOINT.
const JOINT = HALF_LENGTH / 2;
// The corner units keep the base depth (pass 4), so a corner is this thick.
const THICK = BLOCK.depth / 1000;

// A sharp corner of this turn (radians, left positive), laid as part 4 says:
// square, from whole blocks; a lap, the legs swapping course by course, the
// through leg reaching e past the corner and cut along the other leg's
// face; or, where a lap would need a cut longer than a unit, a mitre.
// kEnd cuts the last unit of the leg before, kStart the first of the leg
// after; c is what a cut takes off a unit's span along the line; half says
// whether a half unit may be cut there; degrees is the cut's lean from square.
export function cornerKind(turn) {
  const phi = Math.abs(turn);
  if (Math.abs(phi * DEG - 90) <= SQUARE_TOLERANCE) {
    return { kind: 'square', e: JOINT, kEnd: 0, kStart: 0, c: 0, half: true, degrees: 0 };
  }
  const cot = Math.cos(turn) / Math.sin(turn);
  const lap = (THICK / 2) * Math.abs(cot);
  if (BLOCK.length - 2 * lap >= MIN_CUT_FACE - 1e-12) {
    return {
      kind: 'lap', e: JOINT / Math.sin(phi), kEnd: cot, kStart: -cot, c: lap,
      half: HALF_LENGTH - 2 * lap >= MIN_CUT_FACE - 1e-12, degrees: Math.atan(Math.abs(cot)) * DEG,
    };
  }
  const tan = Math.tan(turn / 2);
  const mitre = (THICK / 2) * Math.abs(tan);
  return {
    kind: 'mitre', e: 0, kEnd: -tan, kStart: tan, c: mitre,
    half: HALF_LENGTH - 2 * mitre >= MIN_CUT_FACE - 1e-12, degrees: (phi / 2) * DEG,
  };
}

// The angle between a corner's two legs, in whole degrees: 90 at a square corner.
export const legAngle = (turn) => Math.round(180 - Math.abs(turn) * DEG);

// The end face of a unit centred at line position sc, where it meets the
// plane square to the line at s: { x, k } in the unit's frame.
export function faceAt(pointAt, sc, s) {
  const c = pointAt(sc);
  const p = pointAt(s);
  const ux = Math.cos(c.bearing);
  const uy = Math.sin(c.bearing);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const px = dx * ux + dy * uy;
  const py = -dx * uy + dy * ux;
  const t = Math.tan(p.bearing - c.bearing);
  return { x: px + py * t, k: -t };
}

// The two faces of a unit, at the back (y = -right) and at the front (y = left).
export function faceLengths({ xs, ks, xe, ke }, { left, right }) {
  return [-right, left].map((y) => (xe + ke * y) - (xs + ks * y));
}

// A unit cut to the line from s0, one way (dir 1) or the other (-1): the
// span along the line whose longer face is the unit's length. Its ends lie
// in the planes square to the line, radial on an arc.
export function cutSpan(pointAt, s0, length, reach, dir = 1) {
  let span = length;
  for (let i = 0; i < 8; i++) {
    const s1 = s0 + dir * span;
    const sc = (s0 + s1) / 2;
    const a = faceAt(pointAt, sc, Math.min(s0, s1));
    const b = faceAt(pointAt, sc, Math.max(s0, s1));
    const longest = Math.max(...faceLengths({ xs: a.x, ks: a.k, xe: b.x, ke: b.k }, reach));
    if (!(longest > 1e-9)) break;
    span *= length / longest;
  }
  return span;
}

// The faces of a cut unit on an arc, from its final place on the line.
export function arcCut(pointAt, position, span) {
  const a = faceAt(pointAt, position, position - span / 2);
  const b = faceAt(pointAt, position, position + span / 2);
  return { xs: a.x, ks: a.k, xe: b.x, ke: b.k };
}

// The polygon of any unit in plan, counter-clockwise: back start, back
// end, front end, front start. Back faces are in line, so a deeper unit
// reaches further to the front.
export function footprint(u) {
  if (u.cut) {
    const right = BLOCK.depth / 2000;
    const left = u.depthMm / 1000 - right;
    const c = Math.cos(u.bearing);
    const s = Math.sin(u.bearing);
    const { xs, ks, xe, ke } = u.cut;
    return [[xs - ks * right, -right], [xe - ke * right, -right], [xe + ke * left, left], [xs + ks * left, left]]
      .map(([x, y]) => [u.x + c * x - s * y, u.y + s * x + c * y]);
  }
  const a = u.bearing + ((u.rotationDeg || 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const l = u.length / 2;
  const d = u.depthMm / 2000;
  const cx = u.cx ?? u.x;
  const cy = u.cy ?? u.y;
  return [[-l, -d], [l, -d], [l, d], [-l, d]].map(([x, y]) => [cx + c * x - s * y, cy + s * x + c * y]);
}

// A cut unit's lean from square, in degrees, the larger of its two ends; null for a whole unit.
export function cutDegrees(u) {
  if (!u.cut) return null;
  return Math.max(Math.abs(Math.atan(u.cut.ks)), Math.abs(Math.atan(u.cut.ke))) * DEG;
}
