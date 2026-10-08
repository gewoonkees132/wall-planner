// Words in the base line drawing never meet (pass 2 of the Aicher loop,
// docs/specs/configurator-demonstrator-ux-aicher.md, part 10). Each word
// has places to try, in order of preference; it takes the first that meets
// no other word, no point and no stretch of the line, and keeps inside the
// drawing. A word with no such place is left out: the band beside the line
// still marks the front, and the green point the start. Pure: no browser
// objects; boxes are { x0, y0, x1, y1 } in the drawing's pixels, y down.

// The width of a word at a size, from the system sans: 0.46 of the size per
// letter, measured at 13 px on Windows (5.4 px a letter) with a margin.
const LETTER = 0.46;

// The box of a text whose baseline starts, ends or is centred at x, y.
export function textBox(text, x, y, { size = 13, anchor = 'start' } = {}) {
  const width = text.length * size * LETTER;
  const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  return { x0, x1: x0 + width, y0: y - size, y1: y + size * 0.25 };
}

export const boxAround = (x, y, half) => ({ x0: x - half, x1: x + half, y0: y - half, y1: y + half });

// Two boxes meet when they are closer than gap.
export const meets = (a, b, gap = 2) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

export const within = (box, width, height, edge = 2) => box.x0 >= edge && box.y0 >= edge && box.x1 <= width - edge && box.y1 <= height - edge;

// Places round a point, nearest first: from a direction, then the
// directions beside it, then the ones across. A vector (vx, vy) in the
// drawing's pixels; distance in px; rotated 0, 45, -45, 90, -90, 135, -135
// and 180 degrees. The word's baseline is shifted 4 px down so its middle
// stands at the place.
export function ringAround(x, y, [vx, vy], distance, turns = [0, 45, -45, 90, -90, 135, -135, 180]) {
  const length = Math.hypot(vx, vy) || 1;
  return turns.map((degrees) => {
    const a = (degrees * Math.PI) / 180;
    const dx = (vx * Math.cos(a) - vy * Math.sin(a)) / length;
    const dy = (vx * Math.sin(a) + vy * Math.cos(a)) / length;
    return { x: x + dx * distance, y: y + dy * distance + 4 };
  });
}

// Boxes along a drawn stretch: one every step px, so no word sits on a line.
export function lineBoxes(screenPoints, half = 5, step = 8) {
  const boxes = [];
  let last = null;
  for (const [x, y] of screenPoints) {
    if (last && Math.hypot(x - last[0], y - last[1]) < step) continue;
    boxes.push(boxAround(x, y, half));
    last = [x, y];
  }
  return boxes;
}

// The first candidate whose box meets no obstacle and lies inside the
// drawing, or null. A candidate is { x, y, box, ... }.
export function place(candidates, obstacles, width, height) {
  for (const candidate of candidates) {
    if (!within(candidate.box, width, height)) continue;
    if (obstacles.some((o) => meets(candidate.box, o))) continue;
    return candidate;
  }
  return null;
}
