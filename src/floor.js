// The robot split on the floor (docs/specs/configurator-demonstrator-robot-
// split.md, part 3.5): under each subsection, a band on the ground at the
// foot of the wall, on its front side, the left of the line from its start.
// At a sharp corner the band's two edges are mitred: on the corner's inner
// side they stop where they meet, on its outer side they run on to where
// they meet, so neither edge folds back. Each band has a place at its
// middle for its worker's pictogram. Pure: no browser objects; plan
// coordinates in m.

import { footprint } from './cut.js';

export const BAND_GAP = 0.03; // m beyond the wall's furthest front face, placeholder
export const BAND_WIDTH = 0.22; // m, placeholder
const STEP = 0.02; // m between the band's samples along the line
const CLEAR = 0.02; // m: no sample this near a sharp corner but the corner's own

// How far the wall reaches to the front of its line: the largest distance
// of a unit's corner to the left of the line at that unit.
function frontReach(units) {
  let reach = 0;
  for (const u of units) {
    const nx = -Math.sin(u.bearing);
    const ny = Math.cos(u.bearing);
    for (const [x, y] of footprint(u)) reach = Math.max(reach, (x - u.x) * nx + (y - u.y) * ny);
  }
  return reach;
}

const leftOf = (bearing) => [-Math.sin(bearing), Math.cos(bearing)];

// The sharp corners of a line: where, the corner point, the two legs' ways and left normals, and the turn.
function sharpCorners(line) {
  const out = [];
  for (const c of line.corners || []) {
    if (c.kind !== 'sharp') continue;
    const a = line.stretches[c.index - 1];
    const b = line.stretches[c.index];
    const p = line.pointAt(c.s);
    out.push({ s: c.s, p: [p.x, p.y], u1: [a.ux, a.uy], u2: [b.ux, b.uy], n1: leftOf(a.bearing), n2: leftOf(b.bearing), turn: c.turn });
  }
  return out;
}

// A point of the edge at distance d to the front of the line at s, and the
// line's way there. Near a sharp corner whose inner side is the front, the
// point stops at the mitre, where the two legs' edges meet.
function edgePoint(line, corners, s, d, atCorner = null) {
  if (atCorner) {
    const { p, n1, n2, u1 } = atCorner;
    const f = d / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return { point: [p[0] + (n1[0] + n2[0]) * f, p[1] + (n1[1] + n2[1]) * f], way: u1 };
  }
  for (const c of corners) {
    if (!(c.turn > 0)) continue;
    const reach = d * Math.tan(c.turn / 2);
    if (s > c.s - reach && s <= c.s) return { ...edgePoint(line, corners, s, d, c), way: c.u1 };
    if (s > c.s && s < c.s + reach) return { ...edgePoint(line, corners, s, d, c), way: c.u2 };
  }
  const q = line.pointAt(s);
  const [nx, ny] = leftOf(q.bearing);
  return { point: [q.x + nx * d, q.y + ny * d], way: [Math.cos(q.bearing), Math.sin(q.bearing)] };
}

// A strip along the line from `from` to `to`, between distances near and far
// to its front: its two edges sampled together, and the line's way at each
// sample. Shared by the floor's bands and the drawer's band (line-editor.js).
export function frontStrip(line, from, to, near, far, step = STEP) {
  const corners = sharpCorners(line);
  const samples = [];
  for (let s = from; s < to - 1e-9; s += step) samples.push(s);
  samples.push(to);
  const kept = samples.filter((s, i) => i === 0 || i === samples.length - 1 || !corners.some((c) => Math.abs(s - c.s) < Math.max(CLEAR, step)));
  // A sharp corner between two samples is a sample of its own; none comes before the first.
  const at = [];
  for (const s of kept) {
    const previous = at.length ? at.at(-1).s : null;
    const corner = previous === null ? null : corners.find((c) => c.s > previous + 1e-9 && c.s < s - 1e-9);
    if (corner) at.push({ s: corner.s, corner });
    at.push({ s, corner: corners.find((c) => Math.abs(c.s - s) < 1e-9) || null });
  }
  const inner = [];
  const outer = [];
  const tangents = [];
  for (const { s, corner } of at) {
    const a = edgePoint(line, corners, s, near, corner);
    const b = edgePoint(line, corners, s, far, corner);
    inner.push(a.point);
    outer.push(b.point);
    tangents.push(a.way);
  }
  return { inner, outer, tangents, corners };
}

// The bands of a wall that fits: one per subsection, each { by, from, to,
// inner, outer, tangents, mark }, its inner and outer edges sampled
// together along the line.
export function floorBands(wall) {
  if (!wall || !wall.ok || !wall.split || !wall.line || !wall.units.length) return [];
  const { line } = wall;
  const near = frontReach(wall.units) + BAND_GAP;
  const far = near + BAND_WIDTH;
  return wall.split.subsections.map((sub) => {
    const { inner, outer, tangents, corners } = frontStrip(line, sub.from, sub.to, near, far);
    const middle = (sub.from + sub.to) / 2;
    const mark = edgePoint(line, corners, middle, (near + far) / 2, corners.find((c) => Math.abs(c.s - middle) < 1e-9) || null).point;
    return { by: sub.by, from: sub.from, to: sub.to, inner, outer, tangents, mark, near, far };
  });
}
