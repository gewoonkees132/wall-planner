// What a press on the base line drawing takes (design, part 4): every
// point and ghost handle reacts within 44 by 44 px and the nearest wins;
// else the line within 22 px, where a tap adds a point. The drawing marks
// the target under a mouse before the press, and the cursor says what a
// press will do. Pure: positions come in screen pixels through toScreen.

import { stretchOf } from './line.js';

export const HIT = 22; // px, half of 44 [B, R]

export function hitTarget({ points, ghosts, line, toScreen }, at) {
  let best = null;
  const consider = (target, [sx, sy]) => {
    const dx = Math.abs(sx - at[0]);
    const dy = Math.abs(sy - at[1]);
    if (dx > HIT || dy > HIT) return;
    const d = Math.hypot(dx, dy);
    if (!best || d < best.d) best = { ...target, d };
  };
  points.forEach((p, index) => consider({ type: 'point', index }, toScreen(p)));
  for (const g of ghosts) consider({ type: 'ghost', stretch: g.stretch, plan: g.plan }, g.screen);
  if (best) return best;
  let nearest = null;
  for (let i = 0; i < line.xs.length; i++) {
    const [sx, sy] = toScreen([line.xs[i], line.ys[i]]);
    const d = Math.hypot(sx - at[0], sy - at[1]);
    if (d <= HIT && (!nearest || d < nearest.d)) nearest = { d, i };
  }
  if (!nearest) return null;
  return {
    type: 'line', stretch: stretchOf(line, nearest.i * line.step), plan: [line.xs[nearest.i], line.ys[nearest.i]], d: nearest.d,
  };
}

// Grab over what a press would move, grabbing while it moves, a plus over
// the line where a tap adds a point.
export function cursorFor(target, dragging) {
  if (dragging) return 'grabbing';
  if (!target) return 'default';
  return target.type === 'line' ? 'copy' : 'grab';
}
