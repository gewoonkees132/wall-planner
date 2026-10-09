// The computed wall, its plan rows and the CSV text (design, part 5 "The
// plan row" and part 8 "The stacking plan file"). Pure: no browser objects.

import { BLOCK, MIN_LENGTH, MAX_LENGTH } from './block.js';
import { hull, outline, personPlace } from './framing.js';
import { layOnLine, pitchOf, wallHeight } from './bond.js';
import { baseLine } from './line.js';
import { checkWall, bendBands } from './limits.js';
import { mapUnits, deepestDepth } from './mapping.js';
import { fixed, TEXTS } from './texts.js';
import { assignWorkers, splitOf } from './stacker.js';
import { cutDegrees } from './cut.js';

// The robot split (2026-10-09) adds the worker and the cut at the end, so a
// reader of the first thirteen columns reads them as before.
export const CSV_HEADER =
  'course,index,unit,type,colour,depth_mm,position_m,x_m,y_m,z_m,orientation_deg,rotation_deg,yaw_deg,by,cut_deg';

// Back faces are in line: a deeper unit's centre moves toward the front,
// the left of the line, by half its extra depth.
function placeUnit(u) {
  const shift = (u.depthMm - BLOCK.depth) / 2000;
  return { ...u, cx: u.x - Math.sin(u.bearing) * shift, cy: u.y + Math.cos(u.bearing) * shift };
}

// Pass 5 (part 13.1, rule 1). The wall's length, as the plan file has it:
// along the line, from the outer end of its first unit to that of its last.
export function wallLength(units) {
  if (!units.length) return 0;
  let from = Infinity;
  let to = -Infinity;
  for (const u of units) {
    from = Math.min(from, u.position - u.span / 2);
    to = Math.max(to, u.position + u.span / 2);
  }
  return to - from;
}

export function finishWall(layout, state, extra = {}) {
  const mapped = mapUnits(layout, state);
  return {
    ok: true,
    length: wallLength(layout.units),
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
// and its front, the left of the line from the start (design, part 4);
// its outline and where the person stands (pass 6, rules 1 and 4).
export function straightFrame(lambda, height) {
  const points = [[0, 0], [lambda, 0]];
  return {
    start: [0, 0],
    end: [lambda, 0],
    middle: [lambda / 2, 0],
    tangent: [1, 0],
    normal: [0, 1],
    outline: points,
    person: personPlace(points, [0, 1]),
    height,
    span: lambda,
  };
}

// The frame of a wall on a drawn line. The cameras stand square to the
// line between its two ends, on the front side. The outline is that of
// the units laid, or of the line where none is.
function lineFrame(line, lambda, height, units) {
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
  const normal = [-ty, tx];
  const steps = 24;
  const points = units.length
    ? outline(units)
    : hull(Array.from({ length: steps + 1 }, (_, i) => line.pointAt((lambda * i) / steps)).map((p) => [p.x, p.y]));
  return {
    start: [a.x, a.y],
    end: [b.x, b.y],
    middle: [middle.x, middle.y],
    tangent: [tx, ty],
    normal,
    outline: points,
    person: personPlace(points, normal),
    height,
    span: lambda,
  };
}

// The wall of a state: its units with type, colour, depth, pose and
// worker. The wall follows the drawn base line, its stretches, arcs and
// corners; a line too short, an arc under the robot's limit, a wall too
// near itself or a stretch no blocks fill gives a wall that does not fit
// (ok false).
export function computeWall(state) {
  const rotation = state.vary === 'rotation';
  const line = baseLine(state.points, state.corners || []);
  if (line.length < MIN_LENGTH - 1e-9) {
    return { ok: false, tooShort: true, message: TEXTS.wall.outOfRange, line, units: [], bends: null };
  }
  const depthMm = deepestDepth(state);
  // The robot split: an arc under the people's limit is laid in cut blocks.
  const bands = bendBands(depthMm, pitchOf({ rotation }).p);
  const layout = layOnLine(line, { courses: state.courses, rotation, depthMm, cutBelow: bands.hand });
  const bends = checkWall(line, layout, { depthMm, rotation });
  const wall = finishWall(layout, state, { line, bends, ok: bends.ok, message: bends.message, bands });
  // The robot split: a worker for every earth unit, and the split along the line.
  assignWorkers(wall, bands);
  wall.split = splitOf(wall);
  wall.frame = lineFrame(line, layout.lambda, layout.height, wall.units);
  return wall;
}

// Pass 4 (part 12.1, rule 4). A link whose line never fitted opens with no
// wall: nothing is stacked, counted or ordered, and the 3D view looks at
// where the drawn line stands.
export function noWall(state, wall) {
  const height = wallHeight(state.courses);
  const { p, h } = pitchOf({ rotation: state.vary === 'rotation' });
  const line = wall.line || null;
  const span = line ? Math.max(0.1, Math.min(line.length, MAX_LENGTH)) : state.length;
  return {
    ok: true, none: true, length: 0, lambda: 0, n: state.courses, p, h, height, units: [], notice: null, deepest: deepestDepth(state),
    line, frame: line ? lineFrame(line, span, height, []) : straightFrame(state.length, height),
  };
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
      // The robot split: the worker of an earth unit, none for the base course
      // and the cap; a cut block's lean from square, the larger of its two ends.
      by: u.kind === 'earth' ? u.by || '' : '',
      cut_deg: cutDegrees(u),
    };
  });
}

// Lengths in metres to the millimetre, angles in degrees to one decimal; an empty cell where nothing is cut.
export function toCsv(rows) {
  const lines = [CSV_HEADER];
  for (const r of rows) {
    lines.push([
      r.course, r.index, r.unit, r.type, r.colour, r.depth_mm,
      fixed(r.position_m, 3), fixed(r.x_m, 3), fixed(r.y_m, 3), fixed(r.z_m, 3),
      fixed(r.orientation_deg, 1), fixed(r.rotation_deg, 1), fixed(r.yaw_deg, 1),
      r.by ?? '', r.cut_deg === null || r.cut_deg === undefined ? '' : fixed(r.cut_deg, 1),
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
      const value = cells[i] ?? '';
      row[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
    });
    return row;
  });
}
