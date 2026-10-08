// The block, the earth tones and every placeholder (design, part 5).
// Every number that depends on the block lives in this file, so the
// producer's answer changes one file. Lengths in metres, depths in mm.
//
// [H] Luecking, "Lehmsteine DIN 18945", product handbook 2026, table
//     "Technische Daten": the 2 DF block, article 01120, and the 3 DF
//     block, article 01130. An indoor block that stands in until our own
//     block is chosen, so the page marks these numbers placeholder too.
// [K] Kees's answer in the brainstorm. [A] arithmetic. Unmarked: placeholder.

export const BLOCK = Object.freeze({
  format: '2 DF', // [H]
  length: 0.24, // m [H]
  depth: 115, // mm, in the wall's thickness [H]
  height: 0.113, // m [H]
  mass: 5.3, // kg [H]
  perPallet: 212, // [H]
});

export const DEEP_BLOCK = Object.freeze({
  format: '3 DF', // [H]
  depth: 175, // mm [H]
  mass: 9.1, // kg [H]
  perPallet: 128, // [H]
});

// The handbook lists no half unit: 120 mm long, the full unit's depth and
// height, half its mass (placeholder).
export const HALF_LENGTH = BLOCK.length / 2;

// The load of one pallet, about 1,124 kg [A]. Units of every type share
// pallets (placeholder rule).
export const PALLET_LOAD = BLOCK.perPallet * BLOCK.mass;

// The step of the length field: half a block [H, A].
export const LENGTH_STEP = HALF_LENGTH;

export const BASE_HEIGHT = 0.1; // m, placeholder; material not chosen
export const CAP_HEIGHT = 0.05; // m, placeholder; material not chosen

export const MAX_ANGLE = 10; // degrees either way, placeholder
// The set a person can follow with a template: nine angles in steps of
// 2.5 degrees (revision 1, placeholder; five was [K]). A pattern tile's
// cells cycle through five of them, so a tap on a cell is one visible step.
export const SET_ANGLES = Object.freeze([-10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10]);
export const PATTERN_ANGLES = Object.freeze([-10, -5, 0, 5, 10]);
// The brush: a tap turns the block under it one step and its neighbours
// less, to nothing at the radius, in cells (revision 1, placeholders).
export const BRUSH_STEP = 2.5; // degrees
export const BRUSH_RADIUS = 2; // cells
export const MAX_TURNS = 60; // stamps a wall may carry, placeholder
export const MAX_GAP = 0.02; // m, widest gap on the outer face of a curve, placeholder [B]

export const MIN_LENGTH = 0.48; // m, two blocks, placeholder
export const MAX_LENGTH = 9.96; // m, the longest whole number of half blocks within 10 m (placeholder) [A]
export const MAX_WALL_HEIGHT = 2.0; // m, the whole wall [K]
export const MORTAR_ABOVE = 1.0; // m, mortar recommended above this [K]

export const EYE_HEIGHT = 1.6; // m, placeholder
export const PERSON_HEIGHT = 1.75; // m, placeholder
export const PERSON_OFFSET = 1.0; // m from the start end, on the front side, placeholder

// Depth types: from 115 to 175 mm in equal steps. The ends [H], the steps placeholder.
const DEPTH_TYPES = Object.freeze({
  2: [115, 175],
  3: [115, 145, 175],
  4: [115, 135, 155, 175],
  5: [115, 130, 145, 160, 175],
});

export function depthTypes(k) {
  const types = DEPTH_TYPES[k];
  if (!types) throw new RangeError(`no depth types for ${k} unit types`);
  return types.slice();
}

// The mass of a full unit of a depth: a straight line between 5.3 kg at
// 115 mm and 9.1 kg at 175 mm. The ends [H], the rule placeholder.
export function massOfDepth(depthMm) {
  const t = (depthMm - BLOCK.depth) / (DEEP_BLOCK.depth - BLOCK.depth);
  return BLOCK.mass + t * (DEEP_BLOCK.mass - BLOCK.mass);
}

// The earth tones: the quick picks and the default colours, in this order.
// All five are placeholders.
export const EARTH_TONES = Object.freeze([
  Object.freeze({ letter: 'A', name: 'Pale clay', hex: '#e2cda8' }),
  Object.freeze({ letter: 'B', name: 'Dark umber', hex: '#5c4230' }),
  Object.freeze({ letter: 'C', name: 'Red earth', hex: '#a85c3e' }),
  Object.freeze({ letter: 'D', name: 'Ochre', hex: '#c49452' }),
  Object.freeze({ letter: 'E', name: 'Grey loam', hex: '#8c8478' }),
]);

export const LETTERS = Object.freeze(['A', 'B', 'C', 'D', 'E']);

export const BASE_COLOUR = '#787c80'; // RGB 120, 124, 128, placeholder
export const CAP_COLOUR = '#a0a4a8'; // RGB 160, 164, 168, placeholder

export const MIN_TYPES = 2;
export const MAX_TYPES = 4; // Kees, 2026-10-07: four colours at most (was 5 [S]); the depths follow, as they share the count
