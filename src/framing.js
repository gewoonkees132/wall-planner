// The preset cameras and how they frame the wall (design, part 8,
// "Cameras"; pass 6, part 14.1 of the Aicher note: every view shows the
// whole wall). Pure: no browser objects, so the tests can project points.
// Scene coordinates: x along the plan's x axis, y up, z = -(plan y).

import { EYE_HEIGHT, PERSON_HEIGHT, MAX_LENGTH } from './block.js';
import { footprint } from './cut.js';

// Each view's own distance, in m, on the ground from the eye to the middle
// of the wall's length, as the design has it. A view stands farther back,
// by whole metres, where the whole wall and the person need it (pass 6,
// rules 1 and 2).
export const VIEW_DISTANCE = Object.freeze({ close: 1, garden: 4, street: 10 });
// The field across, in degrees: the design's 60 for Garden and Street,
// and the widest for Close, so that it stands nearest (pass 6, rule 3).
// Placeholders.
export const MIN_HORIZONTAL_FOV = 60;
export const MAX_HORIZONTAL_FOV = 76;
export const VIEW_FOV = Object.freeze({ close: MAX_HORIZONTAL_FOV, garden: MIN_HORIZONTAL_FOV, street: MIN_HORIZONTAL_FOV });
// A wide canvas still shows the person whole, head and feet. Placeholder.
export const MIN_VERTICAL_FOV = 40; // degrees
// The wall and the person fit inside this share of the frame, from its
// middle to each edge. Placeholder.
export const FRAME_FILL = 0.9;
// No view stands farther back than this, in m: room for the longest line
// (block.js) seen whole. Placeholder.
export const FARTHEST = 4 * MAX_LENGTH;
// The person's figure, 1.75 m tall (block.js), fits in a box this wide
// with its arms and this deep, in m. Placeholders.
export const PERSON_BOX = Object.freeze({ halfWidth: 0.25, halfDepth: 0.12 });
// The person's middle stands this far beyond the wall's outline, beside
// its start end (pass 6, rule 4), in m. Placeholder.
export const PERSON_BESIDE = 0.6;
// Up to this many degrees down or up the camera looks level and the frame
// shifts instead, so verticals stay vertical; at LEVEL_UNTIL + LEVEL_BLEND
// and beyond it simply turns. Placeholders.
const LEVEL_UNTIL = 25;
const LEVEL_BLEND = 30;

const RAD = Math.PI / 180;

// Plan (x, y) and a height z to the scene.
export const toScene = (x, y, z) => [x, z, -y];

// The convex hull of points in plan, counter-clockwise.
export function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half(p.reverse())];
}

// Pass 6, rule 1. The wall's outline in plan: the hull of the corners of
// every unit of the plan file, turned as it is laid.
export function outline(units) {
  const corners = [];
  for (const u of units) {
    // The robot split: a cut block's own corners.
    if (u.cut) {
      corners.push(...footprint(u));
      continue;
    }
    const a = u.bearing + (u.rotationDeg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const l = u.length / 2;
    const d = u.depthMm / 2000;
    for (const [i, j] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      corners.push([u.cx + c * l * i - s * d * j, u.cy + s * l * i + c * d * j]);
    }
  }
  return hull(corners);
}

// The eye's two directions in plan: across, to the right as the eye sees
// the front, and toward the eye. Seen from the front the start end is on
// the right (open decision 21, reading d).
function axes(normal) {
  const [nx, ny] = normal;
  return { right: [-ny, nx], toEye: [nx, ny] };
}

// Pass 6, rule 4. Where the person stands, in plan: beyond the outline on
// the start end's side, its middle PERSON_BESIDE from the outermost part
// of the wall, level with the wall's nearest face at that end.
export function personPlace(points, normal) {
  const { right, toEye } = axes(normal);
  const across = (p) => p[0] * right[0] + p[1] * right[1];
  const ahead = (p) => p[0] * toEye[0] + p[1] * toEye[1];
  const outer = Math.max(...points.map(across));
  let face = -Infinity;
  for (const p of points) if (across(p) >= outer - PERSON_BESIDE) face = Math.max(face, ahead(p));
  const a = outer + PERSON_BESIDE;
  return [a * right[0] + face * toEye[0], a * right[1] + face * toEye[1]];
}

// The corners of the box the person's figure fits in, shoulders along the
// line between the wall's ends, in the scene.
export function personCorners(frame) {
  const [px, py] = frame.person;
  const [tx, ty] = frame.tangent;
  const [nx, ny] = frame.normal;
  const { halfWidth, halfDepth } = PERSON_BOX;
  const corners = [];
  for (const a of [-halfWidth, halfWidth]) {
    for (const b of [-halfDepth, halfDepth]) {
      for (const z of [0, PERSON_HEIGHT]) corners.push(toScene(px + tx * a + nx * b, py + ty * a + ny * b, z));
    }
  }
  return corners;
}

// How a camera at eye looks at target. Seen from a little above, it looks
// level and the frame shifts down, as a shift lens does, so the target
// stays in the middle and verticals stay vertical. Seen from steeply above
// it turns down, with a smooth change between.
export function levelling(eye, target) {
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  const dz = target[2] - eye[2];
  const yaw = Math.atan2(-dx, -dz);
  const elevation = Math.atan2(dy, Math.hypot(dx, dz));
  const t = Math.min(1, Math.max(0, (Math.abs(elevation) / RAD - LEVEL_UNTIL) / LEVEL_BLEND));
  const level = 1 - t * t * (3 - 2 * t);
  const pitch = level === 1 ? 0 : elevation * (1 - level);
  return { yaw, pitch, shift: Math.tan(elevation - pitch) };
}

// The vertical field of view, in degrees, of a canvas of this aspect.
export function verticalFov(aspect, across = MIN_HORIZONTAL_FOV) {
  const v = (2 * Math.atan(Math.tan((across * RAD) / 2) / aspect)) / RAD;
  return Math.max(MIN_VERTICAL_FOV, v);
}

// Pass 6, rules 1 to 3 and 6. A view's camera on a canvas of this aspect:
// on the front side, square to the line between the wall's ends, at the
// view's own distance from the middle of the wall's length or the nearest whole
// metre beyond it from which the outline, foot to cap, and the person fit
// inside FRAME_FILL of the frame; looking at the middle of the wall and
// the person across, at the wall's middle height.
export function viewCamera(frame, view, aspect) {
  const least = VIEW_DISTANCE[view] ?? VIEW_DISTANCE.garden;
  const across = VIEW_FOV[view] ?? MIN_HORIZONTAL_FOV;
  const fov = verticalFov(aspect, across);
  const { right, toEye } = axes(frame.normal);
  const at = (a, b, z) => toScene(a * right[0] + b * toEye[0], a * right[1] + b * toEye[1], z);
  const wall = frame.outline.map((p) => [p[0] * right[0] + p[1] * right[1], p[0] * toEye[0] + p[1] * toEye[1]]);
  const standing = frame.person[0] * right[0] + frame.person[1] * right[1];
  const lo = Math.min(...wall.map((p) => p[0]), standing - PERSON_BOX.halfWidth);
  const hi = Math.max(...wall.map((p) => p[0]), standing + PERSON_BOX.halfWidth);
  const near = Math.max(...wall.map((p) => p[1]));
  const far = Math.min(...wall.map((p) => p[1]));
  const middle = (lo + hi) / 2;
  const target = at(middle, (near + far) / 2, frame.height / 2);
  const points = personCorners(frame);
  for (const [a, b] of wall) points.push(at(a, b, 0), at(a, b, frame.height));
  const from = frame.middle[0] * toEye[0] + frame.middle[1] * toEye[1];
  const eyeAt = (distance) => at(middle, from + distance, EYE_HEIGHT);
  const fits = (eye) => {
    const { yaw, pitch, shift } = levelling(eye, target);
    return points.every((p) => {
      const [x, y, ahead] = project(p, { eye, yaw, pitch, shift, fov, aspect });
      return ahead > 0 && Math.abs(x) <= FRAME_FILL && Math.abs(y) <= FRAME_FILL;
    });
  };
  // The nearest whole metre that fits: double the step back until one does,
  // then halve the gap, so a long wall takes a few tries, not one a metre.
  let distance = least;
  if (!fits(eyeAt(least))) {
    let low = least;
    let high = least + 1;
    while (high < FARTHEST && !fits(eyeAt(high))) {
      low = high;
      high = least + 2 * (high - least);
    }
    high = Math.min(high, FARTHEST);
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (fits(eyeAt(mid))) high = mid;
      else low = mid;
    }
    distance = high;
  }
  return { eye: eyeAt(distance), target, distance, across };
}

// Where a scene point lands on the canvas: x and y from -1 to 1, x to the
// right and y up, for a camera turned by yaw and pitch whose frame is
// shifted by shift (in the tangent of the angle up from its axis); and how
// far ahead of the eye it lies.
export function project(point, { eye, yaw, pitch, shift = 0, fov, aspect }) {
  const dx = point[0] - eye[0];
  const dy = point[1] - eye[1];
  const dz = point[2] - eye[2];
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = cy * dx - sy * dz;
  const z1 = sy * dx + cy * dz;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = cp * dy + sp * z1;
  const z2 = -sp * dy + cp * z1;
  const half = Math.tan((fov * RAD) / 2);
  return [x1 / -z2 / (half * aspect), (y2 / -z2 - shift) / half, -z2];
}
