// The corners of the base line, a polyline with fillets (pass 3 of the
// Aicher loop, docs/specs/configurator-demonstrator-ux-aicher.md, part
// 11.2). Each inner point is a corner: sharp (radius 0), round (a set
// radius) or free (null: round as far as its stretches allow, taking at
// most half of each stretch beside it). Where the arcs at the two ends of a
// stretch would take more than the stretch, both radii are scaled down by
// one factor, so the arcs meet tangentially. Pure: no browser objects.

const EPS = 1e-9;
// A sharp corner is square: 90 degrees, within half a degree (placeholder).
export const SQUARE_TOLERANCE = 0.5;

const turnOf = (from, to) => {
  let a = to - from;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
};

// The stretches between the points and the corner at each inner point:
// its kind, its turn (left positive), its tangent length t, the radius
// after the overlap rule, and whether it is square.
export function cornersOf(points, kinds = []) {
  const n = points.length;
  const stretches = [];
  for (let k = 0; k + 1 < n; k++) {
    const dx = points[k + 1][0] - points[k][0];
    const dy = points[k + 1][1] - points[k][1];
    const length = Math.hypot(dx, dy);
    stretches.push({ length, ux: length > EPS ? dx / length : 1, uy: length > EPS ? dy / length : 0, bearing: Math.atan2(dy, dx) });
  }
  const corners = [];
  for (let i = 1; i + 1 < n; i++) {
    const a = stretches[i - 1];
    const b = stretches[i];
    const set = kinds[i - 1] === undefined ? null : kinds[i - 1];
    const turn = a.length > EPS && b.length > EPS ? turnOf(a.bearing, b.bearing) : 0;
    const phi = Math.abs(turn);
    const none = phi < 1e-6;
    const kind = none ? 'none' : set === 0 ? 'sharp' : set === null ? 'free' : 'round';
    const k = Math.tan(Math.min(phi, Math.PI - 1e-9) / 2);
    let t = 0;
    if (kind === 'free') t = Math.min(a.length, b.length) / 2;
    else if (kind === 'round') t = set * k;
    corners.push({ index: i, kind, set, turn, k, t });
  }
  // The overlap rule: each stretch's arcs scaled by one factor where they
  // overdraw it; a corner on two crowded stretches takes the smaller factor.
  for (let pass = 0; pass < 8; pass++) {
    const factor = corners.map(() => 1);
    stretches.forEach((s, j) => {
      const left = j >= 1 ? j - 1 : -1; // the corner at point j
      const right = j + 1 <= n - 2 ? j : -1; // the corner at point j + 1
      const sum = (left >= 0 ? corners[left].t : 0) + (right >= 0 ? corners[right].t : 0);
      if (sum <= s.length + 1e-12) return;
      const f = s.length / sum;
      if (left >= 0) factor[left] = Math.min(factor[left], f);
      if (right >= 0) factor[right] = Math.min(factor[right], f);
    });
    if (factor.every((f) => f >= 1 - 1e-12)) break;
    corners.forEach((c, j) => { c.t *= factor[j]; });
  }
  for (const c of corners) {
    c.radius = c.kind === 'none' ? Infinity : c.kind === 'sharp' ? 0 : c.t / c.k;
    c.square = Math.abs((Math.abs(c.turn) * 180) / Math.PI - 90) <= SQUARE_TOLERANCE;
  }
  return { stretches, corners };
}

// The corners the wall refuses: a round or free corner under the minimum
// bend, after scaling ('tight'); a sharp corner that is not square ('square').
export function refusals(corners, minimum) {
  const out = [];
  for (const c of corners) {
    if (c.kind === 'sharp' && !c.square) out.push({ ...c, reason: 'square' });
    else if ((c.kind === 'free' || c.kind === 'round') && c.radius < minimum - 1e-9) out.push({ ...c, reason: 'tight' });
  }
  return out;
}
