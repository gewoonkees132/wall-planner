// One history of the page's edits that have an Undo key in the panel (pass
// 4 of the Aicher loop, docs/specs/configurator-demonstrator-ux-aicher.md,
// part 12.1, rule 13): the scope of each edit, in the order it was done, so
// Ctrl+Z takes back the last thing done. Each Undo key keeps its own scope
// and takes its last edit out of the order. Pure: no browser objects.

export function createEdits() {
  let order = [];
  return {
    // An edit was done in a scope: 'drawer' or 'turn'.
    push(scope) {
      order.push(scope);
    },
    // The last edit of a scope was taken back, or turned out to change nothing.
    forget(scope) {
      const i = order.lastIndexOf(scope);
      if (i >= 0) order.splice(i, 1);
    },
    // A scope's history was emptied; with no scope, every one.
    clear(scope) {
      order = scope ? order.filter((s) => s !== scope) : [];
    },
    // The scope Ctrl+Z takes back, or null.
    last() {
      return order.length ? order[order.length - 1] : null;
    },
  };
}
