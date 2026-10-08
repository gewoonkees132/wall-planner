// The order list, the mass, the pallets and the summary sentence
// (design, part 5 and 6.4; revision 1, parts 5 and 8). Pure: no browser objects.

import { BLOCK, LETTERS, EARTH_TONES, PALLET_LOAD, depthTypes, massOfDepth } from './block.js';
import { TEXTS } from './texts.js';

// A full unit's mass by its depth; a half unit half of that.
export function unitMass(u) {
  return massOfDepth(u.depthMm) * (u.size === 'half' ? 0.5 : 1);
}

function toneName(hex) {
  const tone = EARTH_TONES.find((t) => t.hex === hex);
  return tone ? tone.name : TEXTS.info.ownColour;
}

function countOf(units) {
  const full = units.filter((u) => u.size === 'full').length;
  return { full, half: units.length - full, total: units.length };
}

// A row per colour with colours on, a row per depth for Depth, else one row.
export function orderList(wall, state) {
  const earth = wall.units.filter((u) => u.kind === 'earth');
  const byDepth = !state.colour && state.vary === 'depth';
  const rowCount = state.colour || byDepth ? state.types : 1;
  const depths = byDepth ? depthTypes(state.types) : null;
  const types = [];
  for (let t = 0; t < rowCount; t++) {
    const letter = LETTERS[t];
    const colour = state.colour ? state.colours[t] : state.oneColour;
    const depthMm = depths ? depths[t] : BLOCK.depth;
    let name;
    if (state.colour) name = TEXTS.info.rowColour(letter, toneName(colour));
    else if (byDepth) name = TEXTS.info.rowDepth(letter, depthMm);
    else name = TEXTS.info.rowOne;
    types.push({ type: t, letter, colour, depthMm, name, ...countOf(earth.filter((u) => u.type === t)) });
  }
  // Units of every type share pallets (placeholder rule).
  const mass = earth.reduce((sum, u) => sum + unitMass(u), 0);
  const pallets = Math.max(1, Math.ceil(mass / PALLET_LOAD - 1e-9));
  const earthCount = countOf(earth);
  return {
    types,
    base: countOf(wall.units.filter((u) => u.kind === 'base')),
    cap: countOf(wall.units.filter((u) => u.kind === 'cap')),
    earthTotal: earthCount.total,
    earthHalf: earthCount.half,
    turned: earth.filter((u) => Math.abs(u.rotationDeg) > 1e-9).length,
    mass,
    pallets,
  };
}

// The summary sentence of part 8: the colours or the depths it counts,
// and the turned blocks.
export function summary(wall, state, list = orderList(wall, state)) {
  const earth = wall.units.filter((u) => u.kind === 'earth');
  let kinds = '';
  if (state.colour) kinds = { kind: 'colour', count: new Set(earth.map((u) => u.colour)).size };
  else if (state.vary === 'depth') kinds = { kind: 'depth', count: new Set(earth.map((u) => u.depthMm)).size };
  return TEXTS.info.summary({
    total: list.earthTotal,
    half: list.earthHalf,
    kinds,
    turned: state.vary === 'rotation' ? list.turned : 0,
    kg: list.mass,
    pallets: list.pallets,
  });
}
