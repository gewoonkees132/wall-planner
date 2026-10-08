// The computed wall, its plan rows and the CSV text (design, part 5 "The
// plan row" and part 8 "The stacking plan file"). Pure: no browser objects.

import { BLOCK, PERSON_OFFSET, MIN_LENGTH } from './block.js';
import { layOnLine } from './bond.js';
import { baseLine } from './line.js';
import { checkCorners } from './limits.js';
import { mapUnits, deepestDepth } from './mapping.js';
import { fixed, TEXTS } from './texts.js';

export const CSV_HEADER =
  'course,index,unit,type,colour,depth_mm,position_m,x_m,y_m,z_m,orientation_deg,rotation_deg,yaw_deg';

// Back faces are in line: a deeper unit's centre moves toward the front,
// the left of the line, by half its extra depth.
function placeUnit(u) {
  const shift = (u.depthMm - BLOCK.depth) / 2000;
  return { ...u, cx: u.x - Math.sin(u.bearing) * shift, cy: u.y + Math.cos(u.bearing) * shift };
}

export function finishWall(layout, state, extra = {}) {
  const mapped = mapUnits(layout, state);
  return {
    ok: true,
    lambda: layout.lambda,
    n: layout.n,
    p: layout.p,
    h: layout.h,
    height: layout.height,
    units: mapped.units.map(placeUnit),
    notice: mapped.notice,
    deepest: mapped.deepest,
    ...extra,
  };
}

// Where the wall stands in plan: its two ends, its middle along the line,
// and its front, the left of the line from the start (design, part 4).
export function straightFrame(lambda, height) {
  return {
    start: [0, 0],
    end: [lambda, 0],
    middle: [lambda / 2, 0],
    tangent: [1, 0],
    normal: [0, 1],
    person: [0, PERSON_OFFSET],
    height,
    span: lambda,
  };
}

// The frame of a wall on a drawn line. The cameras stand square to the
// line between its two ends, on the front side.
function lineFrame(line, lambda, height) {
  const a = line.pointAt(0);
  const b = line.pointAt(lambda);
  const middle = line.pointAt(lambda / 2);
  let tx = b.x - a.x;
  let ty = b.y - a.y;
  let chord = Math.hypot(tx, ty);
  if (chord < 0.1) {
    tx = Math.cos(middle.bearing);
    ty = Math.sin(middle.bearing);
    chord = 1;
  }
  tx /= chord;
  ty /= chord;
  const startNormal = [-Math.sin(a.bearing), Math.cos(a.bearing)];
  return {
    start: [a.x, a.y],
    end: [b.x, b.y],
    middle: [middle.x, middle.y],
    tangent: [tx, ty],
    normal: [-ty, tx],
    person: [a.x + startNormal[0] * PERSON_OFFSET, a.y + startNormal[1] * PERSON_OFFSET],
    height,
    span: lambda,
  };
}

// The wall of a state: its units with type, colour, depth and pose. The
// wall follows the drawn base line, its stretches, arcs and corners; a
// line too short, an arc too tight or a sharp corner not square gives a
// wall that does not fit (ok false).
export function computeWall(state) {
  const rotation = state.vary === 'rotation';
  const line = baseLine(state.points, state.corners || []);
  if (line.length < MIN_LENGTH - 1e-9) {
    return { ok: false, tooShort: true, message: TEXTS.wall.outOfRange, line, units: [], bends: null };
  }
  const depthMm = deepestDepth(state);
  const layout = layOnLine(line, { courses: state.courses, rotation, depthMm });
  const bends = checkCorners(line, { depthMm, room: layout.p });
  return finishWall(layout, state, {
    line, frame: lineFrame(line, layout.lambda, layout.height), bends, ok: bends.ok, message: bends.message,
  });
}

const degrees = (radians) => (radians * 180) / Math.PI;

function bearingDegrees(radians) {
  const d = ((((degrees(radians) + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
}

// One row per unit: course by course from the base course up, each course
// from the start end.
export function planRows(wall) {
  return wall.units.map((u) => {
    const orientation = bearingDegrees(u.bearing);
    return {
      course: u.course,
      index: u.index,
      unit: u.size,
      type: u.kind === 'earth' ? u.letter : u.kind,
      colour: u.colour,
      depth_mm: u.depthMm,
      position_m: u.position,
      x_m: u.cx,
      y_m: u.cy,
      z_m: u.z,
      orientation_deg: orientation,
      rotation_deg: u.rotationDeg,
      yaw_deg: orientation + u.rotationDeg,
    };
  });
}

// Lengths in metres to the millimetre, angles in degrees to one decimal.
export function toCsv(rows) {
  const lines = [CSV_HEADER];
  for (const r of rows) {
    lines.push([
      r.course, r.index, r.unit, r.type, r.colour, r.depth_mm,
      fixed(r.position_m, 3), fixed(r.x_m, 3), fixed(r.y_m, 3), fixed(r.z_m, 3),
      fixed(r.orientation_deg, 1), fixed(r.rotation_deg, 1), fixed(r.yaw_deg, 1),
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((key, i) => {
      const value = cells[i];
      row[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
    });
    return row;
  });
}
