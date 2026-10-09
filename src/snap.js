// The drawer's snap (pass 3 of the Aicher loop, part 11.4): a dragged
// point is measured from its neighbour toward the start (the first point
// from the next). Its direction snaps to a right angle with the stretch
// beyond that neighbour, or with the drawing's axes at an end, when within
// 8 degrees; its distance snaps to whole half blocks. Pure: no browser objects.
//
// Pass 5 (part 13.1, rule 3): with the drawing's grid, the axes are the
// grid's, the distance snaps to whole steps of the grid shown, and a point
// whose direction snaps to nothing goes to the nearest crossing, never onto
// its neighbour.

import { HALF_LENGTH } from './block.js';
import { crossingsNear } from './grid.js';

export const SNAP_ANGLE = 8; // degrees, placeholder
export const SNAP_STEP = HALF_LENGTH; // m, half a block

export function snapPoint(points, index, [x, y], step = SNAP_STEP, grid = null) {
  const n = points.length;
  const ai = index > 0 ? index - 1 : 1;
  const bi = index > 0 ? index - 2 : 2;
  if (ai < 0 || ai >= n) return [x, y];
  const [ax, ay] = points[ai];
  let reference = grid ? grid.angle : 0;
  if (bi >= 0 && bi < n) {
    const [bx, by] = points[bi];
    if (Math.hypot(ax - bx, ay - by) > 1e-9) reference = Math.atan2(ay - by, ax - bx);
  }
  const distance = Math.hypot(x - ax, y - ay);
  if (distance < 1e-9) return [x, y];
  let direction = Math.atan2(y - ay, x - ax);
  const quarter = Math.PI / 2;
  const relative = direction - reference;
  const nearest = Math.round(relative / quarter) * quarter;
  const square = Math.abs(relative - nearest) <= (SNAP_ANGLE * Math.PI) / 180;
  if (square) direction = reference + nearest;
  if (grid && !square) {
    const landing = crossingsNear(grid, step, [x, y]).find(([cx, cy]) => Math.hypot(cx - ax, cy - ay) > step / 2);
    if (landing) return landing;
  }
  const length = Math.max(step, Math.round(distance / step + 1e-9) * step);
  return [ax + Math.cos(direction) * length, ay + Math.sin(direction) * length];
}
