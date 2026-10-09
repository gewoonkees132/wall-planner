// The one state the page keeps: defaults, input ranges, and the changes
// a control can make (design, part 3 and part 5; revision 1, part 5).
// Pure: no browser objects.

import { EARTH_TONES, MIN_TYPES, MAX_TYPES, MAX_LENGTH, MAX_TURNS } from './block.js';
import { snapLength } from './bond.js';
import { normaliseHex } from './colour.js';
import { baseLine } from './line.js';
import { MIN_COURSES, MAX_COURSES } from './limits.js';
import { remapTile, patternTypes } from './mapping.js';
import { PATTERN_PRESETS, IMAGE_PRESETS, isImage } from './motif.js';
import { addTurn, clearTurns } from './turns.js';

export const VARIES = Object.freeze(['rotation', 'depth']);
export const ANGLES = Object.freeze(['set', 'free']);
export const DIRS = Object.freeze(['right', 'left']);
export const VIEWS = Object.freeze(['close', 'garden', 'street']);
const PRESETS = Object.freeze([...IMAGE_PRESETS, ...PATTERN_PRESETS]);

export const RANGES = Object.freeze({
  courses: Object.freeze([MIN_COURSES, MAX_COURSES]),
  types: Object.freeze([MIN_TYPES, MAX_TYPES]),
  digit: Object.freeze([0, 9]),
  points: Object.freeze([2, 10]),
  turns: Object.freeze([0, MAX_TURNS]),
});

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const toCentimetre = (v) => Math.round(v * 100) / 100;

export function defaultState() {
  return {
    points: [[0, 0], [3.0, 0]],
    corners: [],
    length: 3.0,
    courses: 7,
    preset: 'diamond',
    digit: 7,
    tile: null,
    vary: 'rotation',
    angles: 'set',
    colour: false,
    types: 3,
    colours: EARTH_TONES.slice(0, 3).map((t) => t.hex),
    oneColour: EARTH_TONES[0].hex,
    turns: [],
    turnDir: 'right',
    view: 'garden',
  };
}

export function straightPoints(length) {
  return [[0, 0], [length, 0]];
}

// The motif's kind follows the preset.
export const sourceOf = (preset) => (isImage(preset) ? 'image' : 'pattern');

// The typed length. With two points it moves the end point along the
// line's direction; with more, it scales the line about its first point,
// so the shape stays and the bend scales with it.
export function withLength(state, value) {
  const length = snapLength(value);
  const points = state.points;
  if (points.length <= 2) {
    const [x0, y0] = points[0];
    let dx = points[1][0] - x0;
    let dy = points[1][1] - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) {
      dx = 1;
      dy = 0;
    } else {
      dx /= d;
      dy /= d;
    }
    return { ...state, length, points: [[x0, y0], [toCentimetre(x0 + dx * length), toCentimetre(y0 + dy * length)]], corners: [] };
  }
  const current = baseLine(points, state.corners).length;
  if (!(current > 1e-9)) return { ...state, length };
  const factor = length / current;
  const [x0, y0] = points[0];
  return {
    ...state,
    length,
    points: points.map(([x, y]) => [toCentimetre(x0 + (x - x0) * factor), toCentimetre(y0 + (y - y0) * factor)]),
    corners: cornersFor(points.length, state.corners).map((c) => (c ? toCentimetre(c * factor) : c)),
  };
}

export function withCourses(state, n) {
  return { ...state, courses: clamp(Math.round(n), RANGES.courses) };
}

// Points are kept to the centimetre, as the address writes them. Each
// inner point has a corner (pass 3, part 11.2): null for free, a radius in
// m, 0 for sharp; the corners follow the points.
const cornersFor = (n, corners = []) => Array.from({ length: Math.max(0, n - 2) }, (_, i) => (corners[i] === undefined ? null : corners[i]));

export function withPoints(state, points, corners = state.corners) {
  return { ...state, points: points.map(([x, y]) => [toCentimetre(x), toCentimetre(y)]), corners: cornersFor(points.length, corners) };
}

// A new motif draws its tile again and clears the stamps.
export function withPreset(state, preset) {
  if (!PRESETS.includes(preset)) return state;
  return { ...state, preset, tile: null, turns: clearTurns() };
}

export function withDigit(state, digit) {
  return { ...state, digit: clamp(Math.round(digit), RANGES.digit) };
}

// Fewer unit types: an edited tile keeps its size and its cells move to
// the nearest remaining type. New types take the next earth tone.
export function withTypes(state, k) {
  const types = clamp(Math.round(k), RANGES.types);
  if (types === state.types) return state;
  const colours = Array.from({ length: types }, (_, i) => state.colours[i] ?? EARTH_TONES[i].hex);
  const tile = state.tile
    ? remapTile(state.tile, { vary: state.vary, colour: state.colour, from: state.types, to: types, colours: state.colours })
    : null;
  return { ...state, types, colours, tile };
}

// A new way to vary draws the tile again.
export function withVary(state, vary) {
  if (!VARIES.includes(vary) || vary === state.vary) return state;
  return { ...state, vary, tile: null };
}

export function withAngles(state, angles) {
  return ANGLES.includes(angles) ? { ...state, angles } : state;
}

// Colours on or off: the colours follow the tile's levels, so the tile stays.
export function withColourOn(state, on) {
  const colour = Boolean(on);
  if (colour === state.colour) return state;
  return { ...state, colour };
}

export function withColour(state, index, hex) {
  if (index < 0 || index >= state.types) return state;
  const colours = state.colours.slice();
  colours[index] = hex;
  return { ...state, colours };
}

export function withOneColour(state, hex) {
  return { ...state, oneColour: hex };
}

// A tap on the wall: a stamp, or the same state when the wall carries the most.
export function withTurn(state, stamp) {
  const { turns, refused } = addTurn(state.turns, stamp);
  return refused ? state : { ...state, turns };
}

export function withTurnsCleared(state) {
  return state.turns.length ? { ...state, turns: clearTurns() } : state;
}

export function withTurnDir(state, dir) {
  return DIRS.includes(dir) ? { ...state, turnDir: dir } : state;
}

export function withView(state, view) {
  return VIEWS.includes(view) ? { ...state, view } : state;
}

// A tap cycles a cell of the tile to the next level.
export function withCellCycled(state, tile, i, j) {
  const k = patternTypes(state);
  const next = tile.map((row) => row.slice());
  next[i][j] = (next[i][j] + 1) % k;
  return { ...state, tile: next };
}

export function withTile(state, tile) {
  return { ...state, tile: tile ? tile.map((row) => row.slice()) : null };
}

// 6.5 The state in the address, after the #, as keys and values. Lengths
// and points in centimetres; points as x,y pairs separated by ";"; an
// edited tile as rows of digits separated by "."; colours as hex values
// separated by "."; the stamps as x,course,dir triples separated by ";".
// Old keys are read and ignored: lvl, src.

const CODES = Object.freeze({
  preset: { diamond: 'dia', bands: 'ban', chequer: 'che', gradient: 'gra', wave: 'wav', digit: 'dig' },
  vary: { rotation: 'r', depth: 'd' },
  angles: { set: 'h', free: 'f' },
  dir: { right: 'r', left: 'l' },
  view: { close: 'c', garden: 'g', street: 's' },
});

const NAMES = Object.fromEntries(Object.entries(CODES).map(([field, codes]) => [
  field, Object.fromEntries(Object.entries(codes).map(([name, code]) => [code, name])),
]));

const centimetres = (metres) => Math.round(metres * 100);
const bare = (hex) => hex.slice(1);
const MAX_COORDINATE = MAX_LENGTH; // m either way: a point lies no farther from the start than the longest line runs
const MAX_TILE = 16; // rows or columns, placeholder

export function encodeState(state) {
  const base = defaultState();
  const parts = [
    ['v', '1'],
    ['len', centimetres(state.length)],
    ['pts', state.points.map(([x, y]) => `${centimetres(x)},${centimetres(y)}`).join(';')],
    ...(state.points.length > 2 ? [['rad', cornersFor(state.points.length, state.corners).map((c) => (c === null ? 'a' : centimetres(c))).join(';')]] : []),
    ['n', state.courses],
    ['pre', CODES.preset[state.preset]],
  ];
  if (state.digit !== base.digit) parts.push(['dig', state.digit]);
  if (state.tile) parts.push(['tile', state.tile.map((row) => row.join('')).join('.')]);
  parts.push(['var', CODES.vary[state.vary]], ['ang', CODES.angles[state.angles]]);
  if (state.colour) parts.push(['cl', '1']);
  parts.push(['k', state.types], ['col', state.colours.map(bare).join('.')]);
  if (state.oneColour !== base.oneColour) parts.push(['one', bare(state.oneColour)]);
  if (state.turns.length) parts.push(['turns', state.turns.map((t) => `${centimetres(t.x)},${t.course},${t.dir}`).join(';')]);
  if (state.turnDir !== base.turnDir) parts.push(['dir', CODES.dir[state.turnDir]]);
  parts.push(['view', CODES.view[state.view]]);
  return `#${parts.map(([key, value]) => `${key}=${value}`).join('&')}`;
}

function number(text) {
  if (typeof text !== 'string' || !/^\s*-?\d+(\.\d+)?\s*$/.test(text)) return NaN;
  return Number(text);
}

function readPoints(text) {
  if (typeof text !== 'string') return null;
  const pairs = text.split(';');
  if (pairs.length < RANGES.points[0] || pairs.length > RANGES.points[1]) return null;
  const points = [];
  for (const pair of pairs) {
    const [x, y, extra] = pair.split(',').map(number);
    if (extra !== undefined || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const bound = (v) => Math.min(MAX_COORDINATE, Math.max(-MAX_COORDINATE, v / 100));
    points.push([bound(x), bound(y)]);
  }
  return points;
}

function readTile(text, k) {
  if (typeof text !== 'string') return null;
  const rows = text.split('.');
  if (rows.length < 1 || rows.length > MAX_TILE) return null;
  const width = rows[0].length;
  if (width < 1 || width > MAX_TILE) return null;
  if (!rows.every((row) => row.length === width && /^\d+$/.test(row))) return null;
  return rows.map((row) => [...row].map((digit) => Math.min(k - 1, Number(digit))));
}

// The corners (pass 3): per inner point, a for free or a radius in
// centimetres, 0 for sharp. An old link has none: its corners are free.
// A list that does not match the points is read as far as it goes.
function readCorners(text, count) {
  const corners = Array.from({ length: Math.max(0, count) }, () => null);
  if (typeof text !== 'string') return corners;
  text.split(';').slice(0, corners.length).forEach((part, i) => {
    const v = number(part);
    if (Number.isFinite(v) && v >= 0) corners[i] = Math.min(MAX_COORDINATE, v / 100);
  });
  return corners;
}

// The stamps: any unreadable triple makes the whole list empty.
function readTurns(text) {
  if (typeof text !== 'string') return [];
  const turns = [];
  for (const part of text.split(';')) {
    const [x, course, dir, extra] = part.split(',').map(number);
    if (extra !== undefined || ![x, course, dir].every(Number.isFinite) || (dir !== 1 && dir !== -1)) return [];
    if (turns.length >= MAX_TURNS) break;
    turns.push({
      x: Math.min(MAX_LENGTH, Math.max(0, x / 100)),
      course: clamp(Math.round(course), [0, MAX_COURSES + 1]),
      dir,
    });
  }
  return turns;
}

// Reading: an unknown key is ignored; a value out of range is clamped;
// anything unreadable falls back to the default. A version other than 1
// opens the default wall. An old link's "var=c" opens with colours on.
export function decodeState(hash) {
  const state = defaultState();
  if (typeof hash !== 'string') return state;
  const values = {};
  for (const part of hash.replace(/^#/, '').split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    try {
      values[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
    } catch {
      // An unreadable value is left out.
    }
  }
  if (values.v !== '1') return state;

  const length = number(values.len);
  if (Number.isFinite(length)) state.length = snapLength(length / 100);
  const points = readPoints(values.pts);
  state.points = points ?? straightPoints(state.length);
  state.corners = readCorners(values.rad, state.points.length - 2);
  const courses = number(values.n);
  if (Number.isFinite(courses)) state.courses = clamp(Math.round(courses), RANGES.courses);
  const preset = NAMES.preset[values.pre];
  state.preset = PRESETS.includes(preset) ? preset : state.preset;
  const digit = number(values.dig);
  if (Number.isFinite(digit)) state.digit = clamp(Math.round(digit), RANGES.digit);
  if (values.var === 'c') {
    state.colour = true;
  } else {
    const vary = NAMES.vary[values.var];
    if (vary) state.vary = vary;
  }
  state.angles = NAMES.angles[values.ang] ?? state.angles;
  if (values.cl === '1') state.colour = true;
  const types = number(values.k);
  if (Number.isFinite(types)) state.types = clamp(Math.round(types), RANGES.types);
  const listed = typeof values.col === 'string' ? values.col.split('.') : [];
  state.colours = Array.from({ length: state.types }, (_, i) => normaliseHex(listed[i] ?? '') ?? EARTH_TONES[i].hex);
  state.oneColour = normaliseHex(values.one ?? '') ?? state.oneColour;
  state.turns = readTurns(values.turns);
  state.turnDir = NAMES.dir[values.dir] ?? state.turnDir;
  state.view = NAMES.view[values.view] ?? state.view;
  state.tile = readTile(values.tile, patternTypes(state));
  return state;
}
