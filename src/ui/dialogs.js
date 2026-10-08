// The dialogs (design, part 8; revision 1, part 7): each a small
// <dialog> with a title, a body and a Close button. Escape or the
// backdrop closes it, and focus returns to the button that opened it.

import { el, key } from './dom.js';

export function createDialog({ id, title, closeText }) {
  const closeButton = key('dismiss', closeText, { class: 'bar close' });
  const body = el('div', { class: 'dialog-body' });
  const node = el('dialog', { class: 'dialog', id, 'aria-labelledby': `${id}-title` },
    el('h2', { class: 'dialog-title', id: `${id}-title` }, title),
    body,
    el('div', { class: 'dialog-foot' }, closeButton));
  let opener = null;
  closeButton.addEventListener('click', () => node.close());
  node.addEventListener('click', (event) => {
    if (event.target === node) node.close();
  });
  node.addEventListener('close', () => {
    if (opener && opener.isConnected) opener.focus();
  });
  return {
    node,
    body,
    open(from = null) {
      opener = from;
      if (!node.open) node.showModal();
    },
    close() {
      if (node.open) node.close();
    },
    isOpen: () => node.open,
  };
}

// A bar that opens a dialog: its pictogram beside its word.
export function opener(text, dialog, { icon = null, ...extra } = {}) {
  const button = key(icon, text, { 'aria-haspopup': 'dialog', ...extra, class: `bar ${extra.class || ''}`.trim() });
  button.addEventListener('click', () => dialog.open(button));
  return button;
}

// A dialog of one paragraph: Order blocks and Manual, to be built.
export function textDialog(id, { title, text, close }) {
  const dialog = createDialog({ id, title, closeText: close });
  dialog.body.append(el('p', {}, text));
  return dialog;
}
