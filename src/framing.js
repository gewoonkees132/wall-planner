// The preset cameras and how they frame the wall (design, part 8,
// "Cameras"). Pure: no browser objects, so the tests can project points.
// Scene coordinates: x along the plan's x axis, y up, z = -(plan y).

import { EYE_HEIGHT, PERSON_HEIGHT } from './block.js';

export const VIEW_DISTANCE = Object.freeze({ close: 1, garden: 4, street: 10 }); // m
// The field across: wide enough that the garden view shows the person 1 m
// in front of the start end whole, and at least 60 degrees (open decision
// 21, reading e). Beyond the widest, a long wall leaves the person out.
// Placeholders, in degrees.
export const MIN_HORIZONTAL_FOV = 60;
export const MAX_HORIZONTAL_FOV = 76;
const SPARE = 1.5; // degrees on each side of the person
// A wide canvas still shows the person whole, head and feet. Placeholder.
export const MIN_VERTICAL_FOV = 40; // degrees
// The person's figure, 1.75 m tall (block.js), fits in a box this wide
// with its arms and this deep, in m. Placeholders.
export const PERSON_BOX = Object.freeze({ halfWidth: 0.25, halfDepth: 0.12 });
// Up to this many degrees down or up the camera looks level and the frame
// shifts instead, so verticals stay vertical; at LEVEL_UNTIL + LEVEL_BLEND
// and beyond it simply turns. Placeholders.
const LEVEL_UNTIL = 25;
const LEVEL_BLEND = 30;

const RAD = Math.PI / 180;

// Plan (x, y) and a height z to the scene.
export const toScene = (x, y, z) => [x, z, -y];

// A preset camera: at eye height on the front side, square to the line
// between the wall's two ends, at its distance, looking at the wall's middle.
export function presetCamera(frame, view) {
  const distance = VIEW_DISTANCE[view] ?? VIEW_DISTANCE.garden;
  const { middle, normal, height } = frame;
  return {
    eye: toScene(middle[0] + normal[0] * distance, middle[1] + normal[1] * distance, EYE_HEIGHT),
    target: toScene(middle[0], middle[1], height / 2),
  };
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

// The field across, in degrees, for a wall's frame: the garden view shows
// the person whole with SPARE degrees to each side.
export function horizontalFov(frame) {
  const { eye, target } = presetCamera(frame, 'garden');
  const { yaw } = levelling(eye, target);
  let widest = 0;
  for (const corner of personCorners(frame)) {
    const dx = corner[0] - eye[0];
    const dz = corner[2] - eye[2];
    const across = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
    const ahead = -(Math.sin(yaw) * dx + Math.cos(yaw) * dz);
    if (ahead > 0) widest = Math.max(widest, Math.abs(Math.atan2(across, ahead)));
  }
  const fov = (2 * widest) / RAD + 2 * SPARE;
  return Math.min(MAX_HORIZONTAL_FOV, Math.max(MIN_HORIZONTAL_FOV, fov));
}

// The vertical field of view, in degrees, of a canvas of this aspect.
export function verticalFov(aspect, across = MIN_HORIZONTAL_FOV) {
  const v = (2 * Math.atan(Math.tan((across * RAD) / 2) / aspect)) / RAD;
  return Math.max(MIN_VERTICAL_FOV, v);
}

// Where a scene point lands on the canvas: x and y from -1 to 1, x to the
// right and y up, for a camera turned by yaw and pitch whose frame is
// shifted by shift (in the tangent of the angle up from its axis).
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
  return [x1 / -z2 / (half * aspect), (y2 / -z2 - shift) / half];
}
