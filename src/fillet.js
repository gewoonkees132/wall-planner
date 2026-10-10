// The corners of the base line, a polyline with fillets (pass 3 of the
// Aicher loop, docs/specs/configurator-demonstrator-ux-aicher.md, part
// 11.2). Each inner point is a corner: sharp (radius 0), round (a set
// radius) or free (null: round as far as its stretches allow, taking at
// most half of each stretch beside it). Where the arcs at the two ends of a
// stretch would take more than the stretch, both radii are scaled down by
// one factor, so the arcs meet tangentially. Pure: no browser objects.
//
// The corner rounding (Kees, 2026-10-09; docs/specs/configurator-
// demonstrator-corner-rounding.md, part 4): two neighbouring corners with
// the same radius, turning the same way with turns under 180 degrees in
// sum, whose arcs would overlap, are one arc, tangent to the two outer
// stretches. Such a group is drawn about X, where its outer lines meet.

const EPS = 1e-9;
// A sharp corner is square at 90 degrees, within half a degree
// (placeholder): it is laid from whole blocks. Since 2026-10-09 any other
// sharp corner is allowed too, laid from cut blocks (cut.js).
export const SQUARE_TOLERANCE = 0.5;
// Two equal radii whose arcs come within this of meeting are one arc, so a
// state rounded to the centimetre draws as it was dragged (reading 4).
export const JOIN_ALLOWANCE = 0.01; // m, placeholder

const turnOf = (from, to) => {
  let a = to - from;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
};
const kOf = (turn) => Math.tan(Math.min(Math.abs(turn), Math.PI - 1e-9) / 2);
const direction = (a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy);
  return d > EPS ? [dx / d, dy / d] : [1, 0];
};

// Where the line p + s u meets the line q + r v.
function meet(p, u, q, v) {
  const d = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(d) < 1e-12) return null;
  const s = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / d;
  return [p[0] + u[0] * s, p[1] + u[1] * s];
}

// The groups of corners: each inner point its own, with its point, its two
// lines (inDir, outDir), its turn (left positive) and its value (null free,
// 0 sharp, a radius); then neighbours of one radius that turn the same way,
// under 180 degrees in sum, whose arcs would overlap their shared stretch,
// joined into one, its point X where its outer lines meet. first and last
// are the inner points' numbers (1 to n - 2).
export function groupsOf(points, kinds = []) {
  const n = points.length;
  const groups = [];
  for (let i = 1; i + 1 < n; i++) {
    const a = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    const b = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    const inDir = direction(points[i - 1], points[i]);
    const outDir = direction(points[i], points[i + 1]);
    const turn = a > EPS && b > EPS ? turnOf(Math.atan2(inDir[1], inDir[0]), Math.atan2(outDir[1], outDir[0])) : 0;
    const value = kinds[i - 1] === undefined ? null : kinds[i - 1];
    groups.push({ first: i, last: i, pi: points[i].slice(), inDir, outDir, turn, value });
  }
  for (let again = true; again;) {
    again = false;
    for (let g = 0; g + 1 < groups.length; g++) {
      const A = groups[g];
      const B = groups[g + 1];
      if (!(typeof A.value === 'number' && A.value > 0 && typeof B.value === 'number' && Math.abs(A.value - B.value) < EPS)) continue;
      if (Math.abs(A.turn) < 1e-6 || Math.abs(B.turn) < 1e-6 || Math.sign(A.turn) !== Math.sign(B.turn)) continue;
      if (Math.abs(A.turn + B.turn) >= Math.PI - 1e-9) continue;
      const m = (B.pi[0] - A.pi[0]) * A.outDir[0] + (B.pi[1] - A.pi[1]) * A.outDir[1];
      if (A.value * (kOf(A.turn) + kOf(B.turn)) <= m - JOIN_ALLOWANCE) continue;
      const X = meet(A.pi, A.inDir, B.pi, B.outDir);
      if (!X) continue;
      groups.splice(g, 2, { first: A.first, last: B.last, pi: X, inDir: A.inDir, outDir: B.outDir, turn: A.turn + B.turn, value: A.value });
      again = true;
      break;
    }
  }
  return groups;
}

// The overlap rule: each stretch's arcs scaled by one factor where they
// overdraw it; a corner on two crowded stretches takes the smaller factor.
// lengths[j] is the stretch from the chain's point j to j + 1; corners[j]
// stands at its point j + 1.
function overlap(lengths, corners) {
  const count = lengths.length + 1;
  for (let pass = 0; pass < 8; pass++) {
    const factor = corners.map(() => 1);
    lengths.forEach((length, j) => {
      const left = j >= 1 ? j - 1 : -1; // the corner at point j
      const right = j + 1 <= count - 2 ? j : -1; // the corner at point j + 1
      const sum = (left >= 0 ? corners[left].t : 0) + (right >= 0 ? corners[right].t : 0);
      if (sum <= length + 1e-12) return;
      const f = length / sum;
      if (left >= 0) factor[left] = Math.min(factor[left], f);
      if (right >= 0) factor[right] = Math.min(factor[right], f);
    });
    if (factor.every((f) => f >= 1 - 1e-12)) break;
    corners.forEach((c, j) => { c.t *= factor[j]; });
  }
}

function finish(c) {
  c.radius = c.kind === 'none' ? Infinity : c.kind === 'sharp' ? 0 : c.t / c.k;
  c.square = Math.abs((Math.abs(c.turn) * 180) / Math.PI - 90) <= SQUARE_TOLERANCE;
  c.scaled = c.t < c.t0 - 1e-12;
  return c;
}

// The stretches between the points and the corner at each inner point:
// its kind, its turn (left positive), its tangent length t, the radius
// after the overlap rule, whether it is square, and whether the overlap
// rule scaled it. A joined group's arc is carried by its first corner, with
// group { first, last }; its other corners are kind 'joined', with no arc
// of their own. chain and reduced are the points and corners as drawn: the
// groups' points X between the two ends.
// The stretches between points: length, direction and bearing.
export function stretchesOf(points) {
  const stretches = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const dx = points[k + 1][0] - points[k][0];
    const dy = points[k + 1][1] - points[k][1];
    const length = Math.hypot(dx, dy);
    stretches.push({ length, ux: length > EPS ? dx / length : 1, uy: length > EPS ? dy / length : 0, bearing: Math.atan2(dy, dx) });
  }
  return stretches;
}

export function cornersOf(points, kinds = []) {
  const n = points.length;
  const stretches = stretchesOf(points);
  const base = [];
  for (let i = 1; i + 1 < n; i++) {
    const a = stretches[i - 1];
    const b = stretches[i];
    const set = kinds[i - 1] === undefined ? null : kinds[i - 1];
    const turn = a.length > EPS && b.length > EPS ? turnOf(a.bearing, b.bearing) : 0;
    const phi = Math.abs(turn);
    const none = phi < 1e-6;
    const kind = none ? 'none' : set === 0 ? 'sharp' : set === null ? 'free' : 'round';
    const k = kOf(turn);
    let t = 0;
    if (kind === 'free') t = Math.min(a.length, b.length) / 2;
    else if (kind === 'round') t = set * k;
    base.push({ index: i, kind, set, turn, k, t, t0: t });
  }
  const groups = groupsOf(points, kinds);
  if (groups.every((g) => g.first === g.last)) {
    overlap(stretches.map((s) => s.length), base);
    base.forEach(finish);
    return { stretches, corners: base, chain: points, reduced: base };
  }
  // The groups as drawn: the free corners keep the radius the original line
  // gives them; a group is one round corner of its radius at X.
  const chain = [points[0], ...groups.map((g) => g.pi), points[n - 1]];
  const lengths = chain.slice(1).map((p, j) => Math.hypot(p[0] - chain[j][0], p[1] - chain[j][1]));
  const reduced = groups.map((g) => {
    if (g.first === g.last) return { ...base[g.first - 1] };
    const k = kOf(g.turn);
    const t = g.value * k;
    return { index: g.first, kind: 'round', set: g.value, turn: g.turn, k, t, t0: t, group: { first: g.first, last: g.last } };
  });
  overlap(lengths, reduced);
  reduced.forEach(finish);
  const corners = [];
  groups.forEach((g, j) => {
    const c = reduced[j];
    corners.push(c);
    for (let q = g.first + 1; q <= g.last; q++) {
      const b = base[q - 1];
      corners.push({
        index: q, kind: 'joined', set: b.set, turn: b.turn, k: b.k, t: 0, t0: 0,
        radius: c.radius, square: false, scaled: c.scaled, lead: g.first, group: c.group,
      });
    }
  });
  return { stretches, corners, chain, reduced };
}

// The corners the wall refuses: a round or free corner under the minimum
// bend, after scaling ('tight'). A sharp corner is never refused for its
// angle (Kees, 2026-10-09: "for sharp corners it should mark it and allow it").
export function refusals(corners, minimum) {
  const out = [];
  for (const c of corners) {
    if ((c.kind === 'free' || c.kind === 'round') && c.radius < minimum - 1e-9) out.push({ ...c, reason: 'tight' });
  }
  return out;
}
