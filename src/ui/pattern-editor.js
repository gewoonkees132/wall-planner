// The tile editor and the motif previews (design, part 7 and 6.3;
// revision 1, part 7). The editor shows one repeat of the tile, cells in
// their true proportion, laid in the running bond as the wall lays them
// (tilegrid.js); a tap cycles a cell. A preview draws one repeat of a
// pattern, or the units of a sample wall for an image, read only. Both
// are drawn as seen from the front, as the 3D view shows the wall: the
// start end on the right.

import { el, svg, svgPoint, key } from './dom.js';
import { LETTERS, PATTERN_ANGLES } from '../block.js';
import { shade } from '../colour.js';
import { angleOfNumber, colourOfNumber } from '../mapping.js';
import { cellSpans, cellAt, moveCell } from '../tilegrid.js';
import { PALETTE, inkOn } from '../palette.js';

const { ink: INK, green: CHOSEN, rule: RULE, paper: PAPER } = PALETTE;

// The fill of a cell: its colour with colours on, else a shade of the one
// colour for depth (darker for deeper), else the one colour. A preview
// shades every level, so the motif reads at a small size.
export function fillOf(number, model) {
  if (model.colour) return model.colours[colourOfNumber(number, model.types, model.colours.length)] ?? model.colours[0];
  if (model.vary === 'depth' || model.preview) {
    const k = model.types;
    return shade(model.oneColour, 1 - (0.45 * number) / Math.max(1, k - 1));
  }
  return model.oneColour;
}

// A short line at an angle, in degrees counterclockwise, through (cx, cy).
function angleLine(cx, cy, half, degrees, colour) {
  const a = (degrees * Math.PI) / 180;
  const dx = half * Math.cos(a);
  const dy = half * Math.sin(a);
  return svg('line', {
    x1: cx - dx, y1: cy + dy, x2: cx + dx, y2: cy - dy,
    stroke: colour, 'stroke-width': 2, 'stroke-linecap': 'round',
  });
}

// The mark on a cell: its angle for Turn, in the ink or the paper, whichever
// stands out more on the cell; its letter otherwise, on a chip of paper.
function cellMark(x, y, span, ch, number, fill, model, withLetters) {
  if (model.vary === 'rotation') {
    return angleLine(x + span / 2, y + ch / 2, span * 0.4, -angleOfNumber(number, model.types), inkOn(fill));
  }
  if (!withLetters) return null;
  // A letter stands on a chip of 16 px, in 13 px type; a cell too small for the chip has no letter.
  const side = Math.min(16, ch - 2, span - 2);
  if (side < 16) return null;
  const cx = x + span / 2;
  const cy = y + ch / 2;
  return svg('g', { 'pointer-events': 'none', 'aria-hidden': 'true' },
    svg('rect', { x: cx - side / 2, y: cy - side / 2, width: side, height: side, fill: PAPER }),
    svg('text', {
      x: cx, y: cy, fill: INK, 'font-size': 13, 'text-anchor': 'middle', 'dominant-baseline': 'central',
    }, LETTERS[number] ?? ''));
}

// One repeat of a tile, at a width, into an SVG. Returns the cell geometry.
export function drawTile(drawing, model, width, { withLetters = true, focus = null, keys = null } = {}) {
  const { tile } = model;
  const t = tile.length;
  const w = tile[0].length;
  const cw = width / w;
  const ch = cw * (model.courseHeight / model.p);
  const height = Math.ceil(ch * t);
  drawing.setAttribute('viewBox', `0 0 ${width} ${height}`);
  drawing.setAttribute('width', width);
  drawing.setAttribute('height', height);
  const nodes = [];
  for (let i = 0; i < t; i++) {
    const y = (t - 1 - i) * ch;
    for (let j = 0; j < w; j++) {
      const number = tile[i][j];
      const fill = fillOf(number, model);
      // Seen from the front the start end is on the right: a place s
      // cells from it lies at width - s * cw.
      cellSpans(i, j, w).forEach(([from, to], part) => {
        const x = width - to * cw;
        const span = (to - from) * cw;
        const named = part === 0 && keys ? { id: `pattern-cell-${i}-${j}`, role: 'img', 'aria-label': keys.cell(i + 1, j + 1, LETTERS[number] ?? '') } : {};
        nodes.push(svg('rect', { x, y, width: span, height: ch, fill, stroke: PAPER, 'stroke-width': 1, ...named }));
        const mark = cellMark(x, y, span, ch, number, fill, model, withLetters);
        if (mark) nodes.push(mark);
      });
    }
  }
  if (focus) {
    for (const [from, to] of cellSpans(focus.i, focus.j, w)) {
      nodes.push(svg('rect', {
        x: width - to * cw + 1.5, y: (t - 1 - focus.i) * ch + 1.5, width: (to - from) * cw - 3, height: ch - 3,
        fill: 'none', stroke: CHOSEN, 'stroke-width': 3, 'pointer-events': 'none',
      }));
    }
  }
  drawing.replaceChildren(...nodes);
  return { cw, ch, t, w, width, height };
}

// The units of a wall, unrolled, at a width, into an SVG: for the image
// previews. Half units show as half cells.
export function drawUnits(drawing, model, width) {
  const scale = width / model.lambda;
  const ch = model.courseHeight * scale;
  const height = Math.max(1, Math.ceil(ch * model.n));
  drawing.setAttribute('viewBox', `0 0 ${width} ${height}`);
  drawing.setAttribute('width', width);
  drawing.setAttribute('height', height);
  const nodes = [svg('rect', { x: 0, y: 0, width, height, fill: RULE })];
  for (const u of model.units) {
    if (u.kind !== 'earth') continue;
    const x = (model.lambda - u.position - u.span / 2) * scale;
    const y = (model.n - u.course) * ch;
    // A preview with colours off shades each block by its value, so the
    // motif reads at a small size.
    const value = u.value ?? (u.number ?? 0) / Math.max(1, model.types - 1);
    const fill = model.colour ? u.colour : shade(model.oneColour, 1 - 0.45 * Math.min(1, Math.max(0, value)));
    const span = Math.max(0.5, u.span * scale - 1);
    nodes.push(svg('rect', { x: x + 0.5, y: y + 0.5, width: span, height: Math.max(0.5, ch - 1), fill }));
    if (model.vary === 'rotation' && u.size === 'full' && ch >= 6) {
      nodes.push(angleLine(x + (u.span * scale) / 2, y + ch / 2, u.span * scale * 0.35, -u.rotationDeg, inkOn(fill)));
    }
  }
  drawing.replaceChildren(...nodes);
  return { height };
}

// A read-only preview: a tile, or a wall's units.
export function createPreview(drawing, width) {
  return {
    update(model) {
      const shown = { ...model, preview: true };
      if (model.tile) drawTile(drawing, shown, width, { withLetters: false });
      else drawUnits(drawing, shown, width);
    },
  };
}

// The tile editor: lives in the Edit cells dialog.
export function createPatternEditor(root, { keys, onTap, onUndo, onReset }) {
  const caption = el('p', { class: 'help pattern-caption' });
  const drawing = svg('svg', { class: 'pattern-grid tappable', role: 'application', tabindex: '0', 'aria-describedby': 'pattern-keys' });
  const keysHint = el('p', { class: 'help keys-hint', id: 'pattern-keys', hidden: true }, keys.pattern);
  // Undo and Reset are the keys of the panel's, a pictogram beside the word.
  const undoText = document.createTextNode('');
  const resetText = document.createTextNode('');
  const undo = key('undo', null, { class: 'bar', onclick: () => onUndo() });
  const reset = key('reset', null, { class: 'bar', onclick: () => onReset() });
  undo.append(undoText);
  reset.append(resetText);
  const buttons = el('div', { class: 'button-row' }, undo, reset);
  root.append(caption, drawing, keysHint, buttons);

  let current = null;
  let cellGeometry = null;
  let focusCell = { i: 0, j: 0 }; // the cell the keyboard works on
  // The root's width, kept from a ResizeObserver, so an update in a frame
  // reads no layout. The dialog is hidden until opened, so the first real
  // width comes with the open.
  let roomWidth = 0;
  new ResizeObserver((entries) => {
    const w = entries[0].contentRect.width;
    if (w > 0 && w !== roomWidth) {
      roomWidth = w;
      if (current) update(current);
    }
  }).observe(root);

  const keyboardFocus = () => document.activeElement === drawing && drawing.matches(':focus-visible');

  drawing.addEventListener('click', (event) => {
    if (!current || !cellGeometry) return;
    const { x, y } = svgPoint(drawing, event);
    const { cw, ch, t, w, width } = cellGeometry;
    // The cell under the point, as the bond lays it, clamped to the tile.
    const i = t - 1 - Math.min(t - 1, Math.max(0, Math.floor(y / ch)));
    focusCell = { i, j: cellAt(i, (width - x) / cw, w) };
    onTap(focusCell.i, focusCell.j);
  });

  // The keyboard path: the arrow keys move the focus cell, Enter or Space
  // cycles it, as a tap does.
  drawing.addEventListener('keydown', (event) => {
    if (!current || !cellGeometry || event.altKey || event.ctrlKey || event.metaKey) return;
    const { t, w } = cellGeometry;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      onTap(focusCell.i, focusCell.j);
      return;
    }
    const next = moveCell(focusCell, event.key, t, w);
    if (!next) return;
    event.preventDefault();
    focusCell = next;
    update(current);
  });
  drawing.addEventListener('focus', () => {
    keysHint.hidden = !keyboardFocus();
    if (current) update(current);
  });
  drawing.addEventListener('blur', () => {
    keysHint.hidden = true;
    if (current) update(current);
  });

  let drawnKey = ''; // what the drawing shows: it is drawn again only when that changes

  function update(model) {
    current = model;
    const width = Math.max(120, Math.floor(roomWidth || 300));
    if (caption.textContent !== model.texts.captionPattern) caption.textContent = model.texts.captionPattern;
    drawing.setAttribute('aria-label', model.texts.captionPattern);
    const t = model.tile.length;
    const w = model.tile[0].length;
    focusCell = { i: Math.min(focusCell.i, t - 1), j: Math.min(focusCell.j, w - 1) };
    const focused = keyboardFocus();
    const key = JSON.stringify([width, model.tile, model.vary, model.colour, model.types, model.colours, model.oneColour, model.p, focusCell, focused]);
    if (key !== drawnKey) {
      drawnKey = key;
      cellGeometry = drawTile(drawing, model, width, { focus: focused ? focusCell : null, keys });
    }
    if (document.activeElement === drawing) drawing.setAttribute('aria-activedescendant', `pattern-cell-${focusCell.i}-${focusCell.j}`);
    else drawing.removeAttribute('aria-activedescendant');
    undoText.data = model.texts.undo;
    resetText.data = model.texts.reset;
    undo.disabled = !model.canUndo;
    reset.disabled = !model.edited;
  }

  return { update };
}
