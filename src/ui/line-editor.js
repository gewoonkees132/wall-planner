// The drawer (pass 3 of the Aicher loop, docs/specs/configurator-
// demonstrator-ux-aicher.md, part 11.4): the one place where the wall is
// set, drawn like a technical drawing. The plan sets the line, a polyline
// with fillets; the section, in the right track, sets the height in earth
// courses; the foot holds the whole length and Undo. A drag snaps to half
// blocks and right angles (snap.js); every length and radius is a
// dimension on the drawing, and a tap on it, a digit or R opens a field to
// type it (dimensions.js). No modes. Every target reacts within 44 by 44
// px and the nearest wins. A red corner never blocks the drag.

import { el, svg, svgPoint, key, row } from './dom.js';
import { BLOCK, BASE_HEIGHT, CAP_HEIGHT, MAX_WALL_HEIGHT, MIN_LENGTH, MAX_LENGTH } from '../block.js';
import { snapLength } from '../bond.js';
import { lineKey } from '../linekeys.js';
import { hitTarget, cursorFor, HIT } from '../linehit.js';
import { snapPoint } from '../snap.js';
import { readNumber, roundStretch, withStretchLength, withCornerRadius } from '../dimensions.js';
import { PALETTE, TYPE } from '../palette.js';
import { fixed } from '../texts.js';
import { textBox, boxAround, lineBoxes, place, ringAround } from '../labels.js';

const POINT_RADIUS = 7; // a disc of 14 px [R]
const GHOST_RADIUS = 4; // a hollow disc of 8 px, placeholder
const MIN_STRETCH = 88; // px on screen [R]
const MAX_POINTS = 10; // [R]
const MARGIN = 0.5; // m, placeholder
const GRID = 0.48; // m, two blocks
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

export function createLineEditor(root, { texts, keys, onEdit }) {
  const drawing = svg('svg', {
    class: 'line-drawing', tabindex: '0', role: 'application',
    'aria-label': texts.baseLineCaption, 'aria-describedby': 'line-keys',
  });
  // The section's keys and its field stand in the right track, over the drawing's column.
  const more = key('plus', null, { class: 'step', 'aria-label': `${texts.coursesLabel}: more`, onclick: () => stepCourses(1) });
  const less = key('minus', null, { class: 'step', 'aria-label': `${texts.coursesLabel}: less`, onclick: () => stepCourses(-1) });
  const coursesField = el('input', {
    class: 'value-input courses-field', type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false',
    'aria-label': texts.coursesLabel,
  });
  const sectionSvg = svg('svg', { class: 'line-drawing section-drawing', 'aria-hidden': 'true' });
  const column = el('div', { class: 'section-keys' }, more, sectionSvg, el('div', { class: 'value' }, coursesField), less);
  const dimField = el('input', {
    class: 'value-input dimension-field', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', hidden: true,
  });
  const area = el('div', { class: 'line-area' }, drawing, column, dimField);
  // A screen reader hears the drawing's words from these lines, which take no room.
  const readout = el('p', { class: 'readout' });
  const keysHint = el('p', { class: 'keys-hint', id: 'line-keys', hidden: true }, keys.line);
  const status = el('p', { class: 'message', role: 'status' });
  const lengthInput = el('input', {
    id: 'length', class: 'value-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
    'aria-label': texts.lengthLabel,
  });
  const undo = key('undo', texts.undo, { onclick: () => onEdit({ type: 'undo' }) });
  root.classList.add('line-editor', 'drawer');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', texts.drawerLabel);
  root.append(area, el('div', { class: 'sr-only' }, readout, status, keysHint),
    row(texts.lengthLabel, [el('div', { class: 'value span-2' }, lengthInput), undo], { id: 'length', cls: 'line-row' }));

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
  let editing = null; // { kind, index }: the dimension being typed
  let dims = []; // the dimensions drawn: { kind, index, box }
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
  const scaleUnit = () => (view.scale > 60 ? 0.5 : 1);
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
    return hitTarget({ points: model.points, ghosts: ghosts(), line: model.line, toScreen }, at);
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
    const n = Math.round(readNumber(coursesField.value));
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

  // The whole length, typed and rounded to half blocks as before.
  lengthInput.addEventListener('change', () => {
    const typed = readNumber(lengthInput.value);
    if (!Number.isFinite(typed)) {
      update(model);
      return;
    }
    const snapped = snapLength(typed);
    if (typed < MIN_LENGTH - 1e-9 || typed > MAX_LENGTH + 1e-9) flash = texts.outOfRange;
    else flash = Math.abs(snapped - typed) > 1e-9 ? texts.rounded(snapped) : '';
    onEdit({ type: 'length', value: typed });
  });
  lengthInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') lengthInput.dispatchEvent(new Event('change'));
  });

  // A dimension's field: opened on the dimension, by a tap, a digit or R.
  function openField(kind, index, initial = null) {
    const d = dims.find((x) => x.kind === kind && x.index === index);
    let at;
    if (d) at = [(d.box.x0 + d.box.x1) / 2, (d.box.y0 + d.box.y1) / 2];
    else if (kind === 'radius') at = toScreen(model.points[index]);
    else at = toScreen([(model.points[index][0] + model.points[index + 1][0]) / 2, (model.points[index][1] + model.points[index + 1][1]) / 2]);
    editing = { kind, index };
    dimField.style.left = `${Math.round(Math.min(Math.max(0, at[0] - FIELD_WIDTH / 2), planWidth - FIELD_WIDTH))}px`;
    dimField.style.top = `${Math.round(Math.min(Math.max(0, at[1] - ROW / 2), height - ROW))}px`;
    dimField.setAttribute('aria-label', kind === 'length' ? texts.stretchField(index + 1) : texts.cornerField(index + 1));
    const c = model.line.corners[index - 1];
    dimField.value = initial ?? (kind === 'length' ? fixed(stretchLength(index), 2) : fixed(c ? c.radius : 0, 2));
    dimField.hidden = false;
    dimField.focus();
    if (initial === null) dimField.select();
    else dimField.setSelectionRange(dimField.value.length, dimField.value.length);
  }
  const stretchLength = (k) => Math.hypot(model.points[k + 1][0] - model.points[k][0], model.points[k + 1][1] - model.points[k][1]);

  function closeField(apply, refocus) {
    if (!editing) return;
    const { kind, index } = editing;
    editing = null;
    dimField.hidden = true;
    if (apply) {
      const value = readNumber(dimField.value);
      const points = model.points.map((p) => p.slice());
      if (kind === 'length' && value > 0) {
        const { value: rounded, rounded: changed } = roundStretch(value);
        flash = changed ? texts.rounded(rounded) : '';
        send('replace', withStretchLength(points, index, rounded), model.corners);
      } else if (kind === 'radius' && value >= 0) {
        flash = '';
        send('replace', points, withCornerRadius(model.corners, index, value));
      }
    }
    if (refocus) drawing.focus();
  }
  dimField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      closeField(true, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeField(false, true);
    }
  });
  dimField.addEventListener('blur', () => closeField(true, false));

  // The dimension under a press: its words, or the square mark of a corner.
  const dimAt = ([x, y]) => dims.find((d) => x >= d.box.x0 - 4 && x <= d.box.x1 + 4 && y >= d.box.y0 - 4 && y <= d.box.y1 + 4);

  drawing.addEventListener('pointerdown', (event) => {
    if (!model || !view || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const local = svgPoint(drawing, event);
    const at = [local.x, local.y];
    const d = dimAt(at);
    if (d) {
      event.preventDefault();
      openField(d.kind, d.index);
      return;
    }
    const target = hitTest(at);
    if (!target) return;
    event.preventDefault();
    const points = current().map((p) => p.slice());
    const corners = currentCorners().slice();
    latest = null;
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
    flash = '';
    selected = index;
    hover = null;
    drag = { index, pointerId: event.pointerId, points, corners };
    setCursor();
    drawing.setPointerCapture(event.pointerId);
    onEdit({ type: 'begin' });
    if (target.type !== 'point') send('move', points, corners);
    else draw();
  });

  drawing.addEventListener('pointermove', (event) => {
    if (!drag && model && view && event.pointerType !== 'touch') {
      const local = svgPoint(drawing, event);
      const next = local.x < planWidth ? hitTest([local.x, local.y]) : null;
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
    drag.points[drag.index] = snapPoint(drag.points, drag.index, toPlan([local.x, local.y]));
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
    let { points, corners } = ended;
    // A point dropped on its neighbour joins it: the inner one of the two goes.
    const i = ended.index;
    const [sx, sy] = toScreen(points[i]);
    for (const j of [i - 1, i + 1]) {
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
    if (/^[0-9.,]$/.test(event.key)) {
      event.preventDefault();
      flash = '';
      openField('length', at > 0 ? at - 1 : 0, event.key === ',' ? '.' : event.key);
      return;
    }
    if (event.key === 'r' || event.key === 'R') {
      if (at === 0 || at === n - 1) return;
      event.preventDefault();
      flash = '';
      openField('radius', at);
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
    keysHint.hidden = !drawing.matches(':focus-visible');
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
  const linePath = svg('path', { stroke: INK, 'stroke-width': 2.5, fill: 'none' });
  const redLayer = layer();
  const endMark = svg('line', { stroke: INK, 'stroke-width': 2 });
  const dimLines = svg('path', { class: 'dimension-lines', stroke: GREY, 'stroke-width': 1, fill: 'none', 'pointer-events': 'none' });
  const dimLayer = layer();
  const startText = svg('text', { fill: INK, 'font-size': CAPTION, 'text-anchor': 'middle', 'pointer-events': 'none' }, texts.start);
  const frontText = svg('text', { fill: GREY, 'font-size': CAPTION, 'text-anchor': 'middle', 'pointer-events': 'none' }, texts.front);
  const ghostLayer = layer();
  const hoverLayer = layer();
  const pointLayer = layer();
  const section = svg('g', { class: 'section' });
  const sectionHit = svg('rect', { fill: PAPER, 'fill-opacity': 0 });
  const sectionCourses = layer();
  const heightText = svg('text', { fill: GREY, 'font-size': CAPTION, 'text-anchor': 'middle', 'pointer-events': 'none' });
  section.append(sectionHit, sectionCourses);
  drawing.append(gridLayer, scaleBar, scaleText, ...hintTexts, readoutText, band, linePath, redLayer, endMark, dimLines, dimLayer, startText, frontText, ghostLayer, hoverLayer, pointLayer);
  sectionSvg.append(section, heightText);
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
    setText(heightText, texts.heightValue(model.height));
    attrs(heightText, { x: w / 2, y: CAPTION });
  }

  function draw() {
    const { line, points, lambda, red } = model;
    const gkey = `${width}|${height}|${view.scale}|${view.ox}|${view.oy}`;
    if (gkey !== gridKey) {
      gridKey = gkey;
      const lines = [];
      const [x0, y1] = toPlan([0, 0]);
      const [x1, y0] = toPlan([planWidth, height]);
      for (let gx = Math.ceil(x0 / GRID) * GRID; gx <= x1; gx += GRID) {
        const [sx] = toScreen([gx, 0]);
        lines.push(svg('line', { x1: sx, y1: 0, x2: sx, y2: height, stroke: RULE, 'stroke-width': 1 }));
      }
      for (let gy = Math.ceil(y0 / GRID) * GRID; gy <= y1; gy += GRID) {
        const [, sy] = toScreen([0, gy]);
        lines.push(svg('line', { x1: 0, y1: sy, x2: planWidth, y2: sy, stroke: RULE, 'stroke-width': 1 }));
      }
      gridLayer.replaceChildren(...lines);
      const bar = view.scale * scaleUnit();
      attrs(scaleBar, { d: `M10 ${height - 10} v-6 M10 ${height - 13} h${bar} M${10 + bar} ${height - 10} v-6` });
      attrs(scaleText, { x: 10, y: height - 18 });
      setText(scaleText, scaleUnit() === 1 ? '1 m' : '0.5 m');
    }

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
    const marks = pool(hoverLayer, hover && !drag ? 1 : 0, () => svg('circle', { class: 'hover-mark', stroke: CHOSEN, 'stroke-width': 2 }));
    if (marks.length) {
      const [hx, hy] = hover.type === 'point' ? toScreen(points[hover.index]) : toScreen(hover.plan);
      const onLine = hover.type === 'line';
      attrs(marks[0], { cx: hx, cy: hy, r: onLine ? GHOST_RADIUS + 1 : POINT_RADIUS + 5, fill: onLine ? PAPER : 'none' });
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

  // The words of the drawing, each in its place and none on another: the hint
  // in the top lines, the bend at the bottom right, the dimensions beside
  // their stretches and arcs, then Start and Front where nothing is.
  function drawWords(back, shownGhosts) {
    const { line, points, red } = model;
    let lines;
    let tone = GREY;
    let said = '';
    if (model.refusal) {
      lines = [model.refusal === 'square' ? texts.squareHint : texts.refusedHint];
      tone = RED;
      said = lines[0];
    } else if (flash) {
      lines = [flash];
      said = flash;
    } else if (model.tooShort) {
      lines = [texts.outOfRange];
      said = texts.outOfRange;
    } else if (points.length >= MAX_POINTS) {
      lines = [texts.mostPoints];
      said = texts.mostPoints;
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

    const obstacles = lines.map((text, i) => textBox(text, 10, 16 + HINT_LINE * i, { size: CAPTION }));
    const label = scaleUnit() === 1 ? '1 m' : '0.5 m';
    obstacles.push(textBox(label, 10, height - 18, { size: CAPTION }));
    obstacles.push({ x0: 10, x1: 10 + view.scale * scaleUnit(), y0: height - 16, y1: height - 8 });
    const bend = model.bend;
    if (Number.isFinite(bend)) {
      const text = texts.readoutBend(model.lambda, bend, model.minimum);
      attrs(readoutText, { x: planWidth - 10, y: height - 10, fill: red.length ? RED : GREY, visibility: 'visible' });
      setText(readoutText, text);
      obstacles.push(textBox(text, planWidth - 10, height - 10, { size: CAPTION, anchor: 'end' }));
    } else {
      attrs(readoutText, { visibility: 'hidden' });
    }
    obstacles.push(...lineBoxes(back, 7, 8));
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
    for (const c of line.corners) {
      if (c.kind === 'sharp') {
        if (!c.square) continue;
        const p = toScreen(points[c.index]);
        const a = toScreen(points[c.index - 1]);
        const b = toScreen(points[c.index + 1]);
        const u = [(a[0] - p[0]) / (Math.hypot(a[0] - p[0], a[1] - p[1]) || 1), (a[1] - p[1]) / (Math.hypot(a[0] - p[0], a[1] - p[1]) || 1)];
        const v = [(b[0] - p[0]) / (Math.hypot(b[0] - p[0], b[1] - p[1]) || 1), (b[1] - p[1]) / (Math.hypot(b[0] - p[0], b[1] - p[1]) || 1)];
        const q = (s, t) => `${(p[0] + u[0] * s + v[0] * t).toFixed(1)} ${(p[1] + u[1] * s + v[1] * t).toFixed(1)}`;
        marksD.push(`M${q(12, 0)} L${q(12, 12)} L${q(0, 12)}`);
        shown.push({ kind: 'radius', index: c.index, text: null, box: boxAround(...toScreen([points[c.index][0], points[c.index][1]]).map((value, i) => value + (u[i] + v[i]) * 8), 8) });
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
    if (points.length >= 3) {
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
        const spot = place([[bx, by, 24], [bx, by, 36], [-bx, -by, 36], [-bx, -by, 48]]
          .map(([vx, vy, dd]) => at(mx + vx * dd, my + vy * dd + 4, text)), obstacles, planWidth, height);
        if (!spot) continue;
        obstacles.push(spot.box);
        const off = 12 * Math.sign((spot.x - mx) * bx + (spot.y - 4 - my) * by || 1);
        const ox = bx * off;
        const oy = by * off;
        const tick = (x, y) => `M${(x - 3 * (ux + bx)).toFixed(1)} ${(y - 3 * (uy + by)).toFixed(1)} L${(x + 3 * (ux + bx)).toFixed(1)} ${(y + 3 * (uy + by)).toFixed(1)}`;
        marksD.push(`M${(a[0] + ox).toFixed(1)} ${(a[1] + oy).toFixed(1)} L${(b[0] + ox).toFixed(1)} ${(b[1] + oy).toFixed(1)} ${tick(a[0] + ox, a[1] + oy)} ${tick(b[0] + ox, b[1] + oy)}`);
        shown.push({ kind: 'length', index: k, text, x: spot.x, y: spot.y, box: spot.box });
      }
    }
    dims = shown;
    const texted = shown.filter((d) => d.text);
    attrs(dimLines, { d: marksD.join(' ') });
    pool(dimLayer, texted.length, () => svg('text', { class: 'dimension', fill: GREY, 'font-size': CAPTION, 'text-anchor': 'middle' }))
      .forEach((node, i) => {
        const d = texted[i];
        attrs(node, { x: d.x, y: d.y, 'data-kind': d.kind, 'data-index': d.index });
        setText(node, d.text);
      });

    const start = line.pointAt(0);
    const [stx, sty] = toScreen([start.x, start.y]);
    const sb = Math.sin(start.bearing);
    const cb = Math.cos(start.bearing);
    const startAt = place([
      ...ringAround(stx, sty, [sb, cb], 22),
      ...ringAround(stx, sty, [sb, cb], 32),
    ].map((c) => at(c.x, c.y, texts.start)), obstacles, planWidth, height);
    attrs(startText, startAt ? { x: startAt.x, y: startAt.y, visibility: 'visible' } : { visibility: 'hidden' });
    if (startAt) obstacles.push(startAt.box);

    const frontAt = place([0.5, 0.35, 0.65, 0.2, 0.8].map((f) => {
      const p = line.pointAt(line.length * f);
      const [mx, my] = toScreen([p.x, p.y]);
      return at(mx - Math.sin(p.bearing) * 28, my - Math.cos(p.bearing) * 28 + 4, texts.front);
    }), obstacles, planWidth, height);
    attrs(frontText, frontAt ? { x: frontAt.x, y: frontAt.y, visibility: 'visible' } : { visibility: 'hidden' });
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
      sectionHeight = Math.max(24, height - 3 * (ROW + GAP));
      attrs(drawing, { viewBox: `0 0 ${planWidth} ${height}`, width: planWidth, height });
      attrs(sectionSvg, { viewBox: `0 0 ${sectionWidth} ${sectionHeight}`, width: sectionWidth, height: sectionHeight });
      gridKey = '';
    }
    if ((!drag && !keyPoints) || !view) fitView();
    if (selected >= model.points.length) selected = model.points.length - 1;
    setText(readout, Number.isFinite(model.bend) ? texts.readoutBend(model.lambda, model.bend, model.minimum) : '');
    undo.disabled = !model.canUndo;
    more.disabled = model.courses >= model.coursesRange[1];
    less.disabled = model.courses <= model.coursesRange[0];
    if (document.activeElement !== coursesField) coursesField.value = String(model.courses);
    if (document.activeElement !== lengthInput) lengthInput.value = texts.lengthValue(model.length);
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

  return { update, isDragging: () => Boolean(drag), clearFlash };
}
