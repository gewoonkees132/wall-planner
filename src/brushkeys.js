// The brush from the keyboard (pass 2 of the Aicher loop,
// docs/specs/configurator-demonstrator-ux-aicher.md, part 10): which block
// is picked, and what an arrow key does to the pick. The 3D view takes
// focus; the arrow keys move the pick; Enter or Space turns the picked
// block as a tap does (main.js). Seen from the front the start end of the
// wall is on the right, as in the rest of the page, so the right arrow goes
// toward the start. Pure: no browser objects.

// The blocks a pick can stand on: the earth blocks, not the base course or the cap.
export const earthUnits = (units) => units.filter((u) => u.kind === 'earth');

// A pick is { course, index }; the unit it names, or null if the wall has none there.
export function unitOf(units, picked) {
  if (!picked) return null;
  return units.find((u) => u.course === picked.course && u.index === picked.index) || null;
}

const coursesOf = (units) => [...new Set(units.map((u) => u.course))].sort((a, b) => a - b);

// Where the pick starts: the middle course (the lower of two), at the block
// nearest the wall's middle, which is where a tap on the 3D view lands.
export function startPick(units) {
  if (!units.length) return null;
  const courses = coursesOf(units);
  const course = courses[Math.ceil(courses.length / 2) - 1];
  const length = Math.max(...units.map((u) => u.position + u.span / 2));
  const same = units.filter((u) => u.course === course);
  const unit = same.reduce((best, u) => (Math.abs(u.position - length / 2) < Math.abs(best.position - length / 2) ? u : best));
  return { course: unit.course, index: unit.index };
}

// One key on the 3D view. Returns { picked }, or null for a key the brush
// leaves alone, so Tab still moves on. At an edge the pick stays.
export function pickKey({ units, picked, key }) {
  const unit = unitOf(units, picked);
  if (!unit) return null;
  const same = units.filter((u) => u.course === unit.course);
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    const index = unit.index + (key === 'ArrowLeft' ? 1 : -1);
    const next = same.find((u) => u.index === index);
    return { picked: next ? { course: next.course, index: next.index } : picked };
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const courses = coursesOf(units);
    const at = courses.indexOf(unit.course);
    const course = courses[at + (key === 'ArrowUp' ? 1 : -1)];
    if (course === undefined) return { picked };
    const row = units.filter((u) => u.course === course);
    const nearest = row.reduce((best, u) => (Math.abs(u.position - unit.position) < Math.abs(best.position - unit.position) ? u : best));
    return { picked: { course: nearest.course, index: nearest.index } };
  }
  return null;
}
