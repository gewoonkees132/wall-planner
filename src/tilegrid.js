// The pattern editor's drawing (design, part 7): one repeat of the tile as
// the wall lays it. Rows are courses from course 1 up; places are counted
// in cells from the start end. Rows of odd index hold the even courses,
// which start with a half block, so they sit half a cell toward the start
// end, and their cell 0 is split between both ends of the repeat.
// Pure: no browser objects.

// The stretches of a repeat w cells long that tile cell (i, j) covers.
export function cellSpans(i, j, w) {
  if (i % 2 === 0) return [[j, j + 1]];
  if (j === 0) return [[0, 0.5], [w - 0.5, w]];
  return [[j - 0.5, j + 0.5]];
}

// The tile column of row i at a place s cells from the start end.
export function cellAt(i, s, w) {
  const x = Math.min(w - 1e-9, Math.max(0, s));
  if (i % 2 === 0) return Math.floor(x);
  return Math.floor(x + 0.5) % w;
}

// The focus cell after an arrow key, as the drawing shows the tile: rows
// go up, and left goes away from the start end. It stops at the edges.
// Null for any other key.
const CELL_MOVES = Object.freeze({ ArrowLeft: [0, 1], ArrowRight: [0, -1], ArrowUp: [1, 0], ArrowDown: [-1, 0] });

export function moveCell({ i, j }, key, t, w) {
  const move = CELL_MOVES[key];
  if (!move) return null;
  return {
    i: Math.min(t - 1, Math.max(0, i + move[0])),
    j: Math.min(w - 1, Math.max(0, j + move[1])),
  };
}
