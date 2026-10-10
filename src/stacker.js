// Who stacks it (revision 1, part 6), split by block (the robot split,
// docs/specs/configurator-demonstrator-robot-split.md, parts 3.3 and 3.4).
// Kees, 2026-10-09: "verdict should be for subsections ... splitting the
// work per block might be better". Every earth unit has a worker, with a
// reason: the robot for a cut block or a block turned to a free angle; a
// template for a block turned to a set angle or one on an arc in the
// template's band; else a hand. Along the line the highest worker over a
// place counts, and the stretches of one worker are the subsections. The
// wall's answer is the highest worker it has. Computed, never chosen.
// Pure: no browser objects.

import { SET_ANGLES, HALF_LENGTH } from './block.js';

export const STEPS = Object.freeze(['hand', 'template', 'robot']);
const RANK = Object.freeze({ hand: 0, template: 1, robot: 2 });
// A stretch under this, in m, joins a neighbour of a higher worker (reading 6).
export const MIN_STRETCH = HALF_LENGTH;

const EPS = 1e-9;
const inSet = (angle) => SET_ANGLES.some((a) => Math.abs(a - angle) < EPS);
const keyOf = (reason) => `${reason.kind}|${reason.point ?? ''}`;

// The arcs of a line, as the drawer draws them: { from, to, radius, point,
// last }; a joined arc once, from its first point to its last (the corner
// rounding, 2026-10-09).
function arcsOf(line) {
  return ((line && line.corners) || [])
    .filter((c) => (c.kind === 'free' || c.kind === 'round') && c.radius > 0 && c.t > 1e-9)
    .map((c) => ({ from: c.from, to: c.to, radius: c.radius, point: c.index + 1, last: (c.group ? c.group.last : c.index) + 1 }));
}

// The worker of one earth unit and why, from its cut, its turn and the arc it lies on.
export function workerOf(u, arcs, bands, depths = 1) {
  if (u.cut) return { by: 'robot', reason: u.cut.at };
  const turned = Math.abs(u.rotationDeg || 0) > EPS;
  if (turned && !inSet(u.rotationDeg)) return { by: 'robot', reason: { kind: 'free' } };
  if (turned) return { by: 'template', reason: { kind: 'set' } };
  const arc = arcs.find((a) => u.position >= a.from - EPS && u.position <= a.to + EPS);
  if (arc && arc.radius < bands.hand - EPS) return { by: 'robot', reason: { kind: 'arc', point: arc.point, last: arc.last, radius: arc.radius } };
  if (arc && arc.radius < bands.template - EPS) return { by: 'template', reason: { kind: 'arcTemplate', point: arc.point, last: arc.last, radius: arc.radius } };
  return { by: 'hand', reason: { kind: depths > 1 ? 'depth' : 'none' } };
}

// Gives every earth unit of a wall its worker (by) and its reason (why).
export function assignWorkers(wall, bands) {
  const arcs = arcsOf(wall.line);
  const earth = wall.units.filter((u) => u.kind === 'earth');
  const depths = new Set(earth.map((u) => u.depthMm)).size;
  for (const u of earth) {
    const { by, reason } = workerOf(u, arcs, bands, depths);
    u.by = by;
    u.why = reason;
  }
  return wall;
}

// Stretches along the line, each { from, to, by }, in order and meeting:
// neighbours of one worker join; a stretch under min joins a neighbour of
// a higher worker, the higher of the two; nothing joins a lower one.
export function mergeStretches(pieces, min = MIN_STRETCH) {
  let list = pieces.map((p) => ({ ...p }));
  const joinEqual = () => {
    const out = [];
    for (const p of list) {
      const last = out.at(-1);
      if (last && last.by === p.by) last.to = p.to;
      else out.push({ ...p });
    }
    list = out;
  };
  joinEqual();
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.to - p.from >= min - EPS) continue;
      const left = list[i - 1];
      const right = list[i + 1];
      const higher = [left, right].filter((q) => q && RANK[q.by] > RANK[p.by]);
      if (!higher.length) continue;
      p.by = higher.reduce((a, b) => (RANK[b.by] > RANK[a.by] ? b : a)).by;
      joinEqual();
      changed = true;
      break;
    }
  }
  return list;
}

// The highest worker over each place of the line, from the units' spans of
// every earth course: a sweep over their ends.
function pieces(earth) {
  const events = [];
  for (const u of earth) {
    events.push([u.position - u.span / 2, 1, RANK[u.by]], [u.position + u.span / 2, -1, RANK[u.by]]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const active = [0, 0, 0];
  const out = [];
  let at = null;
  for (const [s, step, rank] of events) {
    if (at !== null && s > at + 1e-7) {
      const top = active[2] > 0 ? 2 : active[1] > 0 ? 1 : active[0] > 0 ? 0 : -1;
      out.push({ from: at, to: s, rank });
      out.at(-1).rank = top;
    }
    active[rank] += step;
    at = at === null ? s : Math.max(at, s);
  }
  // A place no unit covers, a joint in every course, takes the worker before it.
  let previous = 0;
  return out.map((p) => {
    const rank = p.rank >= 0 ? p.rank : previous;
    previous = rank;
    return { from: p.from, to: p.to, by: STEPS[rank] };
  });
}

// The split of a wall: blocks and metres per worker, the subsections along
// the line with their reasons, and, as the summary, the highest worker.
export function splitOf(wall) {
  const earth = (wall.units || []).filter((u) => u.kind === 'earth' && u.by);
  const counts = { hand: 0, template: 0, robot: 0 };
  let cut = 0;
  for (const u of earth) {
    counts[u.by]++;
    if (u.cut) cut++;
  }
  const subsections = mergeStretches(pieces(earth)).map((s) => ({ ...s, reasons: [] }));
  const metres = { hand: 0, template: 0, robot: 0 };
  for (const s of subsections) metres[s.by] += s.to - s.from;
  // The reasons, along the line, once each: of the whole wall per worker, and of each subsection.
  const reasons = { hand: [], template: [], robot: [] };
  const seen = new Set();
  const ordered = earth.slice().sort((a, b) => a.position - b.position);
  for (const u of ordered) {
    const key = `${u.by}|${keyOf(u.why)}`;
    if (!seen.has(key)) {
      seen.add(key);
      reasons[u.by].push(u.why);
    }
    const s = subsections.find((x) => u.position >= x.from - EPS && u.position <= x.to + EPS && x.by === u.by);
    if (s && !s.reasons.some((r) => keyOf(r) === keyOf(u.why))) s.reasons.push(u.why);
  }
  const step = counts.robot ? 2 : counts.template ? 1 : 0;
  const key = STEPS[step];
  // The summary's reason: the commonest of the answer's own.
  const tally = new Map();
  for (const u of earth) if (u.by === key) tally.set(u.why.kind, (tally.get(u.why.kind) || 0) + 1);
  let reason = 'none';
  let most = 0;
  for (const [kind, n] of tally) if (n > most) { most = n; reason = kind; }
  return { counts, cut, metres, subsections, reasons, key, step, reason };
}

// The wall's split; a wall with no units, none.
export function whoStacks(wall) {
  return wall && wall.split ? wall.split : splitOf(wall || { units: [] });
}
