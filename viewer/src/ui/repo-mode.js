// Git history: pick a local project folder, then compare any two commits (Chromium-based browsers).

import { openRepo } from '../gitrepo.js';
import { parseSnapshot } from '../schema.js';
import { diffSnapshots } from '../diff.js';
import { t } from '../i18n.js';
import { el } from './dom.js';
import { createDiffView } from './diff-view.js';

const short = (oid) => oid.slice(0, 7);

export function mountRepoMode(root, shell) {
  const body = el('div', { class: 'pane-body' });
  const pane = el('div', { class: 'pane' });
  const head = el('div', { class: 'pane-head' });
  const note = el('div', { class: 'pane-note' });
  pane.append(head, note, body);
  root.append(pane);
  const view = createDiffView(body);

  if (!window.showDirectoryPicker) {
    note.textContent = t('repo.unsupported');
    return { unmount() { pane.remove(); } };
  }

  let repo = null;
  let commits = [];
  const beforeSel = el('select', { class: 'field', id: 'before-commit' });
  const afterSel = el('select', { class: 'field', id: 'after-commit' });
  const containerSel = el('select', { class: 'field', id: 'container' });
  const dirInput = el('input', { class: 'field', id: 'snapshot-dir', value: 'snapshots', size: 14 });
  const folderLabel = el('span', { class: 'slot-name', text: t('repo.noFolder') });
  const field = (text, node) => el('label', { class: 'field-label' }, text, node);
  const fill = (sel, selected) => sel.replaceChildren(...commits.map((c, i) => el('option', { value: c.oid, selected: i === selected }, `${short(c.oid)} ${c.message}`)));

  async function refreshContainers() {
    shell.clearStatus();
    const dir = dirInput.value.trim() || 'snapshots';
    const files = [...new Set([...(await repo.listSnapshotsAt(beforeSel.value, dir)), ...(await repo.listSnapshotsAt(afterSel.value, dir))])].sort();
    const previous = containerSel.value;
    containerSel.replaceChildren(...files.map((f) => el('option', { value: f, selected: f === previous }, f.slice(dir.length + 1))));
    if (!files.length) {
      view.clear();
      shell.showInfo(t('repo.noSnapshots', { dir }));
      return;
    }
    await refreshDiff();
  }

  async function readParsed(oid, file) {
    const text = await repo.readSnapshotAt(oid, file);
    if (text === null) return null;
    try {
      return parseSnapshot(text);
    } catch (err) {
      throw new Error(`${file} @ ${short(oid)}: ${err.message}`);
    }
  }

  async function refreshDiff() {
    const file = containerSel.value;
    if (!file) return;
    try {
      const [before, after] = await Promise.all([readParsed(beforeSel.value, file), readParsed(afterSel.value, file)]);
      shell.clearStatus();
      view.show(diffSnapshots(before, after), (after ?? before).meta.root);
    } catch (err) {
      view.clear();
      shell.showError(err.message);
    }
  }

  async function open(handle) {
    try {
      repo = await openRepo(handle);
      commits = await repo.listCommits({ limit: 100 });
    } catch (err) {
      shell.showError(t('repo.notRepo', { name: handle.name, detail: err.message }));
      return;
    }
    if (!commits.length) { shell.showError(t('repo.noCommits')); return; }
    folderLabel.textContent = handle.name;
    fill(beforeSel, Math.min(1, commits.length - 1));
    fill(afterSel, 0);
    await refreshContainers();
  }

  async function choose() {
    try {
      await open(await window.showDirectoryPicker({ mode: 'read' }));
    } catch (err) {
      if (err.name !== 'AbortError') shell.showError(t('err.cannotOpenFolder', { detail: err.message }));
    }
  }

  head.append(
    el('div', { class: 'slot' }, el('span', { class: 'slot-label', text: t('repo.folder') }), el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary small', id: 'choose-folder', onclick: choose }, t('repo.choose')), folderLabel)),
    field(t('repo.snapshotDir'), dirInput),
    field(t('repo.before'), beforeSel),
    field(t('repo.after'), afterSel),
    field(t('repo.container'), containerSel),
  );
  beforeSel.addEventListener('change', refreshContainers);
  afterSel.addEventListener('change', refreshContainers);
  dirInput.addEventListener('change', () => repo && refreshContainers());
  containerSel.addEventListener('change', refreshDiff);

  // for automated browser tests (the native folder picker cannot be scripted)
  pane.__openHandle = open;
  window.__difftdRepoMode = pane;
  return { unmount() { pane.remove(); delete window.__difftdRepoMode; } };
}
