// Every text on the page (design, part 10; revision 1, part 8), word for
// word. Values in braces in the design are filled in here from the
// computed wall; the block's own numbers come from block.js.
// Pure: no browser objects.

import {
  BLOCK, DEEP_BLOCK, HALF_LENGTH, BASE_HEIGHT, CAP_HEIGHT, MIN_LENGTH, MAX_LENGTH,
  MAX_WALL_HEIGHT, MAX_ANGLE, SET_ANGLES, MORTAR_ABOVE, MAX_TURNS,
} from './block.js';

// A number to d decimals, rounding halves up (0.715 gives 0.72).
export function fixed(x, d) {
  const f = 10 ** d;
  return (Math.round(x * f + 1e-7) / f).toFixed(d);
}

// Whole numbers with a comma for thousands: 3519 gives 3,519.
export function whole(x) {
  return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// "1 pallet", "2 pallets".
export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

const mm = (metres) => Math.round(metres * 1000);
const m2 = (metres) => fixed(metres, 2);
const m1 = (metres) => fixed(metres, 1);
const halves = (h) => (h === 1 ? '1 of them a half block' : `${h} of them half blocks`);
const degrees = (d) => `${d} ${Math.abs(d) === 1 ? 'degree' : 'degrees'}`;

// Why a wall asks for a worker (the robot split, 2026-10-09): the reasons
// of revision 1, and a cut corner or an arc named by its point.
const REASONS = {
  none: 'No block is turned.',
  set: `Blocks turn to ${SET_ANGLES.length} set angles.`,
  free: 'Blocks turn to their own angles.',
  depth: 'Blocks of more than one depth.',
};
function why(reason) {
  if (reason.kind === 'corner') return `Corner ${reason.point}, ${degrees(reason.degrees)}: cut blocks.`;
  if (reason.kind === 'arc') return `Arc ${reason.point}, R ${m2(reason.radius)} m: cut blocks.`;
  if (reason.kind === 'arcTemplate') return `Arc ${reason.point}, R ${m2(reason.radius)} m: with a template.`;
  return REASONS[reason.kind];
}
// The Who row's line: at most two reasons, then how many more.
const SHOWN_REASONS = 2;

export const TEXTS = {
  page: {
    noModules: 'This planner needs a recent browser with JavaScript switched on.',
  },
  // The keyboard paths of the two editors: their hints, and the names a
  // screen reader gives the picked point and the focus cell.
  keys: {
    // The hint of the drawing, in the three lines the drawing shows it in.
    lineLines: ['Space picks a point. Arrows move it 1 cm.', 'Shift: 10 cm. Enter adds, Delete removes.', 'A number types a length, R a radius.'],
    line: 'Space picks a point. Arrows move it 1 cm. Shift: 10 cm. Enter adds, Delete removes. A number types a length, R a radius.',
    pattern: 'Arrows move between cells. Enter or Space changes a cell.',
    point: (i, n, x, y) => `Point ${i} of ${n}: ${fixed(x, 2)} m, ${fixed(y, 2)} m`,
    cell: (course, cell, letter) => `Course ${course}, cell ${cell}: ${letter}`,
  },

  header: {
    title: 'Earth block wall planner',
    purpose: 'Draw a garden wall, choose a motif, and see the earth blocks it takes.',
    mockup: 'This is a mock-up. The numbers depend on a placeholder block.',
    tab: 'Earth block wall planner, a mock-up',
  },

  // Who stacks it: computed from the wall, never chosen; since the robot
  // split, block by block, with each worker's count.
  stacker: {
    label: 'Who stacks it',
    hand: 'You',
    template: 'You, with a template',
    robot: 'A robot',
    // The scale of the three answers, each under its pictogram.
    scale: {
      hand: 'You',
      template: 'With a template',
      robot: 'A robot',
    },
    reasons: REASONS,
    why,
    line: (reasons) => {
      const shown = reasons.slice(0, SHOWN_REASONS).map(why);
      const more = reasons.length - shown.length;
      return [...shown, ...(more > 0 ? [`${more} more.`] : [])].join(' ');
    },
    // What a screen reader hears: each worker's blocks and metres of line.
    spoken: ({ counts, metres }) => ['hand', 'template', 'robot'].map((step) => {
      const word = { hand: 'You', template: 'With a template', robot: 'A robot' }[step];
      return `${word}: ${plural(counts[step], 'block', 'blocks')}, ${m1(metres[step])} m.`;
    }).join(' '),
  },

  wall: {
    lengthLabel: 'Length',
    lengthValue: (metres) => `${m2(metres)} m`,
    rounded: (metres) => `Rounded to ${m2(metres)} m.`,
    outOfRange: `Lengths run from ${m2(MIN_LENGTH)} m to ${MAX_LENGTH.toLocaleString('en-GB')} m.`,
    stepNote: `Steps of half a block, ${m2(HALF_LENGTH)} m.`,
    baseLineCaption: 'Base line, seen from above',
    drawerLabel: 'Wall',
    baseLineHelp: 'Drag a point. Tap the line to add one.',
    // Pass 4: each arc's radius is its R dimension; the readout says the limit, once.
    minimumBend: (minimum) => `Minimum bend: ${m2(minimum)} m.`,
    // The line a screen reader hears, which sees no R dimension: the tightest radius against the minimum.
    spokenBend: (radius, minimum) => `Bend: ${m2(radius)} m, minimum ${m2(minimum)} m.`,
    // Pass 4: what a refusal, a field or the section says.
    wayBack: 'Move a point, or Undo.',
    nearHint: 'The wall comes too near itself.',
    wholeHint: 'No whole blocks fit between these corners.',
    notNumber: 'Not a number: type metres, as 1.20.',
    noCorner: 'No corner at this point.',
    coursesCaption: 'Courses',
    more: 'More',
    less: 'Less',
    start: 'Start',
    front: 'Front',
    undo: 'Undo',
    mostPoints: '10 points is the most.',
    noRoom: 'No room for another point here.',
    // What the drawing says in red when a bend is refused; the 3D view says it keeps the last wall that fits.
    refusedHint: 'Too tight: a larger radius, or Undo.',
    stretchField: (k) => `Stretch ${k}: length`,
    cornerField: (i) => `Corner ${i}: radius`,
    tooTight: (minimum) => `This bend is under ${m1(minimum)} m. Move the points apart or remove one.`,
    afterRelease: 'Showing the last wall that fits. Move the points apart, remove one, or press Undo.',
    // Pass 5 (part 13.1): the keys of a picked point and of a refusal; what
    // the hint line says while a point is picked, while a corner's field is
    // open, and when a bend is too tight.
    remove: 'Remove',
    fit: 'Fit',
    pickHint: 'Tap where it goes.',
    radiusRange: (min, max) => `R from ${m2(min)} to ${m2(max)} m.`,
    radiusSet: (set, drawn) => `R${m2(set)} set; drawn R${m2(drawn)}, the room there.`,
    noRoom: (max) => `Room here for R${m2(max)} at most.`,
    lifted: (min) => `Lifted to the minimum, R${m2(min)}.`,
    scaledTo: (drawn) => `Drawn at R${m2(drawn)}, the room there.`,
    tightRoom: (radius) => `Too tight: room for R${m2(radius)};`,
    tightSet: (radius) => `Too tight: R${m2(radius)};`,
    tightNeed: (minimum) => `the blocks need R${m2(minimum)}.`,
    fitWayBack: 'Fit, or Undo.',
    coursesLabel: 'Earth courses',
    heightValue: (metres) => `${m2(metres)} m`,
    highest: `Highest wall: ${m1(MAX_WALL_HEIGHT)} m.`,
    mortar: `Above ${fixed(MORTAR_ABOVE, 0)} m: in mortar, not stacked dry.`,
    coursesNote: `One course is ${mm(BLOCK.height)} mm; base course and cap add ${mm(BASE_HEIGHT + CAP_HEIGHT)} mm.`,
  },

  // The motif: one button opens the picker; Edit cells opens the tile editor.
  motif: {
    label: 'Motif',
    choose: 'Choose a motif',
    // The motif key's name for a screen reader starts with the word it shows (WCAG 2.2, criterion 2.5.3).
    named: (name) => `${name}: choose a motif`,
    edit: 'Edit cells',
    images: 'Images',
    patterns: 'Patterns',
    helpImage: 'Covers the whole wall.',
    helpPattern: 'Repeats along the wall.',
    own: 'Own images come later.',
    close: 'Close',
  },
  pattern: {
    presets: {
      gradient: 'Gradient',
      wave: 'Wave',
      digit: 'Digit',
      bands: 'Bands',
      chequer: 'Chequer',
      diamond: 'Diamond',
    },
    digitLabel: 'Digit',
    digitTooFew: 'The digit needs at least 7 earth courses.',
    captionPattern: 'One repeat of the pattern. Tap a cell to change it.',
    cellsTitle: 'Edit cells',
    undo: 'Undo',
    reset: 'Reset pattern',
    close: 'Close',
  },

  // How the blocks vary, and the brush.
  blocks: {
    label: 'Blocks',
    turnSet: '9 angles',
    turnFree: 'Free angles',
    depth: 'Depth',
    countLabel: 'Count',
    depthNote: `Depths from ${BLOCK.depth} to ${DEEP_BLOCK.depth} mm; the front shows a relief.`,
  },
  turn: {
    label: 'Turn',
    left: 'Left',
    right: 'Right',
    undoTurn: 'Undo',
    reset: 'Reset',
    resetTurns: 'Reset turns',
    hint: 'Tap the wall.',
    range: `Up to ${MAX_ANGLE} degrees either way.`,
    most: `${MAX_TURNS} taps is the most. Press Undo or Reset.`,
    block: (course, place, deg) => `Course ${course}, block ${place}: ${degrees(deg)}`,
  },
  colours: {
    label: 'Colours',
    off: 'Off',
    on: 'On',
    close: 'Close',
    titleOf: (letter) => `Colour ${letter}`,
    fewer: 'Colours: fewer',
    more: 'Colours: more',
    help: 'Tap a swatch to change it.',
    one: 'Colour',
    ownColour: 'Own colour',
  },

  view: {
    // What the keyboard does on the 3D view, in the place of the hint, while it holds the view.
    keysHint: 'Arrows pick a block. Enter turns it.',
    // The three views, and where the eye stands: on the ground from the wall's nearest part (pass 6, part 14.1, rule 2).
    close: 'Close',
    garden: 'Garden',
    street: 'Street',
    at: (view, metres) => `${view}, ${metres} m`,
    hint: 'Drag to look around. Tap a block to turn it.',
    lastFits: 'Showing the last wall that fits.',
    noneFits: 'No wall fits this line yet.',
    noWebgl: 'No 3D view: this browser has no WebGL.',
  },

  actions: {
    order: 'Order blocks',
    manual: 'Manual',
    download: 'Download stacking plan (CSV)',
    downloadHelp: 'One row per block, for a spreadsheet or a machine.',
    orderDialog: {
      title: 'Order blocks: to be built',
      text: 'Ordering is not built yet. This mock-up sends nothing anywhere.',
      close: 'Close',
    },
    manualDialog: {
      title: 'Manual: to be built',
      text: 'The manual is not built yet. It will show one course per page, every block numbered from the start.',
      close: 'Close',
    },
  },

  info: {
    heading: 'This wall',
    summary: ({ total, half, kinds, turned, kg, pallets }) => {
      const kindText = kinds ? ` in ${plural(kinds.count, kinds.kind, `${kinds.kind}s`)}` : '';
      const turnedText = turned > 0 ? `, ${turned} of them turned` : '';
      return `This wall takes ${plural(total, 'earth block', 'earth blocks')}${kindText}, ${halves(half)}${turnedText}. About ${whole(kg)} kg on ${plural(pallets, 'pallet', 'pallets')}.`;
    },
    noWall: 'Nothing to stack until the line fits.',
    // The robot split: how many blocks people stack, how many are for a robot, and how many of those are cut.
    split: ({ people, robot, cut }) => {
      if (robot === 0) return `For people: all ${plural(people, 'block', 'blocks')}.`;
      let cutText = cut === 1 ? ', 1 of them a cut block' : `, ${cut} of them cut blocks`;
      if (cut === 0) cutText = '';
      else if (cut === robot) cutText = robot === 1 ? ', a cut block' : ', all cut blocks';
      return `For people: ${plural(people, 'block', 'blocks')}. For a robot: ${robot}${cutText}.`;
    },
    unit: 'Unit',
    full: 'Full',
    half: 'Half',
    total: 'Total',
    rowColour: (letter, name) => `${letter} ${name}`,
    ownColour: 'Own colour',
    rowDepth: (letter, depthMm) => `${letter} ${depthMm} mm deep`,
    rowOne: 'Earth block',
    base: 'Base course',
    cap: 'Cap',
    // The summary says the mass and the pallets; the notes say what the mass counts.
    mass: (kg) => `Mass: about ${whole(kg)} kg, earth blocks only`,
    limitsButton: 'Limits and notes',
    limitsTitle: 'Limits and notes',
    limitSoil: 'Garden walls only: free-standing or a bed edge, no soil behind, no structural check.',
    limitBond: 'Bond: each course shifted by half a block, half blocks at the ends.',
    limitHeight: `Height: at most ${m1(MAX_WALL_HEIGHT)} m, base course and cap included.`,
    limitAngles: `Turn: at most ${MAX_ANGLE} degrees either way.`,
    limitBlock: `Placeholder block: an indoor earth block, ${mm(BLOCK.length)} by ${BLOCK.depth} by ${mm(BLOCK.height)} mm, ${BLOCK.mass} kg. It stands in until ours is chosen.`,
    footer: 'The address holds your wall, so a link opens it again. Nothing is sent or stored.',
    close: 'Close',
  },
};
