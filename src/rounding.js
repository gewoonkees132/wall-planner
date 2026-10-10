// The corner rounding (Kees, 2026-10-09; docs/specs/configurator-
// demonstrator-corner-rounding.md): an arc's handle that always reaches a
// working radius. Rule 1: a neighbour that turns the same way, under 180
// degrees in sum, whose radius is R* or more, gives way, then joins the
// dragged arc as one arc. Rule 2: else the shared stretch grows and the
// points beyond it move away along it; a neighbour under the floor rises
// with the drag up to the floor. The handle reads the circle through the
// pointer, tangent to the dragged arc's two lines. A drag is a function of
// its start state and the pointer alone. Pure: no browser objects.
//
// A state is { points, corners }: points in m, corners per inner point
// (null free, 0 sharp, a radius in m), as state.js keeps them.

import { cornersOf, groupsOf } from './fillet.js';
import { ceilCm, floorCm } from './radius.js';

const EPS = 1e-9;
const kOf = (turn) => Math.tan(Math.min(Math.abs(turn), Math.PI - 1e-9) / 2);
const centimetre = (v) => Math.round(v * 100) / 100;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const SCAN = 0.01; // m of radius between the states a stop is checked at (reading 2), placeholder
const kindsOf = (state) => state.corners.map((v) => (v === undefined ? null : v));

// The group that holds inner point i.
export function groupOf(state, i) {
  return groupsOf(state.points, kindsOf(state)).find((g) => g.first <= i && i <= g.last) || null;
}

// The radius each inner point is drawn with, a joined point its group's.
export const drawnRadii = (state) => cornersOf(state.points, kindsOf(state)).corners.map((c) => c.radius);

// The radius of the circle through p tangent to two lines meeting at pi
// (in along inDir, out along outDir), the root whose arc faces the corner.
// Where none passes (the pointer outside the two lines), the one whose arc
// comes nearest, so the radius runs on without a step; negative beyond the
// point.
export function circleRadius({ pi, inDir, outDir }, [x, y]) {
  const w0 = [outDir[0] - inDir[0], outDir[1] - inDir[1]];
  const wl = Math.hypot(w0[0], w0[1]);
  if (!(wl > 1e-12)) return Infinity;
  const w = [w0[0] / wl, w0[1] / wl];
  const half = Math.acos(Math.max(-1, Math.min(1, dot(inDir, outDir)))) / 2;
  const c = 1 / Math.cos(half);
  const q = [x - pi[0], y - pi[1]];
  const qw = dot(q, w);
  const A = c * c - 1;
  const disc = c * c * qw * qw - A * dot(q, q);
  if (A < 1e-12) return Infinity;
  return (c * qw + Math.sqrt(Math.max(0, disc))) / A;
}

// The state a radius R on inner point i makes, from the start state:
// every corner of i's group set to R, then on each side, while the arcs
// overdraw their shared stretch, rule 1 where it holds, else rule 2
// (never for a typed radius, reading 1). With cm, every value written is
// whole centimetres: a neighbour that gives way rounded down, one risen to
// the floor rounded up. Returns the points, the corners and the shift of
// each side.
export function resolve(start, i, R, { minimum = 0, startR = R, typed = false, cm = false } = {}) {
  const P = start.points.map((p) => p.slice());
  const K = kindsOf(start);
  const drawn0 = drawnRadii(start);
  const g0 = groupOf(start, i);
  if (!g0) return { points: P, corners: K, moves: P.map(() => [0, 0]) };
  const touched = new Set();
  const met = new Map(); // a neighbour under the floor: the radius at which the drag first met it
  for (let q = g0.first; q <= g0.last; q++) { K[q - 1] = R; touched.add(q); }
  const moves = P.map(() => [0, 0]);
  for (let round = 0; round < 40; round++) {
    const groups = groupsOf(P, K);
    const gi = groups.findIndex((g) => g.first <= i && i <= g.last);
    const G = groups[gi];
    const kG = kOf(G.turn);
    const tG = R * kG;
    let changed = false;
    for (const side of [-1, 1]) {
      const N = groups[gi + side];
      const dir = side < 0 ? G.inDir : G.outDir;
      const far = N ? N.pi : side < 0 ? P[0] : P[P.length - 1];
      const m = side * dot([far[0] - G.pi[0], far[1] - G.pi[1]], dir);
      let rN = 0;
      let kN = 0;
      if (N && Math.abs(N.turn) > 1e-6 && N.value !== 0) {
        kN = kOf(N.turn);
        rN = touched.has(N.first) ? K[N.first - 1] : drawn0[N.first - 1];
      }
      if (tG + rN * kN <= m + 1e-9) continue;
      // Rule 1: a same-way neighbour at R* or more gives way, then joins.
      const sameWay = rN > 0 && Math.sign(N.turn) === Math.sign(G.turn) && Math.abs(G.turn + N.turn) < Math.PI - 1e-9;
      if (sameWay) {
        const star = m / (kG + kN);
        if (rN >= star - EPS) {
          let v = R <= star + 1e-12 ? (m - R * kG) / kN : R;
          if (cm && R <= star + 1e-12) v = floorCm(v);
          for (let q = N.first; q <= N.last; q++) { K[q - 1] = v; touched.add(q); }
          changed = true;
          continue;
        }
      }
      if (typed) continue;
      // Rule 2: the stretch grows; a neighbour under the floor rises with R,
      // one for one from where the drag first met it, so it never steps.
      if (N && !met.has(N.first)) met.set(N.first, { base: rN, at: Math.max(startR, kG > 0 ? (m - rN * kN) / kG : R) });
      const hold = N ? met.get(N.first) : { base: 0, at: R };
      let v = hold.base;
      if (v > 0 && v < minimum - EPS) v = Math.min(minimum, v + Math.max(0, R - hold.at));
      if (cm && v > 0) v = v >= minimum - EPS ? Math.max(ceilCm(minimum), floorCm(v)) : floorCm(v);
      const delta = tG + v * kN - m;
      if (delta > 1e-12) {
        const by = [dir[0] * side * delta, dir[1] * side * delta];
        const from = side < 0 ? 0 : G.last + 1;
        const to = side < 0 ? G.first - 1 : P.length - 1;
        for (let q = from; q <= to; q++) {
          P[q] = [P[q][0] + by[0], P[q][1] + by[1]];
          moves[q] = [moves[q][0] + by[0], moves[q][1] + by[1]];
        }
        changed = true;
      }
      if (N && v > 0) for (let q = N.first; q <= N.last; q++) { K[q - 1] = v; touched.add(q); }
    }
    if (!changed) break;
  }
  return { points: P, corners: K, moves };
}

// The state as the address keeps it: each point's move rounded away from
// the dragged corner to whole centimetres, applied to the start's points,
// and grown by a centimetre where the rounded state would still need the
// overlap rule (reading 4).
function toCentimetres(start, solved) {
  const n = start.points.length;
  const away = (v) => (v > 0 ? Math.ceil(v * 100 - 1e-6) / 100 : v < 0 ? -Math.ceil(-v * 100 - 1e-6) / 100 : 0);
  let extra = 0;
  for (let tries = 0; tries < 12; tries++) {
    const points = start.points.map((p, q) => {
      const [x, y] = solved.moves[q];
      const L = Math.hypot(x, y);
      if (!(L > 1e-12)) return p.slice();
      const f = (L + extra) / L;
      return [centimetre(p[0] + away(x * f)), centimetre(p[1] + away(y * f))];
    });
    const corners = solved.corners.map((v) => (typeof v === 'number' && v > 0 ? centimetre(v) : v));
    const drawn = cornersOf(points, corners).corners;
    if (!drawn.some((c) => c.scaled) || tries === 11 || n < 3) return { points, corners };
    extra += 0.01;
  }
  return null;
}

// What changed from the start, for the hint line: the groups joined with
// the dragged one, the stretches grown, a stop.
function whatHappened(start, state, i, R) {
  const before = groupOf(start, i);
  const after = groupOf(state, i);
  const out = { joined: null, grew: [], radius: R };
  if (after && (after.first < before.first || after.last > before.last)) out.joined = { first: after.first, last: after.last };
  const len = (P, k) => Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]);
  for (let k = 0; k + 1 < state.points.length; k++) {
    const grown = len(state.points, k) - len(start.points, k);
    if (grown > 0.005) out.grew.push({ stretch: k, length: len(state.points, k), after: k >= i });
  }
  return out;
}

// The drag of inner point i's arc: from the start state, the pointer and
// the press, the state the drawing shows. The radius is the circle through
// the pointer tangent to the lines of i's group as that state draws them,
// less the circle at the press, plus the arc's radius at the start (reading
// 7), never under the floor: the minimum, or the start's radius where that
// is lower. refuse(state) names what refuses a state besides a tight arc
// ('near', 'long'), or null; where a state is refused so, the radius stops
// at the last one that is not, and stopped names why (reading 2). With cm
// the state is in whole centimetres, and the start itself where the radius
// rounds to the start's. memo keeps what one drag has scanned.
export function arcDrag(start, i, pointer, { minimum = 0, press = null, refuse = null, cm = false, memo = null } = {}) {
  const g0 = groupOf(start, i);
  if (!g0) return { ...start, radius: NaN, happened: null, stopped: null };
  const drawn0 = drawnRadii(start);
  const startR = drawn0[g0.first - 1];
  const floor = Math.min(minimum, startR);
  const at0 = press ? circleRadius(g0, press) : startR;
  const offset = Number.isFinite(at0) ? startR - at0 : 0;
  const target = (g) => Math.max(floor, circleRadius(g, pointer) + offset);
  const solve = (R) => resolve(start, i, R, { minimum, startR });
  const h = (R) => target(groupOf(solve(R), i)) - R;
  let R = target(g0);
  let lo = null;
  let hi = null;
  for (let k = 0; k < 16; k++) {
    const d = h(R);
    if (Math.abs(d) < 1e-10) break;
    if (d > 0) lo = lo === null ? R : Math.max(lo, R); else hi = hi === null ? R : Math.min(hi, R);
    const next = R + d;
    if (lo !== null && hi !== null && (next <= lo || next >= hi)) {
      // A join makes the lines alternate: bisect to where they meet.
      for (let b = 0; b < 60 && hi - lo > 1e-12; b++) {
        const mid = (lo + hi) / 2;
        if (h(mid) > 0) lo = mid; else hi = mid;
      }
      R = (lo + hi) / 2;
      break;
    }
    R = next;
  }
  // Reading 2: from a start that nothing but a tight arc refuses, the radius
  // stops at the last state not refused on the way from the start's radius,
  // scanned a centimetre at a time and bisected at the first refused.
  let stopped = null;
  const m = memo || {};
  const fits = (state) => !refuse(state);
  if (refuse && (m.startFits ?? (m.startFits = fits(start)))) {
    const way = R >= startR ? 'up' : 'down';
    const sign = way === 'up' ? 1 : -1;
    if (!m[way]) m[way] = { ok: startR, fail: null, why: null };
    const w = m[way];
    while (w.fail === null && sign * (R - w.ok) > 1e-12) {
      const next = sign > 0 ? Math.min(R, w.ok + SCAN) : Math.max(R, w.ok - SCAN);
      if (fits(solve(next))) { w.ok = next; continue; }
      let a = w.ok;
      let b = next;
      for (let k = 0; k < 40 && Math.abs(b - a) > 1e-7; k++) {
        const mid = (a + b) / 2;
        if (fits(solve(mid))) a = mid; else b = mid;
      }
      w.ok = a;
      w.fail = b;
      w.why = refuse(solve(b));
    }
    if (w.fail !== null && sign * (R - w.ok) > 0) { R = w.ok; stopped = w.why; }
  }
  const unchanged = () => ({ points: start.points.map((p) => p.slice()), corners: kindsOf(start), radius: startR, happened: null, stopped, startR });
  if (!cm) {
    const s = solve(R);
    return { points: s.points, corners: s.corners, radius: R, happened: whatHappened(start, s, i, R), stopped, startR };
  }
  const inward = stopped && R < startR;
  let Rc = !stopped ? centimetre(R) : inward ? ceilCm(R) : floorCm(R);
  // Past the floor the rounded radius stays past it.
  if (R >= minimum - EPS) Rc = Math.max(Rc, ceilCm(minimum));
  if (Rc === centimetre(startR) || Rc < floor - EPS) return unchanged();
  for (let k = 0; k < 20; k++) {
    const s = toCentimetres(start, resolve(start, i, Rc, { minimum, startR, cm: true }));
    if (s && (!stopped || fits(s))) {
      return { points: s.points, corners: s.corners, radius: Rc, happened: whatHappened(start, s, i, Rc), stopped, startR };
    }
    Rc = centimetre(Rc + (inward ? 0.01 : -0.01));
    if (Rc === centimetre(startR)) break;
  }
  return unchanged();
}

// A typed radius on inner point i (reading 1): rule 1 as a drag to it, a
// neighbour giving way or joining; no point moves, and where the stretches
// have no room the overlap rule draws it, as before.
export function typedRadius(start, i, value, { minimum = 0 } = {}) {
  const R = centimetre(value);
  const s = resolve(start, i, R, { minimum, typed: true, cm: true });
  const corners = s.corners.map((v) => (typeof v === 'number' && v > 0 ? centimetre(v) : v));
  return { points: start.points.map((p) => p.slice()), corners, happened: whatHappened(start, { points: start.points, corners }, i, R) };
}

// What lies past the largest radius a corner's stretches allow as they
// stand (reading 5): on the side that limits it, a same-way neighbour at R*
// or over joins ('join', its inner point), else that stretch grows ('grow',
// the stretch's index).
export function pastLargest(start, i) {
  const g = groupOf(start, i);
  if (!g) return null;
  const groups = groupsOf(start.points, kindsOf(start));
  const gi = groups.indexOf(groups.find((x) => x.first === g.first));
  const drawn0 = drawnRadii(start);
  const kG = kOf(g.turn);
  let best = null;
  for (const side of [-1, 1]) {
    const N = groups[gi + side];
    const dir = side < 0 ? g.inDir : g.outDir;
    const far = N ? N.pi : side < 0 ? start.points[0] : start.points[start.points.length - 1];
    const m = side * dot([far[0] - g.pi[0], far[1] - g.pi[1]], dir);
    const live = N && Math.abs(N.turn) > 1e-6 && N.value !== 0;
    const kN = live ? kOf(N.turn) : 0;
    const rN = live ? drawn0[N.first - 1] : 0;
    const room = kG > 0 ? (m - rN * kN) / kG : Infinity;
    if (best && room >= best.room) continue;
    const sameWay = rN > 0 && Math.sign(N.turn) === Math.sign(g.turn) && Math.abs(g.turn + N.turn) < Math.PI - 1e-9;
    const join = sameWay && rN >= m / (kG + kN) - EPS;
    best = join ? { room, kind: 'join', with: side < 0 ? N.last : N.first } : { room, kind: 'grow', stretch: side < 0 ? g.first - 1 : g.last };
  }
  return best;
}
