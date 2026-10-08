// The motif on the units: a value or a tile number becomes a colour, a
// depth or an angle (design, 6.3; revision 1, part 5). The blocks vary by
// turn or by depth; with colours on, the same value colours them as well.
// Pure: no browser objects.

import {
  BLOCK, LETTERS, SET_ANGLES, PATTERN_ANGLES, MAX_ANGLE, BASE_COLOUR, CAP_COLOUR, depthTypes,
} from './block.js';
import { lightness } from './colour.js';
import { presetTile, imageFunction, isImage } from './motif.js';
import { applyTurns } from './turns.js';

const EPS = 1e-9;
const mod = (a, b) => ((a % b) + b) % b;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// With colours off and the blocks turning, a tile's cells cycle through
// five angle levels.
export const ROTATION_LEVELS = PATTERN_ANGLES.length;

// 6.3 step 1. The cell (r, q) of a unit: its course, and its centre's
// position along the line divided by the pitch, rounded down.
export function cellOf(unit, p) {
  return { r: unit.course, q: Math.floor(unit.position / p + EPS) };
}

// 6.3 step 2. Tile row (r - 1) mod t, tile column q mod w.
export function tileNumber(tile, r, q) {
  return tile[mod(r - 1, tile.length)][mod(q, tile[0].length)];
}

function nearestIndex(list, value) {
  let best = 0;
  for (let i = 1; i < list.length; i++) {
    if (Math.abs(list[i] - value) < Math.abs(list[best] - value) - 1e-12) best = i;
  }
  return best;
}

// 6.3 step 4. Each colour's share from 0 (darkest) to 1 (lightest), in
// proportion to its CIELAB lightness.
export function lightnessShares(colours) {
  const Ls = colours.map(lightness);
  const lo = Math.min(...Ls);
  const hi = Math.max(...Ls);
  return Ls.map((L) => (hi - lo > 1e-9 ? (L - lo) / (hi - lo) : 0));
}

// The colour whose share is nearest to v; on a tie, the darker one.
export function nearestColourIndex(v, colours) {
  const shares = lightnessShares(colours);
  const order = shares.map((_, i) => i).sort((a, b) => shares[a] - shares[b] || a - b);
  let best = order[0];
  for (const i of order) {
    if (Math.abs(shares[i] - v) < Math.abs(shares[best] - v) - 1e-12) best = i;
  }
  return best;
}

// 6.3 step 5. The depth type of an image value.
export function depthIndex(v, k) {
  return Math.round(v * (k - 1));
}

// 6.3 step 6. Angles in degrees, counterclockwise positive.
export function freeAngle(v) {
  return (2 * v - 1) * MAX_ANGLE;
}

export function nearestSetAngle(angle) {
  return SET_ANGLES[nearestIndex(SET_ANGLES, angle)];
}

export function setAngle(v) {
  return nearestSetAngle(freeAngle(v));
}

// A tile number among k levels, spread over the five pattern angles.
export function angleOfNumber(number, k = ROTATION_LEVELS) {
  const n = clamp(number, 0, k - 1);
  const level = k === ROTATION_LEVELS ? n : Math.round((n * (ROTATION_LEVELS - 1)) / Math.max(1, k - 1));
  return PATTERN_ANGLES[level];
}

// The number of levels a tile cycles through: the five angle levels for
// Turn, the depths for Depth. Colours follow the level, so switching
// colours on or off leaves the relief as it is.
export function patternTypes(motif) {
  return motif.vary === 'depth' ? motif.types : ROTATION_LEVELS;
}

// The colour of a tile level with colours on: the depths map one to one,
// the five angle levels spread over the chosen colours.
export function colourOfNumber(number, k, types) {
  const n = clamp(number, 0, k - 1);
  if (k === types) return n;
  return Math.round((n * (types - 1)) / Math.max(1, k - 1));
}

// The edited tile, or else the preset's tile.
export function activeTile(motif) {
  return motif.tile && motif.tile.length ? motif.tile : presetTile(motif.preset, patternTypes(motif));
}

// The deepest unit in use, in mm: base course and cap are as deep.
export function deepestDepth(motif) {
  return motif.vary === 'depth' ? Math.max(...depthTypes(motif.types)) : BLOCK.depth;
}

// Gives every unit of a laid wall its type, colour, depth and angle.
// Base course and cap take their grey, the deepest depth and no turn.
export function mapUnits(layout, motif) {
  const n = layout.n;
  const k = patternTypes(motif);
  const deepest = deepestDepth(motif);
  const depths = motif.vary === 'depth' ? depthTypes(motif.types) : null;
  const colours = motif.colours.slice(0, motif.types);
  const turns = motif.turns || [];
  let tile = null;
  let image = null;
  let notice = null;
  if (isImage(motif.preset)) {
    image = imageFunction(motif.preset, { lambda: layout.lambda, p: layout.p, n, digit: motif.digit });
    if (image.refused) notice = image.message;
  } else {
    tile = activeTile(motif);
  }

  const units = layout.units.map((u) => {
    if (u.kind !== 'earth') {
      return {
        ...u, type: u.kind, letter: null, colour: u.kind === 'base' ? BASE_COLOUR : CAP_COLOUR,
        depthMm: deepest, rotationDeg: 0, value: null, number: null,
      };
    }
    const { r, q } = cellOf(u, layout.p);
    let number = null;
    let value = null;
    if (tile) {
      number = clamp(tileNumber(tile, r, q), 0, k - 1);
    } else {
      value = image.refused ? 0 : image.value({ u: u.position / layout.lambda, y: (r - 0.5) / n, x: u.position });
    }
    // The colour: with colours on, from the same number or value.
    let colourIndex = null;
    let colour = motif.oneColour;
    if (motif.colour) {
      colourIndex = tile ? colourOfNumber(number, k, motif.types) : nearestColourIndex(value, colours);
      colour = colours[colourIndex];
    }
    // The depth, for Depth: the tile number among the depths, or the value's step.
    let depthIdx = 0;
    let depthMm = BLOCK.depth;
    if (depths) {
      depthIdx = tile ? clamp(number, 0, motif.types - 1) : depthIndex(value, motif.types);
      depthMm = depths[depthIdx];
    }
    // The turn, for Turn: the motif's angle, the stamps on top, then the
    // set snaps or free clamps. Half units are never turned (placeholder rule).
    let rotationDeg = 0;
    if (motif.vary === 'rotation' && u.size === 'full') {
      let angle = tile ? angleOfNumber(number, k) : motif.angles === 'free' ? freeAngle(value) : setAngle(value);
      angle = applyTurns(angle, turns, u, layout.p);
      rotationDeg = motif.angles === 'free' ? angle : nearestSetAngle(angle);
    }
    // The order list's row: the colour with colours on, else the depth, else one.
    const type = motif.colour ? colourIndex : depths ? depthIdx : 0;
    return { ...u, type, letter: LETTERS[type], colour, depthMm, rotationDeg, value, number };
  });

  return { units, notice, deepest };
}

// When the number of unit types changes, an edited tile keeps its size.
// Depth: a cell takes the nearest depth of the new set. Turn: the five
// angle levels stay as they are. Colour, when the tile's levels are the
// colours: a cell of a removed colour takes the nearest remaining colour
// by lightness.
export function remapTile(tile, { vary, colour = false, from, to, colours = [] }) {
  if (colour && vary !== 'rotation') {
    if (to >= from) return tile.map((row) => row.slice());
    const Ls = colours.slice(0, from).map(lightness);
    const kept = Ls.slice(0, to);
    const map = Ls.map((L, i) => (i < to ? i : nearestIndex(kept, L)));
    return tile.map((row) => row.map((c) => map[clamp(c, 0, from - 1)]));
  }
  if (vary === 'depth') {
    const before = depthTypes(from);
    const after = depthTypes(to);
    const map = before.map((d) => nearestIndex(after, d));
    return tile.map((row) => row.map((c) => map[clamp(c, 0, from - 1)]));
  }
  return tile.map((row) => row.slice());
}
