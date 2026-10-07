// Two snapshot files (.json written by DiffTD): works in every browser, needs no helper.

import { parseSnapshot } from '../schema.js';
import { diffSnapshots } from '../diff.js';
import { t } from '../i18n.js';
import { el } from './dom.js';
import { createDiffView } from './diff-view.js';

export function mountFileMode(root, shell) {
  const files = { before: null, after: null };
  const names = { before: t('files.none'), after: t('files.none') };
  const body = el('div', { class: 'pane-body' });
  const labels = {};
  const pane = el('div', { class: 'pane' });
  const view = createDiffView(body);

  async function load(side, file) {
    files[side] = null;
    view.clear();
    if (!file) return;
    names[side] = file.name;
    labels[side].textContent = file.name;
    try {
      files[side] = parseSnapshot(await file.text());
    } catch (err) {
      shell.showError(t('files.errorFile', { side: t(`files.${side}`), name: file.name, detail: err.message }));
      return;
    }
    shell.clearStatus();
    if (files.before && files.after) {
      view.show(diffSnapshots(files.before, files.after), files.after.meta.root);
    }
  }

  const picker = (side) => {
    const input = el('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', tabindex: -1, 'aria-hidden': 'true', onchange: (e) => load(side, e.target.files[0]) });
    labels[side] = el('span', { class: 'slot-name', text: names[side] });
    return el('div', { class: 'slot' }, el('span', { class: 'slot-label', text: t(`files.${side}`) }), el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn small', onclick: () => input.click() }, t('files.choose')), labels[side], input));
  };

  pane.append(el('div', { class: 'pane-head' }, picker('before'), picker('after')), el('div', { class: 'pane-note', text: t('files.hint') }), body);
  root.append(pane);
  return { unmount() { pane.remove(); } };
}
