// Graph + toolbar + detail drawer for one DiffResult. Fills the space it is given. Can also show a
// state panel (empty / loading / error / ...) over the canvas, which hides the toolbar controls
// without changing the layout.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { createGraph } from './graph.js';
import { renderDetail } from './node-detail.js';

const parentOf = (path) => path.slice(0, path.lastIndexOf('/'));
const isComp = (node) => node.type.endsWith('COMP');
const GLYPHS = { added: '+', removed: '−', changed: '~', unchanged: '=' };

export function createDiffView(container) {
  const crumbs = el('div', { class: 'crumbs' });
  const hideBox = el('input', { type: 'checkbox', id: `hide-${Math.random().toString(36).slice(2, 7)}`, onchange: () => draw('all') });
  const counts = el('div', { class: 'counts' });
  const fitChanges = el('button', { type: 'button', class: 'btn small', onclick: () => graph.fit('changes') }, t('action.fitChanges'));
  const fitAll = el('button', { type: 'button', class: 'btn small', onclick: () => graph.fit('all') }, t('action.fitAll'));
  const zoom = el(
    'div',
    { class: 'zoom' },
    el('button', { type: 'button', class: 'btn small icon', 'aria-label': t('action.zoomOut'), title: t('action.zoomOut'), onclick: () => graph.zoomBy(1 / 1.25) }, '−'),
    el('button', { type: 'button', class: 'btn small icon', 'aria-label': t('action.zoomIn'), title: t('action.zoomIn'), onclick: () => graph.zoomBy(1.25) }, '+'),
    fitChanges,
    fitAll,
  );
  const toolbar = el('div', { class: 'toolbar' }, crumbs, zoom, el('label', { class: 'check', for: hideBox.id }, hideBox, t('action.hideUnchanged')), counts);
  const canvas = el('div', { class: 'canvas' });
  const closeBtn = el('button', { type: 'button', class: 'btn small drawer-close', onclick: () => { selected = null; draw(false); } }, t('action.closeDetail'));
  const detail = el('div', { class: 'detail' });
  const drawer = el('aside', { class: 'drawer empty', 'aria-label': 'details' }, closeBtn, detail);
  const stage = el('div', { class: 'stage' }, canvas, drawer);
  const root = el('div', { class: 'diffview' }, toolbar, stage);
  container.append(root);

  let result = null;
  let rootPath = '';
  let level = '';
  let selected = null;
  let statePanel = null;

  const graph = createGraph(canvas, {
    onSelect: (path) => { selected = path; draw(false); },
    onOpen: (node) => {
      if (isComp(node) && result.nodes.some((n) => parentOf(n.path) === node.path)) {
        level = node.path;
        selected = null;
        draw('changes');
      }
    },
  });

  function draw(fit = 'changes') {
    if (!result) return;
    const hide = hideBox.checked;
    const levelNodes = result.nodes.filter((n) => parentOf(n.path) === level && n.path !== rootPath
      && (!hide || n.status !== 'unchanged' || n.path === selected));
    const visible = new Set(levelNodes.map((n) => n.path));
    const conns = result.connections.filter((c) => visible.has(c.from) && visible.has(c.to) && (!hide || c.status !== 'unchanged'));
    const badges = new Map();
    for (const n of levelNodes) {
      if (!isComp(n)) continue;
      const count = result.nodes.filter((d) => d.path.startsWith(`${n.path}/`) && d.status !== 'unchanged').length;
      if (count) badges.set(n.path, `+${count}`);
    }
    graph.render({ nodes: levelNodes, connections: conns, selected, badges, fit });

    crumbs.replaceChildren();
    const parts = level.split('/').filter(Boolean);
    const rootParts = rootPath.split('/').filter(Boolean);
    const crumb = (label, target) => el('button', { type: 'button', onclick: () => { level = target; selected = null; draw('changes'); } }, label);
    crumbs.append(crumb(rootParts.at(-1) ?? '/', rootPath));
    for (let i = rootParts.length; i < parts.length; i += 1) crumbs.append(el('span', { class: 'sep', text: '/' }), crumb(parts[i], `/${parts.slice(0, i + 1).join('/')}`));

    counts.replaceChildren(...['added', 'removed', 'changed', 'unchanged'].map((s) => el('span', {}, el('span', { class: `glyph-chip ${s}`, 'aria-hidden': 'true' }, GLYPHS[s]), `${result.counts[s]} ${t(`legend.${s}`)}`)));
    const hasChanges = result.counts.added + result.counts.removed + result.counts.changed > 0;
    fitChanges.disabled = !hasChanges;
    const node = selected ? result.nodes.find((n) => n.path === selected) : null;
    renderDetail(detail, node);
    drawer.classList.toggle('empty', !node);
  }

  function setStatePanel(node) {
    statePanel?.remove();
    statePanel = node ?? null;
    root.classList.toggle('showing-state', Boolean(node));
    if (node) canvas.append(node);
    stage.style.gridTemplateColumns = node ? 'minmax(0, 1fr)' : '';
    drawer.hidden = Boolean(node);
  }

  return {
    /** Show a comparison; clears any state panel first. */
    show(diffResult, root_) {
      setStatePanel(null);
      result = diffResult;
      rootPath = root_;
      level = root_;
      selected = null;
      const c = diffResult.counts;
      draw(c.added + c.removed + c.changed > 0 ? 'changes' : 'all');
    },
    /** Replace everything by a state panel (empty, loading, error, ...). Drops the previous result. */
    showState(node) {
      result = null;
      selected = null;
      graph.render({ nodes: [], connections: [], selected: null });
      counts.replaceChildren();
      crumbs.replaceChildren();
      renderDetail(detail, null);
      setStatePanel(node);
    },
    clear() {
      this.showState(null);
    },
  };
}
