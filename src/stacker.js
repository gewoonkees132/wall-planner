// Who stacks it (revision 1, part 6): computed from the wall after every
// change, never chosen. The bend, the angles and the depths each give a
// score; the largest is the scalar, and the scalar gives one of three
// answers with a reason. Thresholds are placeholders until a bench course
// of turned blocks exists. Pure: no browser objects.

import { SET_ANGLES } from './block.js';
import { tightestBend } from './line.js';
import { minRadius } from './limits.js';
import { deepestDepth } from './mapping.js';

export const STEPS = Object.freeze(['hand', 'template', 'robot']);

const EPS = 1e-9;
const inSet = (angle) => SET_ANGLES.some((a) => Math.abs(a - angle) < EPS);

export function whoStacks(wall, state) {
  const earth = (wall.units || []).filter((u) => u.kind === 'earth');
  // The bend: 0 when straight, 0.3 when at least twice the minimum, 0.6 under.
  let bend = 0;
  if (wall.line) {
    const R = tightestBend(wall.line);
    if (Number.isFinite(R)) {
      const minimum = minRadius(deepestDepth(state), wall.p);
      bend = R >= 2 * minimum ? 0.3 : 0.6;
    }
  }
  // The angles: 0 when no block is turned, 0.5 when all are in the set, 1 otherwise.
  const turned = earth.filter((u) => Math.abs(u.rotationDeg) > EPS);
  let angles = 0;
  if (turned.length) angles = turned.every((u) => inSet(u.rotationDeg)) ? 0.5 : 1;
  // The depths: 0.2 when more than one depth is in use.
  const depths = new Set(earth.map((u) => u.depthMm));
  const depth = depths.size > 1 ? 0.2 : 0;

  const scalar = Math.max(bend, angles, depth);
  const step = scalar < 0.35 ? 0 : scalar < 0.7 ? 1 : 2;
  let reason = 'none';
  if (scalar > 0) {
    if (angles === scalar) reason = angles === 1 ? 'free' : 'set';
    else if (bend === scalar) reason = 'bend';
    else reason = 'depth';
  }
  return { scalar, step, key: STEPS[step], reason, turned: turned.length };
}
