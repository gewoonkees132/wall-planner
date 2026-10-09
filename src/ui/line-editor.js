// The drawer (pass 3 of the Aicher loop, docs/specs/configurator-
// demonstrator-ux-aicher.md, part 11.4): the one place where the wall is
// set, drawn like a technical drawing. The plan sets the line, a polyline
// with fillets; the section, in the right track, sets the height in earth
// courses; the foot holds the whole length and Undo. A drag snaps to half
// blocks and right angles (snap.js); every length and radius is a
// dimension on the drawing, and a tap on it, a digit or R opens a field to
// type it (dimensions.js). No modes. Every target reacts within 44 by 44
// px and the nearest wins. A red corner never blocks the drag.
//
// Pass 5 (part 13.1): the foot tells the wall's length, never takes it; the
// grid is the snap's, in the material's unit (grid.js); the sheet holds
// still; a tap picks a point and a tap moves it; Tab walks the numbers; an
// arc has a handle that pulls its radius between its limits (radius.js);
// a tight bend says its room and its need, and Fit makes it fit.

import { el, svg, svgPoint, key, row } from './dom.js';
import { BLOCK, BASE_HEIGHT, CAP_HEIGHT, MAX_WALL_HEIGHT, MAX_LENGTH } from '../block.js';
import { lineKey } from '../linekeys.js';
import { hitTarget, cursorFor, HIT } from '../linehit.js';
import { snapPoint } from '../snap.js';
import { gridStep, scaleLength, gridFrame, toGrid, fromGrid } from '../grid.js';
import { radiusRange, radiusThrough, fitBend } from '../radius.js';
import { cornersOf } from '../fillet.js';
import { frontStrip } from '../floor.js';
import {
  roundStretch, withStretchLength, withCornerRadius, readField, stretchWithin, liftRadius, walkOrder,
} from '../dimensions.js';
import { PALETTE, TYPE } from '../palette.js';
import { fixed } from '../texts.js';
import { textBox, boxAround, lineBoxes, place, ringAround, meets, within } from '../labels.js';

const POINT_RADIUS = 7; // a disc of 14 px [R]
const GHOST_RADIUS = 4; // a hollow disc of 8 px, placeholder
const MIN_STRETCH = 88; // px on screen [R]
const MAX_POINTS = 10; // [R]
const MARGIN = 0.5; // m, placeholder
const TAP = 4; // px: a press that moves less is a tap (pass 5), placeholder
const HANDLE = 5; // px, half the diagonal of an arc's handle (pass 5)
// The drawing's words stand in its top 52 px (three lines of 16, the keys
// hint) and its bottom 24 px (the scale, the bend); the line and its band
// (16 px) are fitted between, so no word meets them.
const PAD_TOP = 68; // px
const PAD_BOTTOM = 24; // px
const HINT_LINE = 16; // px
const ROW = 44; // px, a key
const GAP = 8; // px, the gap between keys
const LABEL = 72; // px, the label track
const FIELD_WIDTH = 72; // px, a dimension's field
const COURSE_DRAG = 8; // px of drag per course, at least
const { ink: INK, green: CHOSEN, red: RED, rule: RULE, grey: GREY, paper: PAPER } = PALETTE;
const CAPTION = TYPE[0]; // px, the drawing's words
const LABEL_LINE = 16; // px, the section's name over its keys (pass 4)
const ZONE = 24; // px, half of a dimension's target, at least 44 by 44 (pass 4)

export function createLineEditor(root, { texts, keys, onEdit }) {
  const drawing = svg('svg', {
    class: 'line-drawing', tabindex: '0', role: 'application',
    'aria-label': texts.baseLineCaption, 'aria-describedby': 'line-keys',
  });
  // The section's keys and its field stand in the right track, over the drawing's column.
  // Pass 4 (part 12.1, rule 12): the track is named and its keys say their words.
  const more = key('plus', texts.more, { class: 'step', 'aria-label': `${texts.coursesLabel}: more`, onclick: () => stepCourses(1) });
  const less = key('minus', texts.less, { class: 'step', 'aria-label': `${texts.coursesLabel}: less`, onclick: () => stepCourses(-1) });
  const coursesField = el('input', {
    class: 'value-input courses-field', type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false',
    'aria-label': texts.coursesLabel,
  });
  const sectionSvg = svg('svg', { class: 'line-drawing section-drawing', 'aria-hidden': 'true' });
  const column = el('div', { class: 'section-keys' }, el('span', { class: 'section-label', 'aria-hidden': 'true' }, texts.coursesCaption), more, sectionSvg, el('div', { class: 'value' }, coursesField), less);
  const dimField = el('input', {
    class: 'value-input dimension-field', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', hidden: true,
  });
  const area = el('div', { class: 'line-area' }, drawing, column, dimField);
  // A screen reader hears the drawing's words from these lines, which take no room.
  const readout = el('p', { class: 'readout' });
  const keysHint = el('p', { class: 'keys-hint', id: 'line-keys', hidden: true }, keys.line);
  const status = el('p', { class: 'message', role: 'status' });
  // Pass 5 (part 13.1, rule 1): the wall's length, told and never typed:
  // the effect of the drawing, as the plan file has it.
  const told = el('output', { id: 'told-length', class: 'told', 'aria-label': texts.lengthLabel, 'aria-live': 'off' });
  const fitKey = key('fit', texts.fit, { class: 'fit-key', hidden: true, onclick: () => fitNow() });
  const undo = key('undo', texts.undo, { class: 'undo-key', onclick: () => onEdit({ type: 'undo' }) });
  const removeKey = key('remove-point', texts.remove, { class: 'remove-key', hidden: true, onclick: () => removePicked() });
  root.classList.add('line-editor', 'drawer');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', texts.drawerLabel);
  root.append(area, el('div', { class: 'sr-only' }, readout, status, keysHint),
    row(texts.lengthLabel, [told, fitKey, undo, removeKey], { id: 'told-length', cls: 'line-row' }));

  let model = null;
  let view = null; // screen = (ox + x * scale, oy - y * scale)
  let width = 300;
  let height = 180;
  let planWidth = 220;
  let drag = null; // { index, pointerId, points, corners }, or { courses, pointerId, y }
  let selected = 0;
  let flash = '';
  let keyPoints = null; // the points of an arrow-key move, from its first press to its release
  // The points of the last key, until a drawing of the wall brings them back:
  // a key applies to these, not to the points of the last drawing.
  let latest = null;
  let hover = null;
  let releasedAt = null;
  let editing = null; // { kind, index, shown, byKey }: the dimension being typed
  let quiet = false; // the focus comes back from a field opened by a tap
  let dims = []; // the dimensions drawn: { kind, index, box }
  // Pass 5 (part 13.1).
  let armed = false; // the picked point was picked by a tap: a tap where nothing is moves it
  let fieldHint = null; // the hint lines while a corner's field is open
  let grid = null; // { frame, step, scale }: the grid, the snap's step and the scale, set with the view
  let forceFit = false; // a new wall from outside: fit it
  let press = null; // a press where nothing is, until it is let go
  let arcs = []; // the arcs' handles drawn: { index, screen }
  let fix = null; // what Fit would make of a tight bend
  let robotBand = []; // the robot's stretches of the band, on screen: the numbers keep off them
  let roomWidth = 300;
  let roomHeight = 180;
  new ResizeObserver((entries) => {
    const { width: w, height: h } = entries[0].contentRect;
    roomWidth = w || roomWidth;
    roomHeight = h || roomHeight;
    if (model) update(model);
  }).observe(area);

  const current = () => keyPoints || latest || model.points;
  const currentCorners = () => (latest && latest.corners) || model.corners;
  const toScreen = ([x, y]) => [view.ox + x * view.scale, view.oy - y * view.scale];
  const toPlan = ([sx, sy]) => [(sx - view.ox) / view.scale, (view.oy - sy) / view.scale];
  // The section's own drawing, between the keys of the right track, with
  // room above the wall for its height.
  let sectionWidth = 58;
  let sectionHeight = 24;
  const SECTION_TOP = 20; // px

  function fitView() {
    const { line, points } = model;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const take = (x, y) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    };
    for (let i = 0; i < line.xs.length; i += 4) take(line.xs[i], line.ys[i]);
    for (const [x, y] of points) take(x, y);
    minX -= MARGIN;
    maxX += MARGIN;
    const room = Math.max(40, height - PAD_TOP - PAD_BOTTOM);
    const scale = Math.min(planWidth / (maxX - minX), room / Math.max(maxY - minY + 0.4, 0.3));
    view = {
      scale,
      ox: planWidth / 2 - ((minX + maxX) / 2) * scale,
      oy: PAD_TOP + room / 2 + ((minY + maxY) / 2) * scale,
    };
    // Pass 5 (part 13.1, rule 3): the grid is set with the view, so it holds still with it.
    const step = gridStep(scale);
    grid = { frame: gridFrame(points), step, scale: scaleLength(step, scale) };
  }

  // Pass 5 (part 13.1, rule 4): the sheet holds still. After an edit it is
  // fitted again only when the line leaves the room kept for it, or fills
  // less than a quarter of that room both ways.
  function outOfRoom() {
    const { line, points } = model;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const take = ([sx, sy]) => {
      x0 = Math.min(x0, sx);
      x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy);
      y1 = Math.max(y1, sy);
    };
    for (let i = 0; i < line.xs.length; i += 4) take(toScreen([line.xs[i], line.ys[i]]));
    points.forEach((p) => take(toScreen(p)));
    const top = PAD_TOP - 16;
    const bottom = height - PAD_BOTTOM;
    if (x0 < POINT_RADIUS || x1 > planWidth - POINT_RADIUS || y0 < top || y1 > bottom) return true;
    return x1 - x0 < planWidth / 4 && y1 - y0 < (bottom - top) / 4;
  }

  // A ghost handle at the middle of each stretch long enough on screen.
  function ghosts() {
    const { points } = model;
    if (points.length >= MAX_POINTS) return [];
    const out = [];
    for (let k = 0; k + 1 < points.length; k++) {
      const a = toScreen(points[k]);
      const b = toScreen(points[k + 1]);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_STRETCH) continue;
      const plan = [(points[k][0] + points[k + 1][0]) / 2, (points[k][1] + points[k + 1][1]) / 2];
      out.push({ stretch: k, plan, screen: toScreen(plan) });
    }
    return out;
  }

  function hitTest(at) {
    return hitTarget({ points: model.points, ghosts: ghosts(), arcs, line: model.line, toScreen }, at);
  }

  // What a press takes (pass 4, rule 10; pass 5, rule 7): inside a
  // number's 44 px it wins over the line and the ghost handles; between a
  // number, a point and an arc's handle the nearest wins.
  function targetAt(at) {
    const t = hitTest(at);
    const d = dimAt(at);
    if (d && (!t || t.type === 'ghost' || t.type === 'line' || t.d >= d.dist)) return { type: 'dim', kind: d.kind, index: d.index };
    return t;
  }

  function setCursor() {
    drawing.style.cursor = cursorFor(hover, Boolean(drag));
  }

  const send = (type, points, corners) => onEdit({ type, points: points.map((p) => p.slice()), corners: corners.slice() });

  // The height: a key, a typed number, or a drag on the section.
  function stepCourses(sign) {
    flash = '';
    onEdit({ type: 'courses', value: model.courses + sign });
  }
  function typedCourses() {
    const read = readField(coursesField.value, '');
    const n = Math.round(read.value ?? NaN);
    flash = '';
    if (Number.isFinite(n) && n !== model.courses) onEdit({ type: 'courses', value: n });
    else update(model);
  }
  coursesField.addEventListener('change', typedCourses);
  coursesField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      typedCourses();
    }
  });

  // Where a dimension's field stands: on its number, or where its number would be.
  function fieldBox(kind, index) {
    const d = dims.find((x) => x.kind === kind && x.index === index && x.text);
    let at;
    if (d) at = [(d.box.x0 + d.box.x1) / 2, (d.box.y0 + d.box.y1) / 2];
    else if (kind === 'radius') at = toScreen(model.points[index]);
    else at = toScreen([(model.points[index][0] + model.points[index + 1][0]) / 2, (model.points[index][1] + model.points[index + 1][1]) / 2]);
    const x0 = Math.round(Math.min(Math.max(0, at[0] - FIELD_WIDTH / 2), planWidth - FIELD_WIDTH));
    const y0 = Math.round(Math.min(Math.max(0, at[1] - ROW / 2), height - ROW));
    return { x0, x1: x0 + FIELD_WIDTH, y0, y1: y0 + ROW };
  }

  // A dimension's field: opened on the dimension, by a tap, a digit, R or Tab.
  function openField(kind, index, initial = null, byKey = false) {
    armed = false;
    dimField.setAttribute('aria-label', kind === 'length' ? texts.stretchField(index + 1) : texts.cornerField(index + 1));
    // The number as the drawing says it, a corner's as it is set: a field
    // left so changes nothing (pass 4, rule 6; pass 5, rule 7).
    let shown;
    fieldHint = null;
    if (kind === 'length') {
      shown = fixed(stretchLength(index), 2);
    } else {
      const range = radiusRange(model.points, model.corners, index, model.minimum);
      const set = range && range.kind === 'round' ? range.set : range ? range.drawn : 0;
      shown = fixed(Number.isFinite(set) ? set : 0, 2);
      if (range && range.max < range.min) fieldHint = [texts.noRoom(range.max)];
      else if (range) {
        fieldHint = [texts.radiusRange(range.min, range.max)];
        if (range.kind === 'round' && range.drawn < range.set - 0.005) fieldHint.unshift(texts.radiusSet(range.set, range.drawn));
      }
    }
    editing = { kind, index, shown, byKey: initial !== null || byKey };
    const box = fieldBox(kind, index);
    dimField.style.left = `${box.x0}px`;
    dimField.style.top = `${box.y0}px`;
    dimField.value = initial ?? shown;
    dimField.hidden = false;
    dimField.focus();
    if (initial === null) dimField.select();
    else dimField.setSelectionRange(dimField.value.length, dimField.value.length);
    draw();
  }
  const stretchLength = (k) => Math.hypot(model.points[k + 1][0] - model.points[k][0], model.points[k + 1][1] - model.points[k][1]);

  function closeField(apply, refocus) {
    if (!editing) return;
    const { kind, index, shown, byKey } = editing;
    editing = null;
    fieldHint = null;
    // Back from a field opened by a tap, the drawing takes the focus without the keys hint, so no word moves.
    quiet = !byKey;
    dimField.hidden = true;
    // Only what was typed applies; the hint line says what was not taken (pass 4, part 12.1, rules 6 and 7).
    const read = apply ? readField(dimField.value, shown) : { unchanged: true };
    const points = model.points.map((p) => p.slice());
    if (read.notNumber || (read.value !== undefined && read.value < 0)) {
      flash = texts.notNumber;
      draw();
    } else if (read.value !== undefined && kind === 'length') {
      const { value: rounded, rounded: changed } = roundStretch(read.value);
      const within = stretchWithin(points, index, rounded, MAX_LENGTH);
      if (!within) {
        flash = texts.outOfRange;
        draw();
      } else {
        flash = within.cut ? texts.outOfRange : changed ? texts.rounded(within.length) : '';
        send('replace', withStretchLength(points, index, within.length), model.corners);
      }
    } else if (read.value !== undefined) {
      // Under the minimum it is lifted to it; where the overlap rule scales
      // it, the hint says the radius drawn (pass 5, part 13.1, rule 7).
      const { value, lifted } = liftRadius(read.value, model.minimum);
      const corners = withCornerRadius(model.corners, index, value);
      const drawn = value > 0 ? cornersOf(points, corners).corners[index - 1] : null;
      flash = lifted ? texts.lifted(value) : drawn && drawn.radius < value - 0.005 ? texts.scaledTo(drawn.radius) : '';
      send('replace', points, corners);
    } else {
      draw();
    }
    if (refocus) drawing.focus();
    quiet = false;
  }
  dimField.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && editing) {
      // Pass 5 (part 13.1, rule 6): Tab walks the numbers along the line.
      const order = walkOrder(model.line.corners, model.points.length - 1);
      const at = order.findIndex((o) => o.kind === editing.kind && o.index === editing.index);
      const next = order[at + (event.shiftKey ? -1 : 1)];
      if (!next && !event.shiftKey) return;
      event.preventDefault();
      closeField(true, !next);
      if (next) openField(next.kind, next.index, null, true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      closeField(true, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeField(false, true);
    }
  });
  dimField.addEventListener('blur', () => closeField(true, false));

  // The dimension under a press, its words or the square mark of a corner:
  // a target of 44 by 44 px at least round its number (pass 4, part 12.1,
  // rule 10). Inside it a number wins over the line and the ghost handles;
  // between a point and a number the nearer wins.
  const dimAt = ([x, y]) => {
    let best = null;
    for (const d of dims) {
      const cx = (d.box.x0 + d.box.x1) / 2;
      const cy = (d.box.y0 + d.box.y1) / 2;
      if (Math.abs(x - cx) > Math.max(ZONE, (d.box.x1 - d.box.x0) / 2 + 4) || Math.abs(y - cy) > Math.max(ZONE, (d.box.y1 - d.box.y0) / 2 + 4)) continue;
      const dist = Math.hypot(x - cx, y - cy);
      if (!best || dist < best.dist) best = { ...d, dist };
    }
    return best;
  };

  drawing.addEventListener('pointerdown', (event) => {
    if (!model || !view || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const local = svgPoint(drawing, event);
    const at = [local.x, local.y];
    const target = targetAt(at);
    if (target && target.type === 'dim') {
      event.preventDefault();
      openField(target.kind, target.index);
      return;
    }
    if (!target) {
      // A press where nothing is: let go there, it moves the picked point (pass 5, rule 5).
      press = armed ? { pointerId: event.pointerId, at } : null;
      return;
    }
    event.preventDefault();
    const points = current().map((p) => p.slice());
    const corners = currentCorners().slice();
    latest = null;
    flash = '';
    hover = null;
    if (target.type === 'arc') {
      // The arc's handle pulls its radius between its limits (pass 5, rule 7).
      armed = false;
      drag = { arc: target.index, range: radiusRange(points, corners, target.index, model.minimum), pointerId: event.pointerId, points, corners, at, moved: false };
      setCursor();
      drawing.setPointerCapture(event.pointerId);
      onEdit({ type: 'begin' });
      draw();
      return;
    }
    let index;
    if (target.type === 'point') {
      index = target.index;
    } else {
      if (points.length >= MAX_POINTS) {
        flash = texts.mostPoints;
        draw();
        return;
      }
      index = target.stretch + 1;
      points.splice(index, 0, target.plan.slice());
      corners.splice(index - 1, 0, null);
    }
    const picked = armed && selected === index;
    if (target.type !== 'point' || !picked) armed = false;
    selected = index;
    drag = { index, pointerId: event.pointerId, points, corners, at, moved: target.type !== 'point', picked };
    setCursor();
    drawing.setPointerCapture(event.pointerId);
    onEdit({ type: 'begin' });
    if (target.type !== 'point') send('move', points, corners);
    else draw();
  });
  drawing.addEventListener('pointerup', (event) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const { at } = press;
    press = null;
    const local = svgPoint(drawing, event);
    if (armed && Math.hypot(local.x - at[0], local.y - at[1]) < 2 * TAP) movePicked(toPlan(at));
  });

  // Pass 5 (part 13.1, rule 5): the picked point goes where a tap lands,
  // snapped as a drag is; one step, one Undo.
  function movePicked(target) {
    const points = current().map((p) => p.slice());
    const i = Math.min(selected, points.length - 1);
    const next = snapPoint(points, i, target, grid.step, grid.frame);
    if (Math.hypot(next[0] - points[i][0], next[1] - points[i][1]) < 1e-6) return;
    points[i] = next;
    flash = '';
    send('replace', points, currentCorners());
  }

  // The Remove key: the picked inner point goes, as Delete takes it.
  function removePicked() {
    const points = current();
    const at = Math.min(selected, points.length - 1);
    if (at <= 0 || at >= points.length - 1) return;
    const result = lineKey({ points, corners: currentCorners(), picked: at, key: 'Delete' });
    armed = false;
    flash = '';
    selected = result.picked;
    send('replace', result.points, result.corners);
  }

  // The Fit key: one step from a tight bend to a wall that fits (pass 5, rule 8).
  function fitNow() {
    if (!fix) return;
    armed = false;
    flash = '';
    send('replace', fix.points, fix.corners);
  }

  drawing.addEventListener('pointermove', (event) => {
    if (!drag && model && view && event.pointerType !== 'touch') {
      const local = svgPoint(drawing, event);
      const onNumber = local.x < planWidth && Boolean(dimAt([local.x, local.y]));
      const next = local.x < planWidth && !onNumber ? hitTest([local.x, local.y]) : null;
      if (onNumber) {
        hover = null;
        drawing.style.cursor = 'text';
        draw();
        return;
      }
      const same = (a, b) => (!a && !b) || (a && b && a.type === b.type && a.index === b.index && a.stretch === b.stretch
        && (a.type !== 'line' || (a.plan[0] === b.plan[0] && a.plan[1] === b.plan[1])));
      if (!same(hover, next)) {
        hover = next;
        setCursor();
        draw();
      }
      return;
    }
    if (!drag || event.pointerId !== drag.pointerId) return;
    const local = svgPoint(drawing, event);
    if ('courses' in drag) return;
    // A press that moves less than a tap's few pixels moves nothing (pass 5).
    if (!drag.moved && Math.hypot(local.x - drag.at[0], local.y - drag.at[1]) < TAP) return;
    if (!drag.moved) {
      drag.moved = true;
      armed = false;
    }
    if ('arc' in drag) {
      const { range } = drag;
      if (!range || range.max < range.min) return;
      const radius = Math.min(range.max, Math.max(range.min, radiusThrough(drag.points, drag.arc, toPlan([local.x, local.y]))));
      drag.corners[drag.arc - 1] = Math.round(radius * 100) / 100;
      send('move', drag.points, drag.corners);
      return;
    }
    drag.points[drag.index] = snapPoint(drag.points, drag.index, toPlan([local.x, local.y]), grid.step, grid.frame);
    send('move', drag.points, drag.corners);
  });

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const ended = drag;
    drag = null;
    if ('courses' in ended) {
      onEdit({ type: 'end', courses: ended.value });
      return;
    }
    if ('arc' in ended) {
      setCursor();
      send('end', ended.points, ended.corners);
      // A tap on the handle opens the corner's field (pass 5, rule 7).
      if (!ended.moved) openField('radius', ended.arc);
      return;
    }
    let { points, corners } = ended;
    // A tap on a point picks it, or lets the picked one go (pass 5, rule 5).
    if (!ended.moved) armed = !ended.picked;
    // A point dropped on its neighbour joins it: the inner one of the two goes.
    const i = ended.index;
    const [sx, sy] = toScreen(points[i]);
    for (const j of ended.moved ? [i - 1, i + 1] : []) {
      if (j < 0 || j >= points.length || points.length <= 2) continue;
      const [nx, ny] = toScreen(points[j]);
      if (Math.hypot(nx - sx, ny - sy) > HIT) continue;
      const gone = i > 0 && i < points.length - 1 ? i : j;
      if (gone === 0 || gone === points.length - 1) continue;
      points = points.filter((_, k) => k !== gone);
      corners = corners.filter((_, k) => k !== gone - 1);
      if (gone !== i) points[gone < i ? i - 1 : i] = ended.points[i];
      selected = Math.min(selected, points.length - 1);
      break;
    }
    if (event.pointerType !== 'touch' && event.type === 'pointerup') {
      const local = svgPoint(drawing, event);
      releasedAt = [local.x, local.y];
    }
    setCursor();
    send('end', points, corners);
  }
  // The height by a drag on the section: whole courses, one per 8 px at least.
  sectionSvg.addEventListener('pointerdown', (event) => {
    if (!model || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    flash = '';
    drag = { courses: model.courses, pointerId: event.pointerId, y: event.clientY, value: model.courses };
    sectionSvg.setPointerCapture(event.pointerId);
    onEdit({ type: 'begin' });
  });
  sectionSvg.addEventListener('pointermove', (event) => {
    if (!drag || !('courses' in drag) || event.pointerId !== drag.pointerId) return;
    const per = Math.max(COURSE_DRAG, BLOCK.height * sectionScale());
    const value = drag.courses + Math.round((drag.y - event.clientY) / per);
    if (value !== drag.value) {
      drag.value = value;
      onEdit({ type: 'move', courses: value });
    }
  });
  sectionSvg.addEventListener('pointerup', endDrag);
  sectionSvg.addEventListener('pointercancel', endDrag);
  drawing.addEventListener('pointerup', endDrag);
  drawing.addEventListener('pointercancel', endDrag);
  drawing.addEventListener('pointerleave', () => {
    if (drag || !hover) return;
    hover = null;
    setCursor();
    draw();
  });

  // The keyboard path. An arrow key held or pressed is one edit, ended when
  // it is let go; Enter and Delete are one edit each; a digit or R opens a field.
  drawing.addEventListener('keydown', (event) => {
    if (!model || drag || event.altKey || event.ctrlKey || event.metaKey) return;
    const n = model.points.length;
    const at = Math.min(selected, n - 1);
    // Escape lets a picked point go (pass 5, rule 5).
    if (event.key === 'Escape' && armed) {
      event.preventDefault();
      armed = false;
      press = null;
      draw();
      return;
    }
    if (/^[0-9.,]$/.test(event.key)) {
      event.preventDefault();
      flash = '';
      openField('length', at > 0 ? at - 1 : 0, event.key === ',' ? '.' : event.key);
      return;
    }
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      // R where the point has no corner says so (pass 4, part 12.1, rule 7).
      const c = model.line.corners && model.line.corners[at - 1];
      if (at === 0 || at === n - 1 || !c || c.kind === 'none') {
        flash = texts.noCorner;
        draw();
        return;
      }
      flash = '';
      openField('radius', at, null, true);
      return;
    }
    const base = current();
    const result = lineKey({
      points: base, corners: currentCorners(), picked: selected, key: event.key, shift: event.shiftKey,
      minStretch: view ? MIN_STRETCH / view.scale : 0,
    });
    if (!result) return;
    event.preventDefault();
    flash = result.refused || '';
    selected = result.picked;
    armed = false;
    if (event.key.startsWith('Arrow')) {
      if (!keyPoints) onEdit({ type: 'begin' });
      keyPoints = result.points;
      latest = result.points;
      send('move', keyPoints, result.corners);
    } else if (result.points !== base) {
      latest = result.points;
      latest.corners = result.corners;
      send('replace', result.points, result.corners);
    } else {
      draw();
    }
  });
  drawing.addEventListener('keyup', (event) => {
    if (!keyPoints || !event.key.startsWith('Arrow')) return;
    const points = keyPoints;
    keyPoints = null;
    send('end', points, model.corners);
  });
  drawing.addEventListener('focus', () => {
    keysHint.hidden = quiet || !drawing.matches(':focus-visible');
    draw();
  });
  drawing.addEventListener('blur', () => {
    keysHint.hidden = true;
    if (keyPoints) {
      const points = keyPoints;
      keyPoints = null;
      send('end', points, model.corners);
    }
    draw();
  });

  // The drawing's layers, made once and updated in place.
  const layer = () => svg('g', {});
  const gridLayer = layer();
  const scaleBar = svg('path', { stroke: GREY, 'stroke-width': 1.5, fill: 'none' });
  const scaleText = svg('text', { fill: GREY, 'font-size': CAPTION }, '1 m');
  const hintTexts = [0, 1, 2].map((i) => svg('text', { fill: GREY, 'font-size': CAPTION, x: 10, y: 16 + HINT_LINE * i, 'pointer-events': 'none' }));
  const readoutText = svg('text', { fill: GREY, 'font-size': CAPTION, 'text-anchor': 'end', 'pointer-events': 'none' });
  const band = svg('polygon', { fill: RULE });
  // The robot split (2026-10-09): the front band split by worker. The hand's
  // stretches keep the band's rule; the template's take a hatch of the grey,
  // the robot's the ink. Tone and pattern, never tone alone.
  const defs = svg('defs', {}, svg('pattern', {
    id: 'band-hatch', patternUnits: 'userSpaceOnUse', width: 4, height: 4, patternTransform: 'rotate(45)',
  }, svg('rect', { width: 4, height: 4, fill: RULE }), svg('path', { d: 'M0 0 V4', stroke: GREY, 'stroke-width': 2 })));
  const pieceLayer = layer();
  // A cut corner's arc: in the grey on the paper; in the paper where it lies on the robot's ink, inside the corner on its front side.
  const cutMarks = svg('path', { class: 'cut-mark', stroke: GREY, 'stroke-width': 1, fill: 'none', 'pointer-events': 'none' });
  const cutMarksOnInk = svg('path', { class: 'cut-mark', stroke: PAPER, 'stroke-width': 2, fill: 'none', 'pointer-events': 'none' });
  const linePath = svg('path', { stroke: INK, 'stroke-width': 2.5, fill: 'none' });
  const redLayer = layer();
  const endMark = svg('line', { stroke: INK, 'stroke-width': 2 });
  const dimLines = svg('path', { class: 'dimension-lines', stroke: GREY, 'stroke-width': 1, fill: 'none', 'pointer-events': 'none' });
  const dimLayer = layer();
  const startText = svg('text', { fill: INK, 'font-size': CAPTION, 'text-anchor': 'middle', 'pointer-events': 'none' }, texts.start);
  const frontText = svg('text', { fill: GREY, 'font-size': CAPTION, 'text-anchor': 'middle', 'pointer-events': 'none' }, texts.front);
  const ghostLayer = layer();
  const arcLayer = layer();
  const hoverLayer = layer();
  const ringLayer = layer();
  const pointLayer = layer();
  const section = svg('g', { class: 'section' });
  const sectionHit = svg('rect', { fill: PAPER, 'fill-opacity': 0 });
  const sectionCourses = layer();
  const heightText = svg('text', { fill: GREY, 'font-size': CAPTION, 'text-anchor': 'middle', 'pointer-events': 'none' });
  const heightLine = svg('path', { class: 'dimension-lines', stroke: GREY, 'stroke-width': 1, fill: 'none', 'pointer-events': 'none' });
  section.append(sectionHit, sectionCourses);
  drawing.append(defs, gridLayer, scaleBar, scaleText, ...hintTexts, readoutText, band, pieceLayer, linePath, redLayer, endMark, dimLines, cutMarks, cutMarksOnInk, dimLayer, startText, frontText, ghostLayer, arcLayer, hoverLayer, ringLayer, pointLayer);
  sectionSvg.append(section, heightLine, heightText);
  let gridKey = '';

  const attrs = (node, values) => {
    for (const [name, value] of Object.entries(values)) node.setAttribute(name, value);
  };
  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  function pool(group, n, make) {
    while (group.children.length < n) group.append(make());
    while (group.children.length > n) group.lastChild.remove();
    return [...group.children];
  }
  const sectionScale = () => Math.max(1, sectionHeight - SECTION_TOP) / MAX_WALL_HEIGHT;

  // The section: base course, earth courses and cap, cut through, to one scale.
  function drawSection() {
    const w = sectionWidth;
    attrs(sectionHit, { x: 0, y: 0, width: w, height: sectionHeight });
    const s = sectionScale();
    const depth = Math.max(8, Math.round((BLOCK.depth / 1000) * s * 2));
    const left = Math.round((w - depth) / 2);
    const layers = [BASE_HEIGHT, ...Array(model.courses).fill(BLOCK.height), CAP_HEIGHT];
    let y = sectionHeight;
    const rects = pool(sectionCourses, layers.length, () => svg('rect', { stroke: INK, 'stroke-width': 1, 'pointer-events': 'none' }));
    layers.forEach((hgt, i) => {
      const hpx = hgt * s;
      y -= hpx;
      const ground = i === 0 || i === layers.length - 1;
      attrs(rects[i], { x: left, y: y.toFixed(1), width: depth, height: Math.max(1, hpx).toFixed(1), fill: ground ? RULE : PAPER });
    });
    // Pass 4 (part 12.1, rule 12): the height is a dimension of the section,
    // a thin line from the ground to the cap beside the wall, its figure on the cap.
    const top = y;
    const dx = left - 6;
    attrs(heightLine, { d: `M${dx} ${sectionHeight} V${top.toFixed(1)} M${dx - 3} ${sectionHeight - 0.5} h6 M${dx - 3} ${top.toFixed(1)} h6` });
    setText(heightText, texts.heightValue(model.height));
    attrs(heightText, { x: w / 2, y: Math.max(CAPTION, Math.round(top - 5)) });
  }

  function draw() {
    const { line, points, lambda, red } = model;
    const { frame, step } = grid;
    const gkey = `${width}|${height}|${view.scale}|${view.ox}|${view.oy}|${step}|${frame.angle}|${frame.origin}`;
    if (gkey !== gridKey) {
      // Pass 5 (part 13.1, rule 3): the grid in the snap's step, from the
      // start point along the first stretch; the scale in whole steps.
      gridKey = gkey;
      const lines = [];
      const box = [[0, 0], [planWidth, 0], [0, height], [planWidth, height]].map((c) => toGrid(frame, toPlan(c)));
      const [u0, u1] = [Math.min(...box.map((c) => c[0])), Math.max(...box.map((c) => c[0]))];
      const [v0, v1] = [Math.min(...box.map((c) => c[1])), Math.max(...box.map((c) => c[1]))];
      const segment = (a, b) => {
        const [ax, ay] = toScreen(fromGrid(frame, a));
        const [bx, by] = toScreen(fromGrid(frame, b));
        lines.push(svg('line', { x1: ax, y1: ay, x2: bx, y2: by, stroke: RULE, 'stroke-width': 1 }));
      };
      for (let k = Math.ceil(u0 / step - 1e-9); k * step <= u1 + 1e-9; k++) segment([k * step, v0], [k * step, v1]);
      for (let k = Math.ceil(v0 / step - 1e-9); k * step <= v1 + 1e-9; k++) segment([u0, k * step], [u1, k * step]);
      gridLayer.replaceChildren(...lines);
      const bar = view.scale * grid.scale;
      attrs(scaleBar, { d: `M10 ${height - 10} v-6 M10 ${height - 13} h${bar} M${10 + bar} ${height - 10} v-6` });
      // Its words beside the bar, inside the bottom band: never in the line's room.
      attrs(scaleText, { x: 16 + bar, y: height - 9 });
      setText(scaleText, `${fixed(grid.scale, 2)} m`);
    }
    // The keys that come and go keep their tracks (pass 5, rules 5 and 8).
    removeKey.hidden = !(selected > 0 && selected < points.length - 1);
    fitKey.hidden = !fix;

    const every = Math.max(1, Math.round(1 / (line.step * view.scale)));
    const front = [];
    const back = [];
    for (let i = 0; i < line.xs.length; i += every) {
      const [sx, sy] = toScreen([line.xs[i], line.ys[i]]);
      const b = line.bearings[i];
      front.push([sx - Math.sin(b) * 16, sy - Math.cos(b) * 16]);
      back.push([sx, sy]);
    }
    attrs(band, { points: [...back, ...front.reverse()].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') });
    // The template's and the robot's stretches over the band; the robot's middle kept for the numbers to keep off.
    const pieces = (model.split || []).filter((s) => s.by !== 'hand');
    robotBand = [];
    pool(pieceLayer, pieces.length, () => svg('path', { class: 'band-piece' })).forEach((node, i) => {
      const s = pieces[i];
      // Mitred at a sharp corner, as the floor's bands are, so the piece never folds over the corner.
      // The template's hatch keeps to the band's inner 7 px, along the line: the words on the
      // front side stand 9 px out and more, so the hatch never lies under a letter.
      const strip = frontStrip(line, s.from, s.to, 0, (s.by === 'robot' ? 16 : 7) / view.scale, Math.max(0.005, 2 / view.scale));
      const lineSide = strip.inner.map(toScreen);
      const frontSide = strip.outer.map(toScreen);
      if (s.by === 'robot') lineSide.forEach(([x, y], k) => robotBand.push([(x + frontSide[k][0]) / 2, (y + frontSide[k][1]) / 2]));
      const d = [...lineSide, ...frontSide.reverse()].map(([x, y], j) => `${j ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
      attrs(node, { d: `${d} Z`, 'data-by': s.by, fill: s.by === 'robot' ? INK : 'url(#band-hatch)' });
    });

    const path = (from, to) => {
      const parts = [];
      const i0 = Math.max(0, Math.floor(from / line.step));
      const i1 = Math.min(line.xs.length - 1, Math.ceil(to / line.step));
      for (let i = i0; i <= i1; i += every) {
        const [sx, sy] = toScreen([line.xs[i], line.ys[i]]);
        parts.push(`${i === i0 ? 'M' : 'L'}${sx.toFixed(1)} ${sy.toFixed(1)}`);
      }
      if ((i1 - i0) % every) {
        const [sx, sy] = toScreen([line.xs[i1], line.ys[i1]]);
        parts.push(`L${sx.toFixed(1)} ${sy.toFixed(1)}`);
      }
      return parts.join(' ');
    };
    attrs(linePath, { d: path(0, line.length) });
    pool(redLayer, red.length, () => svg('path', { stroke: RED, 'stroke-width': 4, fill: 'none' }))
      .forEach((node, i) => attrs(node, { d: path(red[i][0], red[i][1]) }));
    if (lambda > 0) {
      const end = line.pointAt(lambda);
      const [ex, ey] = toScreen([end.x, end.y]);
      const nx = -Math.sin(end.bearing) * 9;
      const ny = -Math.cos(end.bearing) * 9;
      attrs(endMark, { x1: ex - nx, y1: ey - ny, x2: ex + nx, y2: ey + ny, visibility: 'visible' });
    } else {
      attrs(endMark, { visibility: 'hidden' });
    }

    const shownGhosts = drag ? [] : ghosts();
    pool(ghostLayer, shownGhosts.length, () => svg('circle', { class: 'ghost', r: GHOST_RADIUS, fill: PAPER, stroke: INK, 'stroke-width': 1.5 }))
      .forEach((node, i) => attrs(node, { cx: shownGhosts[i].screen[0], cy: shownGhosts[i].screen[1] }));
    // Pass 5 (part 13.1, rule 7): a handle at the middle of each arc, a hollow diamond.
    arcs = (line.corners || []).filter((c) => (c.kind === 'free' || c.kind === 'round') && c.radius > 0 && c.t > 1e-9)
      .map((c) => { const m = line.pointAt(c.s); return { index: c.index, screen: toScreen([m.x, m.y]) }; });
    pool(arcLayer, arcs.length, () => svg('path', { class: 'arc-handle', fill: PAPER, stroke: INK, 'stroke-width': 1.5 }))
      .forEach((node, i) => {
        const [ax, ay] = arcs[i].screen;
        attrs(node, { d: `M${ax.toFixed(1)} ${(ay - HANDLE).toFixed(1)} L${(ax + HANDLE).toFixed(1)} ${ay.toFixed(1)} L${ax.toFixed(1)} ${(ay + HANDLE).toFixed(1)} L${(ax - HANDLE).toFixed(1)} ${ay.toFixed(1)} Z` });
      });
    const hoverAt = !hover || drag ? null : hover.type === 'point' ? toScreen(points[hover.index])
      : hover.type === 'arc' ? (arcs.find((a) => a.index === hover.index) || {}).screen : toScreen(hover.plan);
    const marks = pool(hoverLayer, hoverAt ? 1 : 0, () => svg('circle', { class: 'hover-mark', stroke: CHOSEN, 'stroke-width': 2 }));
    if (marks.length) {
      const onLine = hover.type === 'line';
      attrs(marks[0], { cx: hoverAt[0], cy: hoverAt[1], r: onLine ? GHOST_RADIUS + 1 : POINT_RADIUS + 5, fill: onLine ? PAPER : 'none' });
    }
    // Pass 5 (part 13.1, rule 5): a point picked by a tap is ringed in the green.
    const rings = pool(ringLayer, armed && selected < points.length ? 1 : 0, () => svg('circle', { class: 'pick-ring', r: POINT_RADIUS + 4, fill: 'none', stroke: CHOSEN, 'stroke-width': 2, 'pointer-events': 'none' }));
    if (rings.length) {
      const [rx, ry] = toScreen(points[selected]);
      attrs(rings[0], { cx: rx, cy: ry });
    }
    pool(pointLayer, points.length, () => svg('circle', { class: 'point', r: POINT_RADIUS, role: 'img' }))
      .forEach((node, i) => {
        const p = points[i];
        const [sx, sy] = toScreen(p);
        attrs(node, {
          id: `line-point-${i}`, cx: sx, cy: sy, fill: i === selected ? CHOSEN : INK,
          'aria-label': keys.point(i + 1, points.length, p[0], p[1]),
        });
      });
    if (document.activeElement === drawing) drawing.setAttribute('aria-activedescendant', `line-point-${selected}`);
    else drawing.removeAttribute('aria-activedescendant');

    drawSection();
    drawWords(back, shownGhosts);
  }

  // The drawn box of a text, from the browser, with 2 px to spare; null when not drawn.
  const boxOf = (node) => {
    try {
      const b = node.getBBox();
      return b.width > 0 ? { x0: b.x - 2, x1: b.x + b.width + 2, y0: b.y - 2, y1: b.y + b.height + 2 } : null;
    } catch {
      return null;
    }
  };

  // Pass 5 (part 13.1, rule 8): a tight bend says its room and its need,
  // the tightest corner's, and the way to a wall that fits.
  function tightLines() {
    let c = null;
    for (const k of model.line.corners || []) {
      if ((k.kind === 'free' || k.kind === 'round') && k.radius < model.minimum - 1e-9 && (!c || k.radius < c.radius)) c = k;
    }
    if (!c) return [texts.refusedHint];
    const room = c.kind === 'free' || c.radius < c.set - 0.005;
    return [room ? texts.tightRoom(c.radius) : texts.tightSet(c.radius), texts.tightNeed(model.minimum), fix ? texts.fitWayBack : texts.wayBack];
  }

  // The words of the drawing, each in its place and none on another: the hint
  // in the top lines, the bend at the bottom right, the dimensions beside
  // their stretches and arcs, then Start and Front where nothing is.
  function drawWords(back, shownGhosts) {
    const { line, points, red } = model;
    let lines;
    let tone = GREY;
    let said = '';
    if (fieldHint) {
      // While a corner's field is open, the hint says what it takes (pass 5, rule 7).
      lines = fieldHint;
      said = fieldHint.join(' ');
    } else if (model.refusal) {
      // Every refusal names its way back (pass 4, part 12.1, rule 9); a
      // tight bend its room and its need, and Fit (pass 5, rule 8).
      const why = { near: texts.nearHint, whole: texts.wholeHint }[model.refusal];
      lines = model.refusal === 'tight' ? tightLines() : why ? [why, texts.wayBack] : [texts.refusedHint];
      tone = RED;
      said = lines.join(' ');
    } else if (flash) {
      lines = [flash];
      said = flash;
    } else if (model.tooShort) {
      lines = [texts.outOfRange];
      said = texts.outOfRange;
    } else if (points.length >= MAX_POINTS) {
      lines = [texts.mostPoints];
      said = texts.mostPoints;
    } else if (armed) {
      lines = [texts.pickHint];
      said = texts.pickHint;
    } else if (!keysHint.hidden) {
      lines = keys.lineLines;
    } else if (model.notes.length) {
      lines = model.notes;
      said = model.notes.join(' ');
    } else {
      lines = [texts.baseLineHelp];
    }
    setText(status, said);
    hintTexts.forEach((node, i) => {
      setText(node, lines[i] || '');
      node.setAttribute('fill', tone);
    });

    const obstacles = lines.map((text, i) => (text && boxOf(hintTexts[i])) || textBox(text, 10, 16 + HINT_LINE * i, { size: CAPTION }));
    obstacles.push(textBox(`${fixed(grid.scale, 2)} m`, 16 + view.scale * grid.scale, height - 9, { size: CAPTION }));
    obstacles.push({ x0: 10, x1: 10 + view.scale * grid.scale, y0: height - 16, y1: height - 8 });
    arcs.forEach((a) => obstacles.push(boxAround(a.screen[0], a.screen[1], HANDLE + 4)));
    const bend = model.bend;
    if (Number.isFinite(bend)) {
      // Each arc's radius is its R dimension; the readout says the limit, once (pass 4, part 12.1, rule 8).
      const text = texts.minimumBend(model.minimum);
      attrs(readoutText, { x: planWidth - 10, y: height - 10, fill: red.length ? RED : GREY, visibility: 'visible' });
      setText(readoutText, text);
      // Its drawn box, from the browser: wide letters reach past the estimate.
      const rb = textBox(text, planWidth - 10, height - 10, { size: CAPTION, anchor: 'end' });
      obstacles.push(boxOf(readoutText) || { x0: rb.x0 - 4, x1: rb.x1 + 4, y0: rb.y0 - 4, y1: rb.y1 + 4 });
    } else {
      attrs(readoutText, { visibility: 'hidden' });
    }
    obstacles.push(...lineBoxes(back, 7, 8));
    // The robot's stretches of the band are ink: no number stands on them.
    obstacles.push(...lineBoxes(robotBand, 8, 8));
    points.forEach((p) => obstacles.push(boxAround(...toScreen(p), POINT_RADIUS + 5)));
    shownGhosts.forEach((g) => obstacles.push(boxAround(g.screen[0], g.screen[1], GHOST_RADIUS + 6)));
    if (model.lambda > 0) {
      const end = line.pointAt(model.lambda);
      obstacles.push(boxAround(...toScreen([end.x, end.y]), 12));
    }
    const at = (x, y, text) => ({ x, y, box: textBox(text, x, y, { size: CAPTION, anchor: 'middle' }) });


    // The dimensions: each stretch's length on its back side, once the line
    // has two stretches; each arc's radius toward its centre; a square mark
    // in each sharp right angle.
    const shown = [];
    const marksD = [];
    const cutD = [];
    const cutInkD = [];
    for (const c of line.corners) {
      if (c.kind === 'sharp') {
        const p = toScreen(points[c.index]);
        const a = toScreen(points[c.index - 1]);
        const b = toScreen(points[c.index + 1]);
        const u = [(a[0] - p[0]) / (Math.hypot(a[0] - p[0], a[1] - p[1]) || 1), (a[1] - p[1]) / (Math.hypot(a[0] - p[0], a[1] - p[1]) || 1)];
        const v = [(b[0] - p[0]) / (Math.hypot(b[0] - p[0], b[1] - p[1]) || 1), (b[1] - p[1]) / (Math.hypot(b[0] - p[0], b[1] - p[1]) || 1)];
        const q = (s, t) => `${(p[0] + u[0] * s + v[0] * t).toFixed(1)} ${(p[1] + u[1] * s + v[1] * t).toFixed(1)}`;
        if (c.square) {
          marksD.push(`M${q(12, 0)} L${q(12, 12)} L${q(0, 12)}`);
        } else {
          // The robot split: a corner that is not square, laid from cut blocks, is marked by an arc between its legs.
          const sweep = u[0] * v[1] - u[1] * v[0] > 0 ? 1 : 0;
          // A left turn has its front, and the band, inside the corner.
          const onInk = c.turn > 0 && robotBand.length > 0;
          (onInk ? cutInkD : cutD).push(`M${q(12, 0)} A12 12 0 0 ${sweep} ${q(0, 12)}`);
        }
        // The mark is the corner's target, as a number is: a tap on it opens the corner's field.
        const mid = [u[0] + v[0], u[1] + v[1]];
        const len = c.square ? 1 / 8 : (Math.hypot(mid[0], mid[1]) || 1) / 11;
        shown.push({ kind: 'radius', index: c.index, text: null, box: boxAround(p[0] + mid[0] / len, p[1] + mid[1] / len, 8) });
        continue;
      }
      if (!(c.kind === 'free' || c.kind === 'round') || !(c.radius > 0)) continue;
      const mid = line.pointAt(c.s);
      const [mx, my] = toScreen([mid.x, mid.y]);
      const [cx, cy] = c.centre ? toScreen(c.centre) : [mx, my + 1];
      const dl = Math.hypot(cx - mx, cy - my) || 1;
      const vx = (cx - mx) / dl;
      const vy = (cy - my) / dl;
      const text = `R${fixed(c.radius, 2)}`;
      const ways = [];
      for (const dd of [20, 32, 44]) {
        for (const turn of [0, 35, -35, 70, -70, 180]) {
          const r = (turn * Math.PI) / 180;
          ways.push(at(mx + (vx * Math.cos(r) - vy * Math.sin(r)) * dd, my + (vx * Math.sin(r) + vy * Math.cos(r)) * dd + 4, text));
        }
      }
      const spot = place(ways, obstacles, planWidth, height);
      if (!spot) continue;
      obstacles.push(spot.box);
      shown.push({ kind: 'radius', index: c.index, text, x: spot.x, y: spot.y, box: spot.box });
    }
    const lineMarks = [];
    // Pass 5 (part 13.1, rule 1): a line of one stretch has its number too,
    // where the Length field said it; it keeps its 44 px off the ghost
    // handle, so the first bend is still one drag.
    const offGhosts = (c) => points.length > 2 || shownGhosts.every((g) => {
      const half = [Math.max(ZONE, (c.box.x1 - c.box.x0) / 2 + 4), Math.max(ZONE, (c.box.y1 - c.box.y0) / 2 + 4)];
      return Math.abs(g.screen[0] - (c.box.x0 + c.box.x1) / 2) > half[0] || Math.abs(g.screen[1] - (c.box.y0 + c.box.y1) / 2) > half[1];
    });
    if (points.length >= 2) {
      const lens = [];
      for (let k = 0; k + 1 < points.length; k++) {
        const a = toScreen(points[k]);
        const b = toScreen(points[k + 1]);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1) continue;
        const ux = (b[0] - a[0]) / len;
        const uy = (b[1] - a[1]) / len;
        const bx = -uy; // the back: the right of the way from the start, on screen
        const by = ux;
        const text = fixed(stretchLength(k), 2);
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        // Clear of its dimension line (12 px) on the back side, of the band
        // (16 px) on the front, by the number's own reach across the stretch;
        // the middle of each side first, then along the stretch, then further out.
        const box = textBox(text, 0, 0, { size: CAPTION, anchor: 'middle' });
        const across = Math.abs(bx) * ((box.x1 - box.x0) / 2) + Math.abs(by) * ((box.y1 - box.y0) / 2);
        const ways = [];
        for (const out of [0, 10]) {
          for (const f of [0, 0.18, -0.18, 0.32, -0.32]) {
            for (const [side, dd] of [[1, 11 + across + out], [-1, 9 + across + out]]) {
              ways.push(at(mx + ux * f * len + side * bx * dd, my + uy * f * len + side * by * dd + 4, text));
            }
          }
        }
        const free = ways.filter(offGhosts);
        lens.push({ k, a, b, ux, uy, bx, by, mx, my, text, ways: free, spot: place(free, obstacles, planWidth, height) });
        if (lens.at(-1).spot) obstacles.push(lens.at(-1).spot.box);
      }
      // One step of repair (pass 4): a number left out takes a place that
      // one placed number holds, when that one has another place free.
      for (const d of lens) {
        if (d.spot) continue;
        for (const c of d.ways) {
          if (!within(c.box, planWidth, height)) continue;
          const holders = lens.filter((e) => e.spot && meets(c.box, e.spot.box));
          if (holders.length !== 1) continue;
          const rest = obstacles.filter((o) => o !== holders[0].spot.box);
          if (rest.some((o) => meets(c.box, o))) continue;
          const moved = place(holders[0].ways, [...rest, c.box], planWidth, height);
          if (!moved) continue;
          obstacles.splice(obstacles.indexOf(holders[0].spot.box), 1, moved.box);
          holders[0].spot = moved;
          d.spot = c;
          obstacles.push(c.box);
          break;
        }
      }
      for (const { k, a, b, ux, uy, bx, by, mx, my, text, spot } of lens) {
        if (!spot) continue;
        // The dimension line: 8 px out on the back; on the front, 4 px out, inside the band, clear of its number.
        const sideOf = Math.sign((spot.x - mx) * bx + (spot.y - 4 - my) * by || 1);
        const off = sideOf > 0 ? 8 : -4;
        const ox = bx * off;
        const oy = by * off;
        const tick = (x, y) => `M${(x - 3 * (ux + bx)).toFixed(1)} ${(y - 3 * (uy + by)).toFixed(1)} L${(x + 3 * (ux + bx)).toFixed(1)} ${(y + 3 * (uy + by)).toFixed(1)}`;
        marksD.push(`M${(a[0] + ox).toFixed(1)} ${(a[1] + oy).toFixed(1)} L${(b[0] + ox).toFixed(1)} ${(b[1] + oy).toFixed(1)} ${tick(a[0] + ox, a[1] + oy)} ${tick(b[0] + ox, b[1] + oy)}`);
        shown.push({ kind: 'length', index: k, text, x: spot.x, y: spot.y, box: spot.box });
        // Front and Start keep off the dimension lines (pass 4).
        const from = [a[0] + bx * off, a[1] + by * off];
        const to = [b[0] + bx * off, b[1] + by * off];
        const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 6));
        lineMarks.push(...lineBoxes(Array.from({ length: steps + 1 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]), 4, 6));
      }
    }
    dims = shown;
    // Pass 5 (part 13.1, rule 9): an open field covers only its own number;
    // the numbers it would cover are not drawn while it is open.
    if (editing) {
      const fb = fieldBox(editing.kind, editing.index);
      dims = shown.filter((d) => !d.text || (d.kind === editing.kind && d.index === editing.index) || !meets(d.box, fb));
      dimField.style.left = `${fb.x0}px`;
      dimField.style.top = `${fb.y0}px`;
    }
    const texted = dims.filter((d) => d.text);
    attrs(dimLines, { d: marksD.join(' ') });
    attrs(cutMarks, { d: cutD.join(' ') });
    attrs(cutMarksOnInk, { d: cutInkD.join(' ') });
    pool(dimLayer, texted.length, () => svg('text', { class: 'dimension', fill: GREY, 'font-size': CAPTION, 'text-anchor': 'middle' }))
      .forEach((node, i) => {
        const d = texted[i];
        attrs(node, { x: d.x, y: d.y, 'data-kind': d.kind, 'data-index': d.index });
        setText(node, d.text);
      });

    // Front, the word that alone marks the front where the band is faint, is
    // never left out (pass 4, part 12.1, rule 11): after the numbers it tries
    // the front side from the middle of the line out, ever further from it.
    obstacles.push(...lineMarks);
    // Where each number's field opens: Front and Start keep off it, so an open field covers no word.
    const fieldBoxes = shown.filter((d) => d.text).map((d) => {
      const cx = (d.box.x0 + d.box.x1) / 2;
      const cy = (d.box.y0 + d.box.y1) / 2;
      const x0 = Math.min(Math.max(0, cx - FIELD_WIDTH / 2), planWidth - FIELD_WIDTH);
      const y0 = Math.min(Math.max(0, cy - ROW / 2), height - ROW);
      return { x0, x1: x0 + FIELD_WIDTH, y0, y1: y0 + ROW };
    });
    const placeClear = (candidates) => place(candidates, [...obstacles, ...fieldBoxes], planWidth, height) || place(candidates, obstacles, planWidth, height);
    const fronts = [];
    for (const dd of [28, 40, 52, 64]) {
      for (const f of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9, 0.27, 0.73, 0.43, 0.57, 0.05, 0.95]) {
        const p = line.pointAt(line.length * f);
        const [fx, fy] = toScreen([p.x, p.y]);
        fronts.push(at(fx - Math.sin(p.bearing) * dd, fy - Math.cos(p.bearing) * dd + 4, texts.front));
      }
    }
    const frontAt = placeClear(fronts);
    attrs(frontText, frontAt ? { x: frontAt.x, y: frontAt.y, visibility: 'visible' } : { visibility: 'hidden' });
    if (frontAt) obstacles.push(frontAt.box);

    const start = line.pointAt(0);
    const [stx, sty] = toScreen([start.x, start.y]);
    const sb = Math.sin(start.bearing);
    const cb = Math.cos(start.bearing);
    const startAt = placeClear([
      ...ringAround(stx, sty, [sb, cb], 22),
      ...ringAround(stx, sty, [sb, cb], 32),
    ].map((c) => at(c.x, c.y, texts.start)));
    attrs(startText, startAt ? { x: startAt.x, y: startAt.y, visibility: 'visible' } : { visibility: 'hidden' });
    if (startAt) obstacles.push(startAt.box);
  }

  function update(next) {
    if (next !== model) latest = null;
    model = next;
    const w = Math.max(200, Math.floor(roomWidth));
    const h = Math.max(100, Math.floor(roomHeight));
    if (w !== width || h !== height || !drawing.hasAttribute('viewBox')) {
      width = w;
      height = h;
      sectionWidth = (width - LABEL - 4 * GAP) / 4;
      planWidth = width - sectionWidth - GAP;
      sectionHeight = Math.max(24, height - 3 * (ROW + GAP) - (LABEL_LINE + GAP));
      attrs(drawing, { viewBox: `0 0 ${planWidth} ${height}`, width: planWidth, height });
      attrs(sectionSvg, { viewBox: `0 0 ${sectionWidth} ${sectionHeight}`, width: sectionWidth, height: sectionHeight });
      gridKey = '';
      forceFit = true;
    }
    // Pass 5 (part 13.1, rule 4): the sheet holds still under the pencil.
    if (!view || forceFit) {
      fitView();
      forceFit = false;
    } else if (!drag && !keyPoints && outOfRoom()) {
      fitView();
    }
    if (selected >= model.points.length) selected = model.points.length - 1;
    // A screen reader hears no R dimension, so its line says the radius with the minimum.
    setText(readout, Number.isFinite(model.bend) ? texts.spokenBend(model.bend, model.minimum) : '');
    undo.disabled = !model.canUndo;
    more.disabled = model.courses >= model.coursesRange[1];
    less.disabled = model.courses <= model.coursesRange[0];
    if (document.activeElement !== coursesField) coursesField.value = String(model.courses);
    // Pass 5 (part 13.1, rules 1 and 8): the wall's length, told; what Fit would make.
    setText(told, texts.lengthValue(model.told ?? 0));
    fix = model.refusal === 'tight' ? fitBend(model.points, model.corners, model.minimum) : null;
    if (releasedAt && !drag) {
      hover = hitTest(releasedAt);
      releasedAt = null;
      setCursor();
    }
    draw();
  }

  // An edit ends what the drawing said last.
  function clearFlash() {
    flash = '';
  }

  // A new wall from outside, an address: the sheet is fitted to it.
  function refit() {
    forceFit = true;
    armed = false;
  }

  return { update, isDragging: () => Boolean(drag), clearFlash, refit };
}
