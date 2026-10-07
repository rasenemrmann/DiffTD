// "Compare versions": bring project versions in (folder, files, drag and drop, the helper's own
// folder), pick an older and a newer one, and see the comparison. All states come from state.js.

import { diffSnapshots } from '../diff.js';
import { validateSnapshot } from '../schema.js';
import { t } from '../i18n.js';
import { sha256Hex } from '../hash.js';
import { makeEntry, mergeSources, resolveSelection, swapPair, sortVersions } from '../versions.js';
import { reduce, initialState } from '../state.js';
import { scanDirectory, filesFromDrop, isProjectFile } from '../folder-scan.js';
import { loadFolder, saveFolder, ensurePermission } from '../folder-store.js';
import { el } from './dom.js';
import { createDiffView } from './diff-view.js';
import { createVersionList } from './version-list.js';

const UPLOAD_LIMIT = 200 * 1024 * 1024;

export function mountLocalMode(root, shell) {
  const client = shell.client;
  const entries = new Map(); // id -> merged entry
  const getters = new Map(); // id -> () => Promise<File>
  let state = initialState;
  let pair = null;
  let network = null;
  let filter = '';
  let folderHandle = null;
  let rememberedFolder = null;
  let lastDiff = null;
  let renderedKey = '';
  let compareToken = 0;
  let unsubscribeHelper = () => {};
  let diffCounter = 0;
  const canImportFolder = typeof window.showDirectoryPicker === 'function';

  // ---------------------------------------------------------------- layout
  const compare = el('div', { class: 'compare', 'data-drop-text': t('drop.overlay') });
  const sidebar = el('aside', { class: 'sidebar', 'aria-label': t('list.title') });
  const pairbar = el('div', { class: 'pairbar' });
  const viewHost = el('div', {});
  viewHost.style.minHeight = '0';
  viewHost.style.display = 'grid';
  const workspace = el('section', { class: 'workspace' }, pairbar, viewHost);
  compare.append(sidebar, workspace);
  root.append(compare);
  const view = createDiffView(viewHost);

  const list = createVersionList(sidebar, {
    onImportFolder: () => importFolder(),
    onAddFiles: (files) => ingest([...files].filter((f) => isProjectFile(f.name)).map((file) => ({ file, name: file.name, folder: '', kind: 'upload', label: 'upload' })), files.length),
    onRefresh: () => folderHandle && useFolder(folderHandle),
    onReopen: () => reopenFolder(),
    onPick: (id, which) => pick(id, which),
    onFilter: (text) => { filter = text; renderList(); },
  });

  // ---------------------------------------------------------------- state
  function dispatch(event) {
    state = reduce(state, event);
    render();
  }

  function versionsArray() {
    return [...entries.values()];
  }

  function renderList() {
    list.render({
      versions: versionsArray(),
      pair,
      folderName: folderHandle?.name ?? null,
      canImportFolder,
      rememberedName: rememberedFolder?.name ?? null,
      filter,
    });
  }

  function slot(label, entry) {
    return el('div', { class: `slot${entry ? '' : ' empty'}` }, el('span', { class: 'slot-label', text: label }), el('span', { class: 'slot-name', title: entry?.name ?? '', text: entry?.name ?? '—' }));
  }

  function renderPairbar() {
    const older = pair ? entries.get(pair.olderId) : null;
    const newer = pair ? entries.get(pair.newerId) : null;
    const nets = state.phase === 'ready' || state.phase === 'identical' ? networkChoices : [];
    const select = el('select', { class: 'field', 'aria-label': t('pair.network'), disabled: nets.length < 2 || state.phase === 'loading', onchange: (e) => { network = e.target.value; showDiff(); } },
      nets.map((n) => el('option', { value: n.name, selected: n.name === network }, `${n.name} — ${n.changes ? t('pair.changes', { n: n.changes }) : t('pair.noChanges')}`)));
    pairbar.replaceChildren(
      slot(t('pair.older'), older),
      el('button', { type: 'button', class: 'btn small', disabled: !pair, onclick: () => { pair = swapPair(pair); startCompare(); } }, t('action.swap')),
      slot(t('pair.newer'), newer),
      el('span', { class: 'spacer' }),
      ...(nets.length ? [el('label', { class: 'field-label' }, t('pair.network'), select)] : []),
    );
  }

  // ---------------------------------------------------------------- state panels
  const panel = (cls, ...children) => el('div', { class: `state ${cls}` }, ...children);

  function emptyPanel() {
    return panel(
      'empty',
      el('h2', { text: t('empty.title') }),
      el('p', { text: entries.size === 1 ? t('empty.need2') : t('empty.body') }),
      el('div', { class: 'actions' },
        canImportFolder ? el('button', { type: 'button', class: 'btn primary', onclick: () => importFolder() }, t('action.importFolder')) : null,
        el('button', { type: 'button', class: `btn${canImportFolder ? '' : ' primary'}`, onclick: () => compare.querySelector('input[type=file]').click() }, t('action.addFiles'))),
      el('div', { class: 'dropzone-hint', text: t('drop.overlay') }),
    );
  }

  function loadingPanel() {
    const names = pair ? [entries.get(pair.olderId)?.name, entries.get(pair.newerId)?.name].filter(Boolean).join(', ') : '';
    return panel(
      'skeleton',
      el('div', { class: 'skeleton-graph', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4, 5].map(() => el('i'))),
      el('p', { role: 'status', text: t('state.loading', { name: names }) }),
      state.progress?.total ? el('p', { text: t('state.loadingProgress', { done: state.progress.done, total: state.progress.total }) }) : null,
    );
  }

  function errorPanel() {
    return panel(
      'error',
      el('h2', { text: t('state.error.title') }),
      el('p', { class: 'file', text: state.error.message }),
      el('p', { text: t('state.error.next') }),
    );
  }

  function identicalPanel() {
    return panel(
      'identical',
      el('h2', { text: t('state.identical.title') }),
      el('p', { text: t('state.identical.body', { network: network ?? '', n: lastDiff?.nodes.length ?? 0 }) }),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', onclick: () => { pair = swapPair(pair); startCompare(); } }, t('action.swap'))),
    );
  }

  function missingPanel() {
    const command = t('state.missing.command');
    const copy = el('button', { type: 'button', class: 'btn small', onclick: async () => { try { await navigator.clipboard.writeText(command); copy.textContent = t('action.copied'); setTimeout(() => { copy.textContent = t('action.copy'); }, 1500); } catch { /* clipboard unavailable */ } } }, t('action.copy'));
    return panel(
      'missing',
      el('h2', { text: t('state.missing.title') }),
      el('p', { text: t('state.missing.body') }),
      el('div', { class: 'cmd' }, el('code', { text: command }), copy),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn primary', onclick: () => retryConnection() }, t('action.tryAgain'))),
    );
  }

  function render() {
    renderList();
    renderPairbar();
    const key = `${state.phase}|${diffCounter}|${state.error?.message ?? ''}|${state.progress?.done ?? ''}|${entries.size}`;
    if (key === renderedKey) return;
    renderedKey = key;
    switch (state.phase) {
      case 'helper-missing': view.showState(missingPanel()); break;
      case 'empty': view.showState(emptyPanel()); break;
      case 'loading': view.showState(loadingPanel()); break;
      case 'error': view.showState(errorPanel()); break;
      case 'identical': view.showState(identicalPanel()); break;
      case 'ready': view.show(lastDiff, lastDiff.root); break;
      default: break;
    }
    const status = { 'helper-missing': t('helper.notConnected'), empty: '', loading: t('helper.checking'), error: state.error?.message ?? '', identical: t('state.identical.title'), ready: '' };
    if (state.phase === 'loading') shell.setStatus(t('state.loading', { name: '' }).replace(/\s+…/, '…'), 'busy');
    else shell.setStatus(status[state.phase] ?? '', state.phase === 'error' ? 'error' : 'info');
  }

  // ---------------------------------------------------------------- versions in
  function addEntries(newEntries) {
    for (const e of mergeSources([...entries.values(), ...newEntries])) entries.set(e.id, e);
    afterVersionsChanged();
  }

  function afterVersionsChanged() {
    const next = resolveSelection(versionsArray(), pair);
    const changed = JSON.stringify(next) !== JSON.stringify(pair);
    pair = next;
    dispatch({ type: 'VERSIONS_CHANGED', count: entries.size });
    if (changed && pair) startCompare();
    else render();
  }

  async function ingest(items, total = items.length) {
    if (!items.length) return;
    const fresh = [];
    let done = 0;
    const queue = [...items];
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        shell.setStatus(`${t('state.loading', { name: '' }).replace(/\s+…/, '…')} ${++done}/${items.length}`, 'busy');
        try {
          const file = item.file ?? (await item.handle.getFile());
          const origin = { kind: item.kind, label: item.label, folder: item.folder, handle: item.handle };
          if (file.size > UPLOAD_LIMIT) {
            fresh.push(makeEntry({ id: `big:${item.name}:${file.size}:${file.lastModified}`, name: item.name, size: file.size, modified: file.lastModified, origin, status: 'error', error: t('err.tooLarge', { name: item.name, mb: 200 }) }));
            continue;
          }
          const id = await sha256Hex(file);
          getters.set(id, item.file ? async () => item.file : () => item.handle.getFile());
          fresh.push(makeEntry({ id, name: item.name, size: file.size, modified: file.lastModified, origin }));
        } catch (err) {
          shell.toast(t('err.unreadable', { name: item.name, detail: err.message }), 'error');
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    shell.clearStatus();
    addEntries(fresh);
    void total;
  }

  async function useFolder(handle) {
    folderHandle = handle;
    try {
      const scanned = await scanDirectory(handle);
      // drop entries that only came from this folder and are gone now
      const label = `folder:${handle.name}`;
      for (const [id, e] of entries) {
        if (e.origins.length && e.origins.every((o) => o.label === label)) entries.delete(id);
      }
      await ingest(scanned.map((s) => ({ handle: s.handle, name: s.name, folder: s.folder, kind: 'folder', label })), scanned.length);
      if (!scanned.length) shell.toast(t('list.empty'), 'info');
    } catch (err) {
      shell.toast(t('err.cannotOpenFolder', { detail: err.message }), 'error');
    }
    render();
  }

  async function importFolder() {
    let handle;
    try {
      handle = await window.showDirectoryPicker({ mode: 'read' });
    } catch (err) {
      if (err.name !== 'AbortError') shell.toast(t('err.cannotOpenFolder', { detail: err.message }), 'error');
      return;
    }
    await saveFolder(handle);
    rememberedFolder = { handle, name: handle.name };
    await useFolder(handle);
  }

  async function reopenFolder() {
    if (!rememberedFolder) return;
    if (!(await ensurePermission(rememberedFolder.handle))) {
      shell.toast(t('err.cannotOpenFolder', { detail: rememberedFolder.name }), 'error');
      return;
    }
    await useFolder(rememberedFolder.handle);
  }

  async function addHelperFolder() {
    try {
      const { versions, folder } = await client.versions();
      if (!folder) return;
      const items = versions.map((v) => {
        const id = v.sha256 ?? `file:${v.path}|${v.size}|${v.mtime}`;
        if (!getters.has(id)) getters.set(id, null);
        return makeEntry({ id, name: v.name, size: v.size, modified: Date.parse(v.mtime), origin: { kind: 'helper', label: 'helper', folder: v.path.includes('/') ? v.path.split('/').slice(-2, -1)[0] : '', path: v.path } });
      });
      addEntries(items);
    } catch {
      // the helper folder is optional
    }
  }

  // ---------------------------------------------------------------- comparing
  function pick(id, which) {
    const next = { ...(pair ?? { olderId: null, newerId: null }) };
    if (which === 'older') next.olderId = id; else next.newerId = id;
    if (!next.olderId || !next.newerId) {
      const other = versionsArray().find((v) => v.id !== id);
      if (!other) return;
      if (!next.olderId) next.olderId = other.id; else next.newerId = other.id;
    }
    if (next.olderId === next.newerId) {
      const other = versionsArray().find((v) => v.id !== id);
      if (!other) return;
      if (which === 'older') next.newerId = other.id; else next.olderId = other.id;
    }
    pair = next;
    startCompare();
  }

  async function roots(entry) {
    if (entry.status === 'ready' && entry.roots) return entry.roots;
    if (entry.status === 'error' && entry.error && entry.id.startsWith('big:')) throw new Error(entry.error);
    entry.status = 'converting';
    renderList();
    try {
      let result;
      const helperOrigin = entry.origins.find((o) => o.kind === 'helper');
      result = entry.id.startsWith('file:') ? null : await client.lookup(entry.id);
      if (!result) {
        const getFile = getters.get(entry.id);
        if (getFile) result = await client.convert(await getFile(), entry.id);
        else if (helperOrigin) result = await client.snapshotsOfFile(helperOrigin.path);
        else throw new Error(t('err.generic', { detail: entry.name }));
      }
      entry.status = 'ready';
      entry.roots = result;
      entry.error = undefined;
      return result;
    } catch (err) {
      entry.status = 'error';
      entry.error = err.message;
      throw err;
    }
  }

  let networkChoices = [];

  function startCompare() {
    const token = ++compareToken;
    lastDiff = null;
    networkChoices = [];
    dispatch({ type: 'PAIR_SELECTED', olderId: pair.olderId, newerId: pair.newerId });
    if (state.phase !== 'loading') return;
    const older = entries.get(pair.olderId);
    const newer = entries.get(pair.newerId);
    dispatch({ type: 'CONVERT_START', total: 2 });
    let done = 0;
    const track = (p) => p.then((r) => { done += 1; if (token === compareToken) dispatch({ type: 'CONVERT_PROGRESS', done, total: 2 }); return r; });
    Promise.all([track(roots(older)), track(roots(newer))]).then(([a, b]) => {
      if (token !== compareToken) return;
      const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      networkChoices = names.map((name) => {
        const c = diffSnapshots(a[name] ?? null, b[name] ?? null).counts;
        return { name, changes: c.added + c.removed + c.changed };
      });
      if (!names.includes(network)) network = names.includes('project1') ? 'project1' : (networkChoices.find((n) => n.changes)?.name ?? names[0]);
      current = { a, b };
      showDiff();
    }).catch((err) => {
      if (token !== compareToken) return;
      if (err?.kind === 'unreachable') { dispatch({ type: 'HELPER_DOWN' }); shell.recheckHelper(); return; }
      const bad = [older, newer].find((e) => e.status === 'error');
      dispatch({ type: 'CONVERT_FAILED', message: err.message, fileName: bad?.name ?? null });
    });
  }

  let current = null;

  function showDiff() {
    if (!current || !network) return;
    const before = current.a[network] ?? null;
    const after = current.b[network] ?? null;
    for (const snap of [before, after]) {
      if (snap && !validateSnapshot(snap).ok) {
        dispatch({ type: 'CONVERT_FAILED', message: t('err.generic', { detail: 'snapshot schema' }) });
        return;
      }
    }
    const diff = diffSnapshots(before, after);
    diff.root = (after ?? before).meta.root;
    const identical = diff.counts.added + diff.counts.removed + diff.counts.changed === 0
      && diff.connections.every((c) => c.status === 'unchanged') && diff.nodes.every((n) => !n.moved);
    lastDiff = diff;
    diffCounter += 1;
    if (state.phase === 'loading') dispatch({ type: 'CONVERT_DONE', identical, counts: diff.counts });
    else { state = reduce({ ...state, phase: 'loading', result: null, error: null }, { type: 'CONVERT_DONE', identical, counts: diff.counts }); render(); }
  }

  // ---------------------------------------------------------------- helper connection
  function retryConnection() {
    shell.recheckHelper();
  }

  async function onHelperChange(up) {
    if (!up) { dispatch({ type: 'HELPER_DOWN' }); return; }
    dispatch({ type: 'HELPER_UP' });
    try {
      await client.info();
    } catch (err) {
      if (err.kind === 'no-toeexpand') shell.showError(err.message);
    }
    await addHelperFolder();
    if (pair && state.phase === 'loading') startCompare();
  }

  // ---------------------------------------------------------------- drag and drop
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  compare.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth += 1; compare.classList.add('dragging'); } });
  compare.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  compare.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) compare.classList.remove('dragging'); });
  compare.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    compare.classList.remove('dragging');
    const dropped = await filesFromDrop(e.dataTransfer);
    await ingest(dropped.map((d) => ({ ...d, kind: 'upload', label: 'upload' })));
  });

  // ---------------------------------------------------------------- start
  render();
  loadFolder().then((remembered) => { rememberedFolder = remembered; renderList(); });
  unsubscribeHelper = shell.onHelper(onHelperChange);

  // test hook (the native folder picker cannot be scripted)
  compare.__api = { useFolder, ingest, entries, get state() { return state; } };
  window.__difftdLocal = compare.__api;

  return { unmount() { unsubscribeHelper(); compare.remove(); delete window.__difftdLocal; } };
}
