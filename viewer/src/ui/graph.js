// SVG node graph: real TouchDesigner positions when known, status outlines + glyphs, family dots,
// pan/zoom, fit-to-changes, keyboard selection.

import { layoutGraph } from '../layout.js';
import { t } from '../i18n.js';
import { el } from './dom.js';

const NODE_W = 170;
const NODE_H = 46;
const GLYPH = { added: '+', removed: '−', changed: '~', unchanged: '' };
const MIN_TEXT_SCALE = 0.8; // keeps 14 px node names at >= ~11 px when fitting the changes

export const familyOf = (type) => (/(COMP|TOP|CHOP|SOP|DAT|MAT|POP)$/.exec(type)?.[1] ?? 'other').toLowerCase();

/**
 * createGraph(container, { onSelect, onOpen }) -> { render, zoomBy, fit }
 * render({ nodes, connections, selected, badges, fit }) with fit: 'changes' | 'all' | false.
 */
export function createGraph(container, { onSelect, onOpen }) {
  const svg = el('svg', { class: 'graph', role: 'group', 'aria-label': t('pair.network'), tabindex: -1 });
  const viewport = el('g', {});
  svg.append(viewport);
  container.append(svg);

  let tx = 20;
  let ty = 20;
  let scale = 1;
  let lastBoxes = null;
  let lastNodes = [];
  let lastConns = [];
  const apply = () => viewport.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.node')) return;
    drag = { x: e.clientX, y: e.clientY, tx, ty };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('panning');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    tx = drag.tx + e.clientX - drag.x;
    ty = drag.ty + e.clientY - drag.y;
    apply();
  });
  const endDrag = () => { drag = null; svg.classList.remove('panning'); };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  function zoomAt(px, py, factor) {
    const next = Math.min(3, Math.max(0.2, scale * factor));
    tx = px - ((px - tx) * next) / scale;
    ty = py - ((py - ty) * next) / scale;
    scale = next;
    apply();
  }

  function boxesFor(nodes, connections) {
    const boxes = new Map();
    if (nodes.every((n) => n.layout)) {
      for (const n of nodes) {
        const w = Math.max(120, n.layout.w);
        const h = Math.max(46, n.layout.h);
        boxes.set(n.path, { x: n.layout.x, y: -(n.layout.y + n.layout.h), w, h });
      }
    } else {
      const { positions } = layoutGraph(nodes, connections);
      for (const n of nodes) boxes.set(n.path, { ...positions.get(n.path), w: NODE_W, h: NODE_H });
    }
    return boxes;
  }

  function fitTo(boxes, minScale, maxScale = 1.2) {
    const list = [...boxes.values()];
    if (!list.length) return;
    const minX = Math.min(...list.map((b) => b.x));
    const minY = Math.min(...list.map((b) => b.y));
    const maxX = Math.max(...list.map((b) => b.x + b.w));
    const maxY = Math.max(...list.map((b) => b.y + b.h));
    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 560;
    const pad = 48;
    const wanted = Math.min((width - pad) / Math.max(1, maxX - minX), (height - pad) / Math.max(1, maxY - minY));
    scale = Math.min(maxScale, Math.max(minScale, wanted));
    tx = (width - (maxX - minX) * scale) / 2 - minX * scale;
    ty = (height - (maxY - minY) * scale) / 2 - minY * scale;
  }

  function fit(mode) {
    if (!lastBoxes) return;
    if (mode === 'changes') {
      // the changed nodes plus their direct neighbours, so a change is seen in its surroundings
      const focus = new Set(lastNodes.filter((n) => n.status !== 'unchanged').map((n) => n.path));
      if (focus.size) {
        for (const c of lastConns) {
          if (focus.has(c.from) || focus.has(c.to) || c.status !== 'unchanged') { focus.add(c.from); focus.add(c.to); }
        }
        const boxes = new Map([...focus].filter((p) => lastBoxes.has(p)).map((p) => [p, lastBoxes.get(p)]));
        fitTo(boxes, MIN_TEXT_SCALE, 1);
        apply();
        return;
      }
    }
    fitTo(lastBoxes, 0.25);
    apply();
  }

  function render({ nodes, connections, selected, badges = new Map(), fit: fitMode = false }) {
    viewport.replaceChildren();
    lastNodes = nodes;
    lastConns = connections;
    if (!nodes.length) {
      lastBoxes = null;
      apply();
      return;
    }
    const boxes = boxesFor(nodes, connections);
    lastBoxes = boxes;
    if (fitMode) fit(fitMode);
    const edgeLayer = el('g', {});
    const nodeLayer = el('g', {});
    viewport.append(edgeLayer, nodeLayer);

    for (const c of connections) {
      const a = boxes.get(c.from);
      const b = boxes.get(c.to);
      if (!a || !b) continue;
      const x1 = a.x + a.w;
      const y1 = a.y + a.h / 2;
      const x2 = b.x;
      const y2 = b.y + b.h / 2;
      const mid = Math.max(30, Math.abs(x2 - x1) / 2);
      edgeLayer.append(
        el('path', { class: `edge ${c.status}`, d: `M${x1} ${y1} C${x1 + mid} ${y1} ${x2 - mid} ${y2} ${x2} ${y2}` }, el('title', { text: `${t(`legend.${c.status}`)}: ${c.from} → ${c.to}` })),
      );
      if (c.toIndex || c.fromIndex) {
        edgeLayer.append(el('text', { class: 'edge-label', x: x2 - 22, y: y2 - 4, text: `${c.fromIndex}→${c.toIndex}` }));
      }
    }

    // overlapping nodes: draw what matters last (changed on top of unchanged, the selection on top of all)
    const layer = (n) => (n.path === selected ? 2 : n.status === 'unchanged' ? 0 : 1);
    for (const n of [...nodes].sort((a, b) => layer(a) - layer(b))) {
      const box = boxes.get(n.path);
      const badge = badges.get(n.path);
      const chars = Math.max(6, Math.floor((box.w - 32) / 7.5));
      const nameX = n.status === 'unchanged' ? 20 : 34;
      nodeLayer.append(el(
        'g',
        {
          class: `node ${n.status}${n.path === selected ? ' selected' : ''}`,
          transform: `translate(${box.x} ${box.y})`,
          tabindex: 0,
          role: 'button',
          'aria-label': `${n.name}, ${n.type}, ${t(`legend.${n.status}`)}${n.moved ? `, ${t('detail.moved', { from: '', to: '' }).split(':')[0]}` : ''}${badge ? `, ${badge}` : ''}`,
          onclick: () => onSelect(n.path),
          ondblclick: () => onOpen?.(n),
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n.path); }
            if (e.key === 'ArrowDown' && onOpen) onOpen(n);
          },
        },
        el('rect', { width: box.w, height: box.h, rx: 5 }),
        el('circle', { class: `fam fam-${familyOf(n.type)}`, cx: 11, cy: 16, r: 4 }),
        n.status !== 'unchanged' ? el('text', { class: 'glyph', x: 20, y: 21, text: GLYPH[n.status] }) : null,
        el('text', { x: nameX, y: 21, text: n.name.length > chars ? `${n.name.slice(0, chars - 1)}…` : n.name }),
        el('text', { class: 'type', x: 20, y: 38, text: n.type }),
        n.moved ? el('text', { class: 'moved', x: box.w - 8, y: 21, 'text-anchor': 'end', text: '↔' }, el('title', { text: t('detail.moved', { from: '', to: '' }) })) : null,
        badge ? el('text', { class: 'badge', x: box.w - 8, y: box.h - 8, 'text-anchor': 'end', text: `${badge}` }) : null,
      ));
    }
    apply();
  }

  return {
    render,
    fit,
    zoomBy(factor) { zoomAt((svg.clientWidth || 800) / 2, (svg.clientHeight || 560) / 2, factor); },
  };
}
