// Merge review: semantic 3-way merge, one decision per real conflict, then an explicit write and an
// explicit reload. Nothing is written or reloaded before its own click.

import { openRepo } from '../gitrepo.js';
import { parseSnapshot } from '../schema.js';
import { serializeSnapshot } from '../snapshot-io.js';
import { diffSnapshots } from '../diff.js';
import { mergeSnapshots, applyResolution, isResolved, finalize } from '../merge.js';
import { requestReload, summarizeReload, DEFAULT_PORT } from '../reload-client.js';
import { t } from '../i18n.js';
import { el, formatValue } from './dom.js';
import { createDiffView } from './diff-view.js';

const short = (oid) => oid.slice(0, 7);

function show(value) {
  if (value === undefined || value === null) return '—';
  if (Array.isArray(value)) return value.join('\n') || '∅';
  if (typeof value === 'object' && ('path' in value || 'kind' in value)) {
    if (value.kind === 'text') return value.lines.join('\n');
    if (value.kind === 'table') return value.rows.map((r) => r.join('\t')).join('\n');
    return `${value.type}, ${t('detail.params', { n: Object.keys(value.params ?? {}).length })}`;
  }
  return formatValue(value);
}

export function mountMergeMode(root, shell) {
  const pane = el('div', { class: 'pane' });
  const head = el('div', { class: 'pane-head' });
  const note = el('div', { class: 'pane-note', id: 'merge-summary' });
  const conflictHost = el('div', { class: 'panel', id: 'conflicts', hidden: true });
  const actions = el('div', { class: 'actions-row' });
  const side = el('div', { class: 'pane-scroll merge-side' }, conflictHost, actions);
  const viewHost = el('div', { class: 'merge-view' });
  const split = el('div', { class: 'pane-split' }, side, viewHost);
  pane.append(head, note, split);
  root.append(pane);
  const view = createDiffView(viewHost);

  if (!window.showDirectoryPicker) {
    note.textContent = t('repo.unsupported');
    return { unmount() { pane.remove(); } };
  }

  let dirHandle = null;
  let repo = null;
  let sides = null;
  const results = new Map();
  const written = new Set();
  let current = null;

  const containerSel = el('select', { class: 'field', id: 'merge-container' });
  const branchSel = el('select', { class: 'field', id: 'merge-branch' });
  const dirInput = el('input', { class: 'field', id: 'merge-snapshot-dir', value: 'snapshots', size: 14 });
  const portInput = el('input', { class: 'field', id: 'merge-port', type: 'number', value: String(DEFAULT_PORT), min: 1, max: 65535, style: 'width: 96px' });
  const folderLabel = el('span', { class: 'slot-name', text: t('repo.noFolder') });

  async function readParsed(oid, file) {
    const text = await repo.readSnapshotAt(oid, file);
    if (text === null) return null;
    try {
      return parseSnapshot(text);
    } catch (err) {
      throw new Error(`${file} @ ${short(oid)}: ${err.message}`);
    }
  }

  async function analyse() {
    shell.clearStatus();
    results.clear();
    written.clear();
    const dir = dirInput.value.trim() || 'snapshots';
    const lists = await Promise.all(Object.values(sides).map((oid) => repo.listSnapshotsAt(oid, dir)));
    const files = [...new Set(lists.flat())].sort();
    for (const file of files) {
      const [b, o, th] = await Promise.all([sides.base, sides.ours, sides.theirs].map((oid) => readParsed(oid, file)));
      results.set(file, mergeSnapshots(b, o, th));
    }
    containerSel.replaceChildren(...files.map((f) => {
      const n = results.get(f).conflicts.length;
      return el('option', { value: f }, `${f.slice(dir.length + 1)} — ${n ? t('merge.nConflicts', { n }) : t('merge.autoOne')}`);
    }));
    note.textContent = t('merge.summary', { base: short(sides.base), ours: short(sides.ours), theirs: short(sides.theirs), containers: files.length, conflicts: [...results.values()].reduce((a, r) => a + r.conflicts.length, 0) });
    if (!files.length) { shell.showInfo(t('merge.noSnapshots', { dir })); return; }
    select(files[0]);
  }

  function select(file) {
    current = file;
    containerSel.value = file;
    render();
  }

  function setChoice(id, choice) {
    results.set(current, applyResolution(results.get(current), id, choice));
    written.delete(current);
    render();
  }

  function conflictItem(c) {
    const button = (label, value, choice) => el(
      'button',
      { class: 'choice', type: 'button', 'aria-pressed': String(c.resolution === choice), 'data-conflict': c.id, 'data-choice': choice, onclick: () => setChoice(c.id, choice) },
      el('span', { class: 'label', text: label }),
      el('code', { text: show(value) }),
    );
    const buttons = c.choices.includes('kept')
      ? [button(t('merge.keep'), c.ours ?? c.theirs, 'kept'), button(t('merge.delete'), null, 'deleted')]
      : [button(t('merge.ours'), c.ours, 'ours'), button(t('merge.theirs'), c.theirs, 'theirs')];
    return el(
      'li',
      { class: `conflict${c.resolution ? ' resolved' : ''}` },
      el('h3', { text: c.kind === 'node' ? c.path : `${c.path}  ${c.name}` }),
      c.reason ? el('p', { class: 'note', text: c.reason }) : null,
      c.kind !== 'node' ? el('p', { class: 'note' }, `${t('merge.base')}: `, el('code', { text: show(c.base) })) : null,
      el('div', { class: 'choices' }, buttons),
    );
  }

  function render() {
    const result = results.get(current);
    conflictHost.replaceChildren();
    conflictHost.hidden = !result;
    if (!result) return;
    const open = result.conflicts.filter((c) => c.resolution === null).length;
    conflictHost.append(
      el('h2', { text: result.conflicts.length ? t('merge.conflicts', { done: result.conflicts.length - open, total: result.conflicts.length }) : t('merge.noConflicts') }),
      result.conflicts.length ? el('ul', { class: 'conflicts' }, result.conflicts.map(conflictItem)) : el('p', { class: 'note', text: t('merge.autoMerge') }),
    );
    actions.replaceChildren(...[
      el('button', { class: 'btn primary', id: 'write-merged', disabled: !isResolved(result), onclick: writeMerged }, t('merge.write')),
      el('label', { class: 'check' }, t('merge.port'), portInput),
      el('button', { class: 'btn', id: 'reload-td', disabled: !written.has(current), onclick: reload }, t('merge.reload')),
      !isResolved(result) ? el('span', { class: 'note', text: t('merge.resolveFirst', { n: open }) }) : null,
    ].filter(Boolean));
    view.show(diffSnapshots(result.ours, result.merged), result.merged.meta.root);
  }

  async function writeMerged() {
    try {
      const text = serializeSnapshot(finalize(results.get(current)));
      if (dirHandle.requestPermission) {
        const state = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (state !== 'granted') throw new Error(t('merge.noPermission'));
      }
      await (await openRepo(dirHandle, { write: true })).writeSnapshot(current, text);
      written.add(current);
      shell.showInfo(t('merge.written', { file: current }));
      render();
    } catch (err) {
      shell.showError(t('merge.writeFailed', { detail: err.message }));
    }
  }

  async function reload() {
    try {
      shell.showInfo(t('merge.reloaded', { summary: summarizeReload(await requestReload([current], Number(portInput.value) || DEFAULT_PORT)) }));
    } catch (err) {
      shell.showError(err.message);
    }
  }

  async function start(handle) {
    dirHandle = handle;
    folderLabel.textContent = handle.name;
    repo = await openRepo(handle);
    const ours = await repo.headOid();
    const mergeHead = await repo.mergeHead();
    branchSel.replaceChildren();
    if (mergeHead) {
      sides = { ours, theirs: mergeHead, base: await repo.mergeBase(ours, mergeHead) };
      branchSel.disabled = true;
      branchSel.append(el('option', {}, `MERGE_HEAD ${short(mergeHead)}`));
      await analyse();
    } else {
      const currentBranch = await repo.currentBranch();
      const branches = (await repo.listBranches()).filter((b) => b !== currentBranch);
      branchSel.disabled = false;
      branchSel.append(el('option', { value: '' }, t('merge.chooseBranch')), ...branches.map((b) => el('option', { value: b }, b)));
      shell.showInfo(t('merge.noMerge'));
    }
  }

  async function choose() {
    try {
      await start(await window.showDirectoryPicker({ mode: 'read' }));
    } catch (err) {
      if (err.name !== 'AbortError') shell.showError(t('err.cannotOpenFolder', { detail: err.message }));
    }
  }

  branchSel.addEventListener('change', async () => {
    if (!branchSel.value) return;
    try {
      const ours = await repo.headOid();
      const theirs = await repo.resolve(branchSel.value);
      sides = { ours, theirs, base: await repo.mergeBase(ours, theirs) };
      await analyse();
    } catch (err) {
      shell.showError(err.message);
    }
  });
  containerSel.addEventListener('change', () => select(containerSel.value));
  dirInput.addEventListener('change', () => sides && analyse().catch((e) => shell.showError(e.message)));

  const field = (text, node) => el('label', { class: 'field-label' }, text, node);
  head.append(
    el('div', { class: 'slot' }, el('span', { class: 'slot-label', text: t('repo.folder') }), el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary small', id: 'merge-choose-folder', onclick: choose }, t('repo.choose')), folderLabel)),
    field(t('repo.snapshotDir'), dirInput),
    field(t('merge.merging'), branchSel),
    field(t('repo.container'), containerSel),
  );

  // for automated browser tests (the native folder picker cannot be scripted)
  pane.__openHandle = (handle) => start(handle).catch((e) => shell.showError(e.message));
  window.__difftdMergeMode = pane;
  return { unmount() { pane.remove(); delete window.__difftdMergeMode; } };
}
