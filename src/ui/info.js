// The information (design, part 8; revision 1, part 3): the summary
// sentence, which says the mass and the pallets, the order list with a
// swatch and a letter per row, the base course and the cap, and a button
// that opens the limits and notes, among them what the mass counts. Under the list, the actions on it, as bars: main.js
// puts the plan file, Order blocks and Manual before the limits.

import { el } from './dom.js';
import { CAP_COLOUR, BASE_COLOUR } from '../block.js';
import { shade } from '../colour.js';
import { TEXTS } from '../texts.js';
import { createDialog, opener } from './dialogs.js';

const T = TEXTS.info;

function swatch(colour) {
  return el('span', { class: 'row-swatch', style: `background:${colour}`, 'aria-hidden': 'true' });
}

export function createInfo(root) {
  const sentence = el('p', { class: 'summary-sentence', id: 'summary-sentence' });
  const body = el('tbody');
  const table = el('table', { class: 'order-list' },
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, T.unit),
      el('th', { scope: 'col', class: 'number' }, T.full),
      el('th', { scope: 'col', class: 'number' }, T.half),
      el('th', { scope: 'col', class: 'number' }, T.total))),
    body);

  const limits = createDialog({ id: 'limits-dialog', title: T.limitsTitle, closeText: T.close });
  const limitList = el('ul', { class: 'limits' });
  limits.body.append(limitList, el('p', { class: 'help' }, T.footer));
  const limitsButton = opener(T.limitsButton, limits, { icon: 'info' });
  const bars = el('div', { class: 'bars' }, limitsButton);

  root.append(
    el('h2', { class: 'info-heading', id: 'summary-heading' }, T.heading),
    sentence,
    table,
    bars,
    limits.node,
  );

  function row(name, colour, counts, extra = '') {
    return el('tr', { class: extra },
      el('th', { scope: 'row' }, el('span', { class: 'row-name' }, swatch(colour), name)),
      el('td', { class: 'number' }, String(counts.full)),
      el('td', { class: 'number' }, String(counts.half)),
      el('td', { class: 'number' }, String(counts.total)));
  }

  let shownKey = ''; // what the information shows: it is built again only when that changes

  function update({ state, list, text }) {
    const key = JSON.stringify([text, list, state.vary, state.colour, state.types, state.oneColour]);
    if (key === shownKey) return;
    shownKey = key;
    sentence.textContent = text;
    const rows = list.types.map((t) => {
      let colour = t.colour;
      if (!state.colour && state.vary === 'depth') colour = shade(state.oneColour, 1 - (0.45 * t.type) / Math.max(1, state.types - 1));
      return row(t.name, colour, t);
    });
    rows.push(row(T.base, BASE_COLOUR, list.base, 'other'));
    rows.push(row(T.cap, CAP_COLOUR, list.cap, 'other'));
    body.replaceChildren(...rows);
    const items = [T.limitSoil, T.limitBond, T.limitHeight];
    if (state.vary === 'rotation') items.push(T.limitAngles);
    items.push(T.limitBlock, T.mass(list.mass));
    limitList.replaceChildren(...items.map((item) => el('li', {}, item)));
  }

  return { update, bars };
}
