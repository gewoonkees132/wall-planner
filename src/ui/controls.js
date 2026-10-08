// The controls panel (revision 1, parts 3 and 4; the Aicher loop): who
// stacks it, the drawer (the line, the length, the courses), the motif, how the
// blocks vary, the brush, and the colours. Every row is a label in its
// track and a control on four tracks beside it, so every key of the panel
// starts on one of five lines. Every control changes the state and nothing
// else; the panel is built once and updated from the state on every change.

import { el, key, pictogram, row } from './dom.js';
import { EARTH_TONES, LETTERS } from '../block.js';
import { RANGES } from '../state.js';
import { STEPS } from '../stacker.js';
import { TEXTS } from '../texts.js';
import { isImage } from '../motif.js';
import { createDialog } from './dialogs.js';

const T = TEXTS;
const STEP_ICONS = { hand: 'person', template: 'template', robot: 'robot' };

// A switch of options on the tracks; the chosen one is filled.
function switchControl(name, options, onSelect) {
  const buttons = options.map(({ value, text, icon = null, span = 1 }) => key(icon, text, {
    class: `switch-option${span > 1 ? ` span-${span}` : ''}`, 'data-value': value, 'aria-pressed': 'false',
    onclick: () => onSelect(value),
  }));
  const tracks = options.reduce((n, o) => n + (o.span || 1), 0);
  const root = el('div', { class: `switch span-${tracks}`, role: 'group', 'aria-label': name }, buttons);
  return {
    root,
    update(value, visible = null) {
      for (const button of buttons) {
        button.setAttribute('aria-pressed', String(button.dataset.value === String(value)));
        button.hidden = visible ? !visible.includes(button.dataset.value) : false;
      }
    },
  };
}

export function createControls(root, { actions, lineEditorRoot }) {
  // Who stacks it: the three answers as a scale of pictograms, the wall's
  // answer filled; the answer in words for a screen reader, and the reason.
  const marks = STEPS.map((step) => el('span', { class: `mark${step === 'template' ? ' span-2' : ''}`, 'data-step': step },
    pictogram(STEP_ICONS[step]), T.stacker.scale[step]));
  const answer = el('span', { class: 'stacker-answer sr-only' });
  const reason = el('span', { class: 'stacker-reason' });
  const stacker = row(T.stacker.label, [
    el('div', { class: 'scale span-4', 'aria-hidden': 'true' }, marks),
    el('p', { class: 'stacker-line span-4' }, answer, reason),
  ], { extra: 'stacker' });
  stacker.setAttribute('role', 'status');
  stacker.setAttribute('aria-live', 'polite');

  // Motif: the key shows the choice, its pictogram and its name, and opens
  // the picker; Edit cells opens the tile editor; the digit stepper shows
  // for the Digit.
  let motifIcon = pictogram('diamond');
  let shownMotif = 'diamond';
  const motifName = document.createTextNode('');
  const motifButton = el('button', {
    type: 'button', class: 'key motif-button span-2', 'aria-haspopup': 'dialog', 'aria-label': T.motif.choose,
    onclick: () => actions.openPicker(motifButton),
  }, motifIcon, motifName);
  const editButton = key('cells', T.motif.edit, { class: 'span-2', 'aria-haspopup': 'dialog', onclick: () => actions.openCells(editButton) });
  // The digit's less and more take the tracks that Edit cells leaves free
  // for an image; its value is on the motif key, beside its name.
  const digitLess = key('minus', null, { class: 'step', 'aria-label': `${T.pattern.digitLabel}: less`, onclick: () => actions.setDigit(-1) });
  const digitMore = key('plus', null, { class: 'step', 'aria-label': `${T.pattern.digitLabel}: more`, onclick: () => actions.setDigit(1) });
  const motifRow = row(T.motif.label, [motifButton, editButton, digitLess, digitMore]);
  const motifMessage = el('p', { class: 'message', role: 'status' });

  // Blocks: how they vary.
  const blocks = switchControl(T.blocks.label, [
    { value: 'set', text: T.blocks.turnSet, icon: 'angles-set' },
    { value: 'free', text: T.blocks.turnFree, icon: 'angles-free', span: 2 },
    { value: 'depth', text: T.blocks.depth, icon: 'depth' },
  ], (value) => actions.setBlocks(value));
  const blocksRow = row(T.blocks.label, blocks.root);

  // Turn: the brush's direction, Undo and Reset.
  const turnDir = switchControl(T.turn.label, [
    { value: 'left', text: T.turn.left, icon: 'left' },
    { value: 'right', text: T.turn.right, icon: 'right' },
  ], (value) => actions.setTurnDir(value));
  const turnUndo = key('undo', T.turn.undoTurn, { onclick: () => actions.undoTurn() });
  const turnReset = key('reset', T.turn.reset, { 'aria-label': T.turn.resetTurns, onclick: () => actions.resetTurns() });
  const turnRow = row(T.turn.label, [turnDir.root, turnUndo, turnReset]);
  const turnMessage = el('p', { class: 'message', role: 'status' });

  // Count: the depths for Depth. With colours on, the count is the
  // colours' own: fewer and more beside Off and On.
  const [fewest, most] = RANGES.types;
  const counts = Array.from({ length: most - fewest + 1 }, (_, i) => String(fewest + i));
  const count = switchControl(T.blocks.countLabel, counts.map((value) => ({ value, text: value })),
    (value) => actions.setTypes(Number(value)));
  const countRow = row(T.blocks.countLabel, count.root);

  // Colours: off or on, the swatches beside it; a tap on a swatch opens the picker.
  const colourOn = switchControl(T.colours.label, [
    { value: 'off', text: T.colours.off, icon: 'colour-off' },
    { value: 'on', text: T.colours.on, icon: 'colour-on' },
  ], (value) => actions.setColourOn(value === 'on'));
  let pickerTarget = null;
  const quickPicks = EARTH_TONES.map((tone) => el('button', {
    type: 'button', class: 'quick-pick', 'data-hex': tone.hex,
    onclick: () => choose(tone.hex),
  }, el('span', { class: 'swatch-dot', style: `background:${tone.hex}` }), tone.name));
  const ownInput = el('input', { type: 'color', id: 'own-colour', class: 'own-colour' });
  ownInput.addEventListener('input', () => choose(ownInput.value, false));
  ownInput.addEventListener('change', () => choose(ownInput.value));
  // The picker is a dialog, as the motif picker is: its tones as keys with
  // the chosen one filled, Own colour and Close. In the panel it took two
  // rows, below the screen's edge; as a dialog it takes none.
  const colourDialog = createDialog({ id: 'colour-dialog', title: T.colours.one, closeText: T.colours.close });
  colourDialog.body.append(
    el('div', { class: 'quick-picks' }, quickPicks),
    el('label', { class: 'own-colour-label', for: 'own-colour' }, ownInput, T.colours.ownColour));
  document.body.append(colourDialog.node);
  const colourTitle = colourDialog.node.querySelector('.dialog-title');
  colourDialog.node.addEventListener('close', () => {
    pickerTarget = null;
    actions.refresh();
  });

  function choose(hex, close = true) {
    if (pickerTarget === null) return;
    if (pickerTarget === 'one') actions.setOneColour(hex);
    else actions.setColour(pickerTarget, hex);
    if (close) colourDialog.close();
  }

  function openPicker(target, from) {
    pickerTarget = target;
    colourTitle.textContent = target === 'one' ? T.colours.one : T.colours.titleOf(LETTERS[target]);
    colourDialog.open(from);
    actions.refresh();
  }

  // A swatch's letter stands on a chip of paper, so it reads on any colour.
  const swatches = LETTERS.map((letter, i) => el('button', {
    type: 'button', class: 'swatch', 'aria-haspopup': 'dialog', onclick: () => openPicker(i, swatches[i]),
  }, el('span', { class: 'letter' }, letter)));
  // The one colour, with colours off: its swatch and its name.
  const oneChip = el('span', { class: 'swatch-dot' });
  const oneName = document.createTextNode('');
  const oneSwatch = el('button', {
    type: 'button', class: 'key one-colour span-2', 'aria-haspopup': 'dialog', onclick: () => openPicker('one', oneSwatch),
  }, oneChip, oneName);
  const swatchRow = el('div', { class: 'swatches span-2' }, ...swatches, oneSwatch);
  // Colours off: Off, On and the one colour's swatch on the four tracks.
  // Colours on: Off, On, fewer and more; the swatches, one per colour, on
  // the four tracks below, so they show the count themselves.
  let currentTypes = 3;
  const colourFewer = key('minus', null, { class: 'step', 'aria-label': T.colours.fewer, onclick: () => actions.setTypes(currentTypes - 1) });
  const colourMore = key('plus', null, { class: 'step', 'aria-label': T.colours.more, onclick: () => actions.setTypes(currentTypes + 1) });
  const coloursRow = row(T.colours.label, [colourOn.root, colourFewer, colourMore, swatchRow]);

  root.append(
    stacker, lineEditorRoot,
    motifRow, motifMessage, blocksRow, turnRow, turnMessage, countRow, coloursRow,
  );

  let flashText = '';
  function flash(text) {
    flashText = text;
    turnMessage.textContent = text;
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => {
      flashText = '';
      turnMessage.textContent = '';
    }, 4000);
  }

  // The panel shows no point of the base line, so a drag leaves it alone:
  // it is updated only when something it shows has changed.
  let shownKey = '';

  function update(state, wall, { who, canUndoTurn }) {
    const shown = JSON.stringify([
      state.length, wall.lambda, state.courses, state.preset, state.digit, state.vary, state.angles, state.colour, state.types,
      state.colours, state.oneColour, state.turnDir, state.turns.length, canUndoTurn, wall.height, wall.notice, pickerTarget, who,
    ]);
    if (shown === shownKey) return;
    shownKey = shown;

    answer.textContent = T.stacker[who.key];
    reason.textContent = T.stacker.reasons[who.reason];
    for (const mark of marks) mark.classList.toggle('on', mark.dataset.step === who.key);

    if (state.preset !== shownMotif) {
      const icon = pictogram(state.preset);
      motifIcon.replaceWith(icon);
      motifIcon = icon;
      shownMotif = state.preset;
    }
    motifName.data = state.preset === 'digit' ? `${T.pattern.presets.digit} ${state.digit}` : T.pattern.presets[state.preset];
    editButton.hidden = isImage(state.preset);
    const digitShown = state.preset === 'digit';
    digitLess.hidden = !digitShown;
    digitMore.hidden = !digitShown;
    digitLess.disabled = state.digit <= 0;
    digitMore.disabled = state.digit >= 9;
    motifMessage.textContent = digitShown && wall.notice ? wall.notice : '';

    const byRotation = state.vary === 'rotation';
    blocks.update(byRotation ? state.angles : 'depth');
    turnRow.hidden = !byRotation;
    turnDir.update(state.turnDir);
    turnUndo.disabled = !canUndoTurn;
    turnReset.disabled = state.turns.length === 0;
    if (!byRotation) turnMessage.textContent = '';
    else if (!flashText) turnMessage.textContent = '';

    countRow.hidden = !(state.vary === 'depth' && !state.colour);
    count.update(String(state.types));

    colourOn.update(state.colour ? 'on' : 'off');
    currentTypes = state.types;
    colourFewer.hidden = !state.colour;
    colourMore.hidden = !state.colour;
    colourFewer.disabled = state.types <= fewest;
    colourMore.disabled = state.types >= most;
    swatchRow.classList.toggle('span-4', state.colour);
    swatchRow.classList.toggle('span-2', !state.colour);
    swatches.forEach((swatch, i) => {
      swatch.hidden = !state.colour || i >= state.types;
      if (state.colour && i < state.types) {
        const hex = state.colours[i];
        swatch.style.background = hex;
        const tone = EARTH_TONES.find((t) => t.hex === hex);
        swatch.setAttribute('aria-label', T.info.rowColour(LETTERS[i], tone ? tone.name : T.colours.ownColour));
      }
    });
    oneSwatch.hidden = state.colour;
    oneChip.style.background = state.oneColour;
    const oneTone = EARTH_TONES.find((t) => t.hex === state.oneColour);
    const oneToneName = oneTone ? oneTone.name : T.colours.ownColour;
    oneName.data = oneToneName;
    oneSwatch.setAttribute('aria-label', `${T.colours.one}: ${oneToneName}`);
    if (pickerTarget !== null && ((pickerTarget === 'one' && state.colour) || (pickerTarget !== 'one' && (!state.colour || pickerTarget >= state.types)))) {
      colourDialog.close();
    }
    const pickedHex = pickerTarget === null ? null : pickerTarget === 'one' ? state.oneColour : state.colours[pickerTarget];
    for (const pick of quickPicks) pick.setAttribute('aria-pressed', String(pick.dataset.hex === pickedHex));
    if (pickedHex && document.activeElement !== ownInput) ownInput.value = pickedHex;
  }

  return { update, flash };
}
