// The wall the page shows (design, part 4 and 6.5). When the base line is
// red, the 3D view, the counts, the plan file and the address keep the last
// wall that fits. Pure: no browser objects.

import { computeWall } from './plan.js';
import { straightPoints, encodeState } from './state.js';

// A state read from an address: its own wall when it fits. Otherwise there
// is no earlier wall to keep, so the same choices on a straight line of the
// state's length.
export function openFitting(state) {
  const wall = computeWall(state);
  if (wall.ok) return { state, wall };
  const straight = { ...state, points: straightPoints(state.length), corners: [] };
  return { state: straight, wall: computeWall(straight) };
}

// After a change: the new wall when it fits; else the new choices on the
// last line that fitted; else the last wall that fits, as it was. While a
// drag keeps the line red, the choices do not change, so the same wall
// stays and nothing is drawn again.
export function nextFitting(state, wall, fitting) {
  if (wall.ok) return { state, wall };
  const kept = { ...state, points: fitting.state.points };
  if (encodeState(kept) === encodeState(fitting.state)) return fitting;
  const keptWall = computeWall(kept);
  return keptWall.ok ? { state: kept, wall: keptWall } : fitting;
}

// "Showing the last wall that fits ... or press Undo" (design, part 10)
// shows after a release with a red line, and only when Undo has something
// to return to: a red line opened from an address has nothing to undo.
export function showsAfterRelease({ wallOk, dragging, canUndo }) {
  return !wallOk && !dragging && canUndo;
}
