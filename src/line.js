// Straight lines, polylines with fillets, sampling and bends (design, 6.2;
// pass 3 of the Aicher loop, part 11.2).
// The base line is the wall's centreline in plan: x along the drawing's
// x axis, y to its left, bearings counterclockwise from the x axis.
// Pure: no browser objects.

import { BLOCK, LENGTH_STEP, MAX_LENGTH } from './block.js';
import { cornersOf, stretchesOf } from './fillet.js';

export const SAMPLE_STEP = 0.005; // m, placeholder
const DENSE_STEP = 0.002; // m, the line is drawn this finely before resampling

// 6.2 step 3. The usable length: the line's length rounded down to a whole
// number of half blocks, and never more than the longest wall.
export function usableLength(length) {
  const step = Math.round(LENGTH_STEP * 1000);
  const k = Math.floor((Math.min(length, MAX_LENGTH) * 1000) / step + 1e-6);
  return Math.max(0, (k * step) / 1000);
}

// A line from samples at equal steps along it. Bearings are kept without
// jumps of a full turn, so a change in bearing is a plain difference.
function makeLine(xs, ys, bearings, length, knots) {
  const count = xs.length - 1;
  const step = count > 0 ? length / count : 0;
  // A line of no length, two equal points for example, is one place.
  const single = count === 0 || !(step > 0);
  function pointAt(s) {
    if (single) return { x: xs[0], y: ys[0], bearing: bearings[0] };
    const clamped = Math.min(length, Math.max(0, s));
    const i = Math.min(count - 1, Math.floor(clamped / step));
    const t = (clamped - i * step) / step;
    return {
      x: xs[i] + (xs[i + 1] - xs[i]) * t,
      y: ys[i] + (ys[i + 1] - ys[i]) * t,
      bearing: bearings[i] + (bearings[i + 1] - bearings[i]) * t,
    };
  }
  return { length, usable: usableLength(length), step, xs, ys, bearings, knots, pointAt };
}

function unwrap(previous, angle) {
  let a = angle;
  while (a - previous > Math.PI) a -= 2 * Math.PI;
  while (a - previous < -Math.PI) a += 2 * Math.PI;
  return a;
}

// 6.2 step 2. Resample a fine polyline at equal steps of at most 5 mm.
function fromDense(dense, knotIndices) {
  const cumulative = [0];
  for (let i = 1; i < dense.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  const length = cumulative.at(-1);
  const count = Math.max(1, Math.ceil(length / SAMPLE_STEP - 1e-9));
  const xs = new Float64Array(count + 1);
  const ys = new Float64Array(count + 1);
  let j = 0;
  for (let k = 0; k <= count; k++) {
    const s = (length * k) / count;
    while (j < cumulative.length - 2 && cumulative[j + 1] < s) j++;
    const span = cumulative[j + 1] - cumulative[j];
    const t = span > 0 ? (s - cumulative[j]) / span : 0;
    xs[k] = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * t;
    ys[k] = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * t;
  }
  const bearings = new Float64Array(count + 1);
  for (let k = 0; k <= count; k++) {
    const a = Math.max(0, k - 1);
    const b = Math.min(count, k + 1);
    const raw = Math.atan2(ys[b] - ys[a], xs[b] - xs[a]);
    bearings[k] = k === 0 ? raw : unwrap(bearings[k - 1], raw);
  }
  return makeLine(xs, ys, bearings, length, knotIndices.map((i) => cumulative[i]));
}


// Pass 3 (part 11.2). The base line as a polyline with fillets: straight
// stretches between the points and, at each inner point, an arc tangent to
// both stretches or a sharp corner (fillet.js). Sampled to the same line
// as before, with its corners and its runs: the pieces between sharp
// corners, along which the courses are laid (bond.js). Two points give a
// straight line.
export function baseLine(points, kinds = []) {
  const P = points.map(([x, y]) => [x, y]);
  const { stretches, corners, chain, reduced } = cornersOf(P, kinds);
  // The corner rounding (part 4.2 of docs/specs/configurator-demonstrator-
  // corner-rounding.md): a joined group is drawn as one corner at X, so the
  // line is drawn on the chain of the groups' points; its corners are then
  // mapped back to one per inner point.
  const C = chain.map(([x, y]) => [x, y]);
  const n = C.length;
  const legs = chain === points ? stretches : stretchesOf(C);
  const dense = [];
  const push = (x, y) => {
    const last = dense.at(-1);
    if (!last || Math.hypot(x - last[0], y - last[1]) > 1e-12) dense.push([x, y]);
  };
  const spans = []; // per corner of the chain: the dense indices of its arc, or of the corner
  push(C[0][0], C[0][1]);
  for (let s = 0; s + 1 < n; s++) {
    const st = legs[s];
    const endT = s + 1 <= n - 2 ? reduced[s].t : 0;
    const from = dense.at(-1);
    const to = [C[s + 1][0] - st.ux * endT, C[s + 1][1] - st.uy * endT];
    const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / DENSE_STEP));
    for (let i = 1; i <= steps; i++) push(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    if (s + 1 > n - 2) break;
    const c = reduced[s];
    const span = { from: dense.length - 1, to: dense.length - 1, centre: null };
    if (c.t > 1e-9 && (c.kind === 'free' || c.kind === 'round')) {
      const R = c.radius;
      const side = Math.sign(c.turn);
      const cx = to[0] - st.uy * R * side;
      const cy = to[1] + st.ux * R * side;
      const a0 = Math.atan2(to[1] - cy, to[0] - cx);
      const arcSteps = Math.max(4, Math.ceil((R * Math.abs(c.turn)) / DENSE_STEP));
      for (let i = 1; i <= arcSteps; i++) {
        const a = a0 + (c.turn * i) / arcSteps;
        push(cx + R * Math.cos(a), cy + R * Math.sin(a));
      }
      span.to = dense.length - 1;
      span.centre = [cx, cy];
    }
    spans.push(span);
  }
  if (dense.length === 1) dense.push(dense[0].slice());
  const middles = spans.map((sp) => Math.round((sp.from + sp.to) / 2));
  // One knot per inner point: a joined group's points share its arc's middle.
  const spanOf = corners.map((c) => reduced.findIndex((r) => r.index === (c.kind === 'joined' ? c.lead : c.index)));
  const knots = [0, ...spanOf.map((j) => middles[j]), dense.length - 1];
  const line = fromDense(dense, knots);
  const cumulative = [0];
  for (let i = 1; i < dense.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  line.stretches = stretches;
  line.corners = corners.map((c, j) => {
    const sp = spans[spanOf[j]];
    return { ...c, from: cumulative[sp.from], to: cumulative[sp.to], s: line.knots[j + 1], centre: sp.centre };
  });
  // The runs: cut at every sharp corner, numbered from the start.
  const cuts = [];
  reduced.forEach((c, j) => { if (c.kind === 'sharp') cuts.push({ at: spans[j].from, number: cuts.length + 1, j }); });
  line.runs = [];
  let begin = 0;
  let startCorner = 0;
  let startBearing = legs[0].bearing;
  for (const cut of [...cuts, { at: dense.length - 1, number: 0, j: -1 }]) {
    const piece = dense.slice(begin, cut.at + 1);
    const runLine = piece.length > 1 ? fromDense(piece, [0, piece.length - 1]) : fromDense([piece[0], piece[0]], [0, 1]);
    const endBearing = cut.j >= 0 ? legs[cut.j].bearing : legs.at(-1).bearing;
    line.runs.push({
      start: cumulative[begin], length: runLine.length, line: runLine, startCorner, endCorner: cut.number,
      first: piece[0], last: piece.at(-1), startBearing, endBearing,
    });
    begin = cut.at;
    startCorner = cut.number;
    if (cut.j >= 0) startBearing = legs[cut.j + 1].bearing;
  }
  return line;
}


// An exact arc from (0, 0), leaving along the x axis: a positive radius
// turns left, a negative one right. For the tests.
export function arcLine(radius, length) {
  const count = Math.max(1, Math.ceil(length / SAMPLE_STEP - 1e-9));
  const xs = new Float64Array(count + 1);
  const ys = new Float64Array(count + 1);
  const bearings = new Float64Array(count + 1);
  for (let k = 0; k <= count; k++) {
    const s = (length * k) / count;
    const theta = s / radius;
    xs[k] = radius * Math.sin(theta);
    ys[k] = radius * (1 - Math.cos(theta));
    bearings[k] = theta;
  }
  return makeLine(xs, ys, bearings, length, [0, length]);
}

// 6.2 step 6. The tightest bend of the drawn line: the smallest radius
// among its samples, averaged over one block length. Infinity when straight.
export function tightestBend(line, span = BLOCK.length) {
  const half = Math.min(span, line.length) / 2;
  if (!(half > 0)) return Infinity;
  let best = Infinity;
  for (let s = half; s <= line.length - half + 1e-12; s += line.step) {
    const turn = Math.abs(line.pointAt(s + half).bearing - line.pointAt(s - half).bearing);
    if (turn > 1e-7) best = Math.min(best, (2 * half) / turn);
  }
  return best;
}

// The stretch, between point k and point k + 1, that holds the place s.
export function stretchOf(line, s) {
  const last = line.knots.length - 2;
  for (let k = 0; k < last; k++) {
    if (s < line.knots[k + 1]) return k;
  }
  return Math.max(0, last);
}
