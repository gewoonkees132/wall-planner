// The pictograms (the Aicher loop): one set, drawn on one grid, each beside
// the word it says. A 20 by 20 grid with a margin of 2; every point on a
// whole unit; straight lines only level, upright or at 45 degrees; curves
// only arcs of circles of a whole radius; every stroke 2 units wide, so a
// pictogram drawn at 20 px puts each line on whole pixels. Paths use the
// absolute commands M, L, H, V, A and Z only. Pure: no browser objects.

export const GRID = 20;
export const MARGIN = 2;
export const STROKE = 2;

// A full circle, as two arcs.
const disc = (cx, cy, r) => `M${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy}`;

// A person standing at x, seen from the side, beside a wall at the right.
const standing = (x) => ({
  strokes: [`M${x} 7 V12`, `M${x - 3} 10 L${x} 7 L${x + 3} 10`, `M${x} 12 L${x - 2} 14 V18 M${x} 12 L${x + 2} 14 V18`],
  fills: [disc(x, 4, 2), 'M15 11 H18 V18 H15 Z'],
});

// Strokes are drawn as lines; fills as filled shapes.
export const PICTOGRAMS = Object.freeze({
  // Steppers.
  minus: { strokes: ['M4 10 H16'] },
  plus: { strokes: ['M4 10 H16 M10 4 V16'] },
  // Taking back: the last step, or all the taps.
  undo: { strokes: ['M7 5 L4 8 L7 11', 'M4 8 H12 A4 4 0 0 1 12 16 H7'] },
  reset: { strokes: ['M10 5 A5 5 0 1 1 5 10', 'M2 10 L5 7 L8 10'] },
  // The brush: a block seen from above, and the way it turns.
  left: { strokes: ['M15 10 A5 5 0 0 0 5 10', 'M2 9 L5 12 L8 9'], fills: ['M6 14 H14 V18 H6 Z'] },
  right: { strokes: ['M5 10 A5 5 0 0 1 15 10', 'M12 9 L15 12 L18 9'], fills: ['M6 14 H14 V18 H6 Z'] },
  // The base line: a straight line between its two end points; a point struck out.
  straight: { strokes: ['M4 10 H16'], fills: [disc(4, 10, 2), disc(16, 10, 2)] },
  'remove-point': { strokes: ['M2 10 H6 M14 10 H18', 'M4 16 L16 4'], fills: [disc(10, 10, 3)] },
  // Pass 5: Fit, a refused bend made to fit: a check mark at 45 degrees.
  fit: { strokes: ['M3 10 L8 15 L17 6'] },
  // Taking a dialog away: two strokes at 45 degrees.
  dismiss: { strokes: ['M5 5 L15 15 M15 5 L5 15'] },
  // The three views, from the side: the wall, and you standing near it or away.
  close: standing(11),
  garden: standing(8),
  street: standing(5),
  // The actions: the plan file, the blocks on a pallet in their bond, the manual.
  download: { strokes: ['M10 3 V13', 'M6 9 L10 13 L14 9', 'M3 13 V17 H17 V13'] },
  order: { strokes: ['M4 3 H16 V11 H4 Z', 'M4 7 H16', 'M10 3 V7', 'M7 7 V11 M13 7 V11', 'M2 14 H18', 'M3 14 V17 M10 14 V17 M17 14 V17'] },
  manual: { strokes: ['M3 5 H8 L10 7 L12 5 H17 V15 H12 L10 17 L8 15 H3 Z', 'M10 7 V17'] },
  info: { strokes: [disc(10, 10, 8), 'M10 9 V15', 'M10 5 V7'] },
  // The motifs, each drawn as what it is: the patterns, then the images.
  bands: { strokes: ['M2 3 H18 V17 H2 Z'], fills: ['M2 8 H18 V12 H2 Z'] },
  chequer: { fills: ['M2 2 H6 V6 H2 Z', 'M10 2 H14 V6 H10 Z', 'M6 6 H10 V10 H6 Z', 'M14 6 H18 V10 H14 Z',
    'M2 10 H6 V14 H2 Z', 'M10 10 H14 V14 H10 Z', 'M6 14 H10 V18 H6 Z', 'M14 14 H18 V18 H14 Z'] },
  diamond: { strokes: ['M10 2 L18 10 L10 18 L2 10 Z'], fills: ['M10 6 L14 10 L10 14 L6 10 Z'] },
  gradient: { strokes: ['M2 2 H18 V18 H2 Z'], fills: ['M18 2 V18 H2 Z'] },
  wave: { strokes: ['M2 7 A4 4 0 0 1 10 7 A4 4 0 0 0 18 7', 'M2 13 A4 4 0 0 1 10 13 A4 4 0 0 0 18 13'] },
  digit: { strokes: ['M5 3 H15 V7 L8 14 V18'] },
  // The cells of a motif: a bond with two cells filled.
  cells: { strokes: ['M2 4 H18 V16 H2 Z', 'M2 10 H18', 'M10 4 V10', 'M6 10 V16 M14 10 V16'], fills: ['M2 4 H10 V10 H2 Z', 'M14 10 H18 V16 H14 Z'] },
  // How the blocks vary: set angles, free angles, two depths seen from above.
  'angles-set': { strokes: ['M3 16 H17', 'M10 16 L5 11', 'M10 16 V9', 'M10 16 L15 11'] },
  'angles-free': { strokes: ['M3 16 H17', 'M3 16 A7 7 0 0 1 17 16', 'M10 16 L14 12'] },
  depth: { strokes: ['M3 5 H9 V11 H3 Z', 'M11 5 H17 V15 H11 Z'] },
  // Colours: one colour; several, drawn as a fill, an outline and a hatch.
  'colour-off': { fills: ['M5 5 H15 V15 H5 Z'] },
  'colour-on': { strokes: ['M12 4 H17 V9 H12 Z', 'M7 11 H13 V17 H7 Z', 'M7 14 L10 11 M7 17 L13 11 M10 17 L13 14'], fills: ['M2 3 H9 V10 H2 Z'] },
  // Who stacks it: a person; a person with a set square; a robot arm.
  person: { strokes: ['M10 7 V12', 'M6 11 L10 7 L14 11', 'M10 12 L7 15 V18 M10 12 L13 15 V18'], fills: [disc(10, 4, 2)] },
  template: { strokes: ['M6 7 V12', 'M3 11 L6 8 L9 11', 'M6 12 L4 14 V18 M6 12 L8 14 V18', 'M10 17 H17 V10 Z'], fills: [disc(6, 4, 2)] },
  robot: { strokes: ['M3 17 H11', 'M7 17 V13', 'M7 13 L12 8 H15', 'M15 6 V10 M15 6 H17 M15 10 H17'], fills: [disc(7, 13, 2), disc(12, 8, 2)] },
});

const ARGS = { M: 2, L: 2, H: 1, V: 1, A: 7, Z: 0 };

// A path read into its segments: lines and arcs, in grid units.
export function parsePath(d) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) || [];
  const segments = [];
  let at = null;
  let start = null;
  let i = 0;
  const number = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const command = tokens[i++];
    if (!(command in ARGS)) throw new Error(`command ${command} is not one of M, L, H, V, A, Z`);
    let first = true;
    do {
      if (command === 'M' && first) {
        at = [number(), number()];
        start = at;
      } else if (command === 'M' || command === 'L') {
        const to = [number(), number()];
        segments.push({ type: 'line', from: at, to });
        at = to;
      } else if (command === 'H' || command === 'V') {
        const v = number();
        const to = command === 'H' ? [v, at[1]] : [at[0], v];
        segments.push({ type: 'line', from: at, to });
        at = to;
      } else if (command === 'A') {
        const r = [number(), number()];
        const rotation = number();
        number();
        number();
        const to = [number(), number()];
        segments.push({ type: 'arc', from: at, to, r, rotation });
        at = to;
      } else if (command === 'Z') {
        if (at[0] !== start[0] || at[1] !== start[1]) segments.push({ type: 'line', from: at, to: start });
        at = start;
      }
      first = false;
    } while (ARGS[command] > 0 && i < tokens.length && !/[A-Za-z]/.test(tokens[i]));
  }
  return segments;
}
