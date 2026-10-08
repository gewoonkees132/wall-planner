// Small helpers to build the page's elements.

import { PICTOGRAMS, GRID, STROKE } from '../pictograms.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(node, attrs, children) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.setAttribute('class', value);
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function el(tag, attrs, ...children) {
  return apply(document.createElement(tag), attrs, children);
}

export function svg(tag, attrs, ...children) {
  return apply(document.createElementNS(SVG_NS, tag), attrs, children);
}

// A pictogram of the set (pictograms.js), drawn at 20 px in the colour of
// its text, hidden from a screen reader: the word beside it says it.
export function pictogram(name) {
  const { strokes = [], fills = [] } = PICTOGRAMS[name];
  return svg('svg', { class: 'icon', viewBox: `0 0 ${GRID} ${GRID}`, width: GRID, height: GRID, 'aria-hidden': 'true', focusable: 'false' },
    strokes.map((d) => svg('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': STROKE })),
    fills.map((d) => svg('path', { d, fill: 'currentColor' })));
}

// A key: its pictogram above its word; with class "bar", beside it. The
// word is the button's own text, so the button's left edge is the word's.
export function key(icon, text, attrs = {}) {
  return el('button', { type: 'button', ...attrs, class: `key ${attrs.class || ''}`.trim() }, icon ? pictogram(icon) : null, text);
}

// A row: the label in its track, the control in four tracks beside it.
export function row(labelText, control, { id = null, extra = '', cls = 'row' } = {}) {
  const label = el(id ? 'label' : 'span', { class: 'row-label', for: id }, labelText);
  return el('div', { class: `${cls} ${extra}`.trim() }, label, el('div', { class: 'row-control' }, control));
}

// The point of an event in the coordinates of an SVG element.
export function svgPoint(svgElement, event) {
  const ctm = svgElement.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
  return { x: point.x, y: point.y };
}
