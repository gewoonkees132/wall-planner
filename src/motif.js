// The presets (design, part 7): patterns are tiles of type numbers that
// repeat; images give a value from 0 to 1 over the whole wall.
// Pure: no browser objects.

import { TEXTS } from './texts.js';

export const PATTERN_PRESETS = Object.freeze(['bands', 'chequer', 'diamond']);
export const IMAGE_PRESETS = Object.freeze(['gradient', 'wave', 'digit']);

// The motif's kind follows the preset: an image covers the whole wall, a
// pattern repeats along it.
export const isImage = (preset) => IMAGE_PRESETS.includes(preset);

// One digit, 0 to 9, in a font of 5 by 7 cells drawn in code. Row 0 is
// the top row; "1" is on the digit.
export const DIGIT_FONT = Object.freeze({
  0: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
});
export const DIGIT_ROWS = 7;
export const DIGIT_COLUMNS = 5;

function grid(rows, columns, cell) {
  return Array.from({ length: rows }, (_, i) => Array.from({ length: columns }, (__, j) => cell(i, j)));
}

// A tile's rows are courses, from course 1 up; its columns are cells (6.3).
export function presetTile(name, k) {
  switch (name) {
    case 'bands':
      // 8 columns, 2k rows: bands two courses high, through all types in turn.
      return grid(2 * k, 8, (i) => Math.floor(i / 2));
    case 'chequer':
      // 2k by 2k: squares of two units by two courses.
      return grid(2 * k, 2 * k, (i, j) => (Math.floor(i / 2) + Math.floor(j / 2)) % k);
    case 'diamond':
      // 8 by 8: concentric diamonds, the same in every direction from the middle.
      return grid(8, 8, (i, j) => Math.floor(Math.abs(i - 3.5) + Math.abs(j - 3.5)) % k);
    default:
      throw new RangeError(`no pattern preset ${name}`);
  }
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// The digit fills the earth courses in height: its 7 rows spread over the
// n courses. Its columns keep the font's proportion in unit cells: at 7
// courses one column is one cell of the bond, p wide. It is centred along
// the wall, its left edge moved by less than a quarter block so that the
// cells of both kinds of course fall inside its columns. Seen from the
// front, the start end is on the right, so the digit is laid from the
// right: its first column lies furthest along the line.
function digitImage({ lambda, p, n, digit }) {
  if (n < DIGIT_ROWS) return { refused: true, message: TEXTS.pattern.digitTooFew };
  const glyph = DIGIT_FONT[digit] ?? DIGIT_FONT[7];
  const column = (p * n) / DIGIT_ROWS;
  const quarter = p / 4;
  const centred = (lambda - DIGIT_COLUMNS * column) / 2;
  const left = (2 * Math.round((centred / quarter - 1) / 2) + 1) * quarter;
  return {
    refused: false,
    value: ({ x, y }) => {
      const c = DIGIT_COLUMNS - 1 - Math.floor((x - left) / column);
      if (c < 0 || c >= DIGIT_COLUMNS) return 0;
      const r = Math.min(DIGIT_ROWS - 1, Math.max(0, Math.floor((1 - y) * DIGIT_ROWS)));
      return glyph[r][c] === '1' ? 1 : 0;
    },
  };
}

// An image as a function of u, the share along the line, y, the height
// share of the course, and x, the place along the line in metres.
export function imageFunction(name, context = {}) {
  switch (name) {
    case 'digit':
      // v = 1 on the digit and 0 elsewhere; it needs at least 7 earth courses.
      return digitImage(context);
    case 'gradient':
      // Darkest at the bottom, lightest at the top.
      return { refused: false, value: ({ y }) => y };
    case 'wave':
      // Bands that rise and fall one and a half times along the wall.
      return { refused: false, value: ({ u, y }) => clamp01(y + 0.2 * Math.sin(3 * Math.PI * u)) };
    default:
      throw new RangeError(`no image preset ${name}`);
  }
}
