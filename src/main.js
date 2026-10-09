// Wires the state, the views and the controls (design, part 3, "What
// happens on a change"; revision 1): every control changes the state; pure
// functions compute the wall; the 3D view, the editors and the information
// redraw from that result, once per animation frame.

import { BLOCK, MAX_TURNS, MORTAR_ABOVE } from './block.js';
import { TEXTS } from './texts.js';
import {
  defaultState, withCourses, withPreset, withDigit, withVary, withAngles, withColourOn, withTypes,
  withColour, withOneColour, withTurn, withTurnsCleared, withTurnDir, withView, withCellCycled, withTile, withPoints,
  encodeState, decodeState, RANGES,
} from './state.js';
import { computeWall, planRows, toCsv } from './plan.js';
import { openFitting, nextFitting } from './fitting.js';
import { orderList, summary } from './counts.js';
import { activeTile, patternTypes, deepestDepth } from './mapping.js';
import { presetTile, IMAGE_PRESETS, PATTERN_PRESETS, isImage } from './motif.js';
import { baseLine } from './line.js';
import { bendBands } from './limits.js';
import { pitchOf, wallHeight } from './bond.js';
import { whoStacks } from './stacker.js';
import { createView3d } from './view3d.js';
import { createControls } from './ui/controls.js';
import { createPatternEditor, createPreview } from './ui/pattern-editor.js';
import { createLineEditor } from './ui/line-editor.js';
import { createInfo } from './ui/info.js';
import { createDialog, textDialog, opener } from './ui/dialogs.js';
import { createEdits } from './edits.js';
import { el, svg, key } from './ui/dom.js';

// The modules run, so the line for a browser that cannot run them goes.
document.getElementById('no-modules')?.remove();

const byId = (id) => document.getElementById(id);
const ADDRESS_PAUSE = 300; // ms, placeholder
const PREVIEW_WIDTH = 150; // px, the picker's tiles, placeholder

// The page's one state, the wall computed from it, and the last wall that
// fits: when the base line is red, the 3D view, the counts, the plan file
// and the address keep that one (design, part 4 and 6.5).
let state = location.hash.length > 1 ? decodeState(location.hash) : defaultState();
let wall = computeWall(state);
let fitting = openFitting(state);
let drawnWall = null;
let tileHistory = [];
let drawerHistory = []; // the drawer's: points, corners, courses and length before each edit
let turnHistory = [];
// Pass 4 (part 12.1, rule 13): the order of the drawer's edits and the turns, for Ctrl+Z.
const edits = createEdits();
let dragging = false;
let scheduled = false;
let dirty = false; // the state changed and its wall is not computed yet
let addressTimer = null;

document.title = TEXTS.header.tab;
// The header stands on the zones' grid: the title over the controls, the
// purpose over the 3D view, the mock-up sentence over the numbers it is about.
byId('header').append(
  el('h1', {}, TEXTS.header.title),
  el('p', { class: 'purpose' }, TEXTS.header.purpose),
  el('p', { class: 'mockup' }, TEXTS.header.mockup),
);

// After a pause the state is written into the address by replacing the
// current entry, so the back button does not step through every drag.
// Only a wall that fits is written.
function scheduleAddress() {
  clearTimeout(addressTimer);
  addressTimer = setTimeout(() => {
    settle();
    if (!fitting.wall.ok) return;
    const address = encodeState(fitting.state);
    if (address !== location.hash) history.replaceState(null, '', address);
  }, ADDRESS_PAUSE);
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(render);
}

// The wall of the latest state, computed once however many changes came
// since: a drag sends more moves than there are frames.
function settle() {
  if (!dirty) return;
  dirty = false;
  wall = computeWall(state);
  fitting = nextFitting(state, wall, fitting);
}

function act(transform) {
  const next = transform(state);
  if (next === state) return;
  state = next;
  dirty = true;
  schedule();
  scheduleAddress();
}

// The dialogs: the two to be built, the motif picker and the tile editor.
const orderDialog = textDialog('order-dialog', TEXTS.actions.orderDialog);
const manualDialog = textDialog('manual-dialog', TEXTS.actions.manualDialog);
const picker = createDialog({ id: 'motif-dialog', title: TEXTS.motif.choose, closeText: TEXTS.motif.close });
const cells = createDialog({ id: 'cells-dialog', title: TEXTS.pattern.cellsTitle, closeText: TEXTS.pattern.close });

const actions = {
  setDigit(sign) {
    act((s) => withDigit(s, s.digit + sign));
  },
  setPreset(preset) {
    tileHistory = [];
    turnHistory = [];
    edits.clear('turn');
    act((s) => withPreset(s, preset));
  },
  setBlocks(value) {
    tileHistory = [];
    act((s) => {
      if (value === 'depth') return withVary(s, 'depth');
      return withAngles(withVary(s, 'rotation'), value);
    });
  },
  setTurnDir(dir) {
    act((s) => withTurnDir(s, dir));
  },
  undoTurn() {
    if (!turnHistory.length) return;
    const previous = turnHistory.pop();
    edits.forget('turn');
    act((s) => ({ ...s, turns: previous }));
  },
  resetTurns() {
    if (!state.turns.length) return;
    turnHistory.push(state.turns);
    edits.push('turn');
    act((s) => withTurnsCleared(s));
  },
  setColourOn(on) {
    act((s) => withColourOn(s, on));
  },
  setTypes(k) {
    tileHistory = [];
    act((s) => withTypes(s, k));
  },
  setColour(index, hex) {
    act((s) => withColour(s, index, hex));
  },
  setOneColour(hex) {
    act((s) => withOneColour(s, hex));
  },
  openPicker(from) {
    renderPicker();
    picker.open(from);
  },
  openCells(from) {
    cells.open(from);
    schedule();
  },
  refresh() {
    schedule();
  },
};

// The drawer's one drawerHistory (pass 3, part 11.4): the points, corners,
// courses and length before each edit, so Undo and Ctrl+Z step back
// through everything the drawer sets.
const snapshot = (s) => JSON.stringify([s.points, s.corners, s.courses, s.length]);
function remember() {
  drawerHistory.push({ points: state.points, corners: state.corners, courses: state.courses, length: state.length });
  edits.push('drawer');
}
const unchanged = () => drawerHistory.length > 0 && snapshot(drawerHistory.at(-1)) === snapshot(state);
// An edit that changed nothing leaves no step to undo (pass 4, part 12.1, rule 6).
function dropIfUnchanged() {
  if (!unchanged()) return;
  drawerHistory.pop();
  edits.forget('drawer');
}
function undoDrawer() {
  if (!drawerHistory.length) return;
  const previous = drawerHistory.pop();
  edits.forget('drawer');
  lineEditor.clearFlash();
  act((s) => ({ ...s, ...previous }));
}

const lineRoot = el('div', {});
const lineEditor = createLineEditor(lineRoot, {
  texts: TEXTS.wall,
  keys: TEXTS.keys,
  onEdit({ type, points, corners, courses, value }) {
    const apply = (s) => (points ? withPoints(s, points, corners) : courses !== undefined ? withCourses(s, courses) : s);
    if (type === 'begin') {
      remember();
      dragging = true;
    } else if (type === 'move') {
      act(apply);
    } else if (type === 'end') {
      dragging = false;
      act(apply);
      dropIfUnchanged();
      schedule();
    } else if (type === 'replace') {
      remember();
      act(apply);
      dropIfUnchanged();
      schedule();
    } else if (type === 'courses') {
      remember();
      act((s) => withCourses(s, value));
      dropIfUnchanged();
      schedule();
    } else if (type === 'undo') {
      undoDrawer();
    }
  },
});

// The tile editor, inside the Edit cells dialog.
const patternRoot = el('div', { class: 'pattern-editor' });
const patternEditor = createPatternEditor(patternRoot, {
  keys: TEXTS.keys,
  onTap(i, j) {
    const tile = activeTile(state);
    tileHistory.push(state.tile);
    act((s) => withCellCycled(s, tile, i, j));
  },
  onUndo() {
    if (!tileHistory.length) return;
    const previous = tileHistory.pop();
    act((s) => withTile(s, previous));
  },
  onReset() {
    if (!state.tile) return;
    tileHistory.push(state.tile);
    act((s) => withTile(s, null));
  },
});
cells.body.append(patternRoot);

// The motif picker: six tiles with a preview each; one tap picks and closes.
const previews = new Map();
function tileButton(preset) {
  const drawing = svg('svg', { role: 'img', 'aria-hidden': 'true' });
  previews.set(preset, createPreview(drawing, PREVIEW_WIDTH));
  const button = el('button', {
    type: 'button', class: 'tile', 'data-preset': preset, 'aria-pressed': 'false',
    onclick: () => {
      actions.setPreset(preset);
      picker.close();
    },
  }, drawing, el('span', {}, TEXTS.pattern.presets[preset]));
  return button;
}
const tileButtons = [...IMAGE_PRESETS, ...PATTERN_PRESETS].map(tileButton);
picker.body.append(
  el('p', { class: 'tile-group' }, `${TEXTS.motif.images}: ${TEXTS.motif.helpImage}`),
  el('div', { class: 'tiles' }, tileButtons.slice(0, IMAGE_PRESETS.length)),
  el('p', { class: 'tile-group' }, `${TEXTS.motif.patterns}: ${TEXTS.motif.helpPattern}`),
  el('div', { class: 'tiles' }, tileButtons.slice(IMAGE_PRESETS.length)),
  el('p', { class: 'help' }, TEXTS.motif.own),
);

function fillModel(s) {
  return { vary: s.vary, colour: s.colour, types: patternTypes(s), colours: s.colours.slice(0, s.types), oneColour: s.oneColour };
}

// The previews show every motif in the wall's current way to vary: a
// pattern as one repeat, an image on a 3.00 m wall of 7 courses.
function renderPicker() {
  for (const [preset, preview] of previews) {
    const base = { ...state, preset, tile: null, turns: [] };
    if (isImage(preset)) {
      const sample = computeWall({ ...base, points: [[0, 0], [3.0, 0]], length: 3.0, courses: Math.max(7, state.courses) });
      preview.update({ ...fillModel(base), units: sample.units, lambda: sample.lambda, n: sample.n, courseHeight: BLOCK.height });
    } else {
      preview.update({ ...fillModel(base), tile: presetTile(preset, patternTypes(base)), p: pitchOf({ rotation: state.vary === 'rotation' }).p, courseHeight: BLOCK.height });
    }
  }
  for (const button of tileButtons) button.setAttribute('aria-pressed', String(button.dataset.preset === state.preset));
}

const controls = createControls(byId('controls'), { actions, lineEditorRoot: lineRoot });

// Without WebGL the view says why it is empty and does nothing else.
const view = createView3d(byId('view'), {
  texts: TEXTS,
  onView(name) {
    act((s) => withView(s, name));
    view.setView(name);
  },
  // A tap on a block of the wall turns it and its neighbours.
  onTapUnit(unit) {
    if (!unit || unit.kind !== 'earth' || state.vary !== 'rotation') return;
    if (state.turns.length >= MAX_TURNS) {
      controls.flash(TEXTS.turn.most);
      return;
    }
    turnHistory.push(state.turns);
    edits.push('turn');
    act((s) => withTurn(s, { x: unit.position, course: unit.course, dir: s.turnDir === 'left' ? -1 : 1 }));
  },
});

const info = createInfo(byId('info'));

// The actions, under the order list they act on: the plan file, the one
// output, first and dark; then the two dialogs to be built.
const download = key('download', TEXTS.actions.download, { class: 'bar primary', title: TEXTS.actions.downloadHelp });
download.addEventListener('click', () => {
  settle();
  const csv = toCsv(planRows(fitting.wall));
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = el('a', { href: url, download: 'stacking-plan.csv', hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});
info.bars.prepend(
  download,
  opener(TEXTS.actions.order, orderDialog, { icon: 'order' }),
  opener(TEXTS.actions.manual, manualDialog, { icon: 'manual' }),
);
document.body.append(orderDialog.node, manualDialog.node, picker.node, cells.node);

// A link pasted into the address bar opens its wall.
window.addEventListener('hashchange', () => {
  state = decodeState(location.hash);
  tileHistory = [];
  drawerHistory = [];
  turnHistory = [];
  edits.clear();
  wall = computeWall(state);
  fitting = openFitting(state);
  dirty = false;
  lineEditor.refit();
  view.setView(state.view);
  schedule();
});

function render() {
  scheduled = false;
  settle();
  const shown = fitting.wall;
  const shownState = fitting.state;
  const list = orderList(shown, shownState);
  // The robot split: the drawer's limit is the robot's, 0.80 m on the wall as it opens.
  const minimum = bendBands(deepestDepth(state), pitchOf({ rotation: state.vary === 'rotation' }).p).robot;
  const who = whoStacks(shown, shownState);
  controls.update(state, shown, { who, canUndoTurn: turnHistory.length > 0 });
  const line = wall.line || baseLine(state.points, state.corners);
  const rounds = (line.corners || []).filter((c) => c.kind === 'free' || c.kind === 'round');
  const notes = [];
  if (state.courses >= RANGES.courses[1]) notes.push(TEXTS.wall.highest);
  if (wallHeight(state.courses) > MORTAR_ABOVE + 1e-9) notes.push(TEXTS.wall.mortar);
  lineEditor.update({
    points: state.points,
    corners: state.corners,
    line,
    lambda: wall.lambda ?? line.usable,
    red: (wall.bends ? wall.bends.failing : []).map((f) => [f.from, f.to]),
    refusal: wall.bends && !wall.bends.ok ? wall.bends.reason : '',
    tooShort: Boolean(wall.tooShort),
    bend: rounds.length ? Math.min(...rounds.map((c) => c.radius)) : Infinity,
    minimum,
    canUndo: drawerHistory.length > 0,
    courses: state.courses,
    coursesRange: RANGES.courses,
    height: wallHeight(state.courses),
    // Pass 5 (part 13.1, rule 1): the length told is the wall's, as the plan file has it.
    told: shown.length,
    notes,
    // The robot split: the band split by worker, for a line that fits.
    split: wall.ok && wall.split ? wall.split.subsections : [],
  });
  if (!isImage(state.preset)) {
    patternEditor.update({
      ...fillModel(state),
      tile: activeTile(state),
      p: shown.p,
      courseHeight: BLOCK.height,
      canUndo: tileHistory.length > 0,
      edited: Boolean(state.tile),
      texts: TEXTS.pattern,
    });
  } else if (cells.isOpen()) {
    cells.close();
  }
  info.update({
    state: shownState, list, text: shown.none ? TEXTS.info.noWall : summary(shown, shownState, list),
    splitText: shown.none ? '' : TEXTS.info.split(list),
  });
  view.setNotice(shown.none ? TEXTS.view.noneFits : !wall.ok);
  view.setBrush(state.vary === 'rotation');
  if (shown !== drawnWall) {
    view.setWall(shown, shown.frame);
    drawnWall = shown;
  }
}

// Ctrl+Z (Cmd+Z) takes back the last thing done, of the drawer's edits and
// the turns (pass 4, part 12.1, rule 13), anywhere but in a text field or a dialog.
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z') return;
  const { target } = event;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  if (edits.last() === 'turn') actions.undoTurn();
  else undoDrawer();
});

view.setView(state.view);
render();
