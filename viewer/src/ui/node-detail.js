// Drawer content: parameter and DAT-content differences of the selected node.

import { t } from '../i18n.js';
import { el, formatValue } from './dom.js';

const GLYPH = { added: '+', removed: '−', changed: '~', unchanged: '=' };
const pos = (l) => `(${Math.round(l.x)}, ${Math.round(l.y)})`;

function paramTable(rows, withBefore, withAfter) {
  return el(
    'table',
    { class: 'params' },
    el('thead', {}, el('tr', {}, el('th', { text: t('detail.parameter') }), withBefore && el('th', { text: t('detail.before') }), withAfter && el('th', { text: t('detail.after') }))),
    el('tbody', {}, rows.map((r) => el('tr', {}, el('td', { text: r.name }), withBefore && el('td', { class: 'before', text: formatValue(r.before) }), withAfter && el('td', { class: 'after', text: formatValue(r.after) })))),
  );
}

function contentView(diff) {
  if (!diff) return null;
  if (diff.kind === 'text') {
    return el('div', {}, el('h3', { text: 'DAT' }), diff.hunks.map((h) => el(
      'div',
      { class: 'hunk' },
      el('div', { class: 'head', text: `${h.beforeStart + 1}${h.beforeCount > 1 ? `–${h.beforeStart + h.beforeCount}` : ''} → ${h.afterStart + 1}${h.afterCount > 1 ? `–${h.afterStart + h.afterCount}` : ''}` }),
      h.before.map((line) => el('div', { class: 'del', text: `− ${line}` })),
      h.after.map((line) => el('div', { class: 'add', text: `+ ${line}` })),
    )));
  }
  if (diff.kind === 'table') {
    return el('div', {}, el('h3', { text: 'DAT' }), el(
      'table',
      { class: 'params' },
      el('thead', {}, el('tr', {}, ['#', '#', t('detail.before'), t('detail.after')].map((h) => el('th', { text: h })))),
      el('tbody', {}, diff.cells.map((c) => el('tr', {}, el('td', { text: c.row + 1 }), el('td', { text: c.col + 1 }), el('td', { class: 'before', text: c.before ?? '—' }), el('td', { class: 'after', text: c.after ?? '—' })))),
    ));
  }
  return null;
}

export function renderDetail(container, node) {
  container.replaceChildren();
  if (!node) {
    container.append(el('p', { class: 'note', text: t('detail.empty') }));
    return;
  }
  container.append(
    el('h2', { text: node.name }),
    el('div', { class: 'path', text: node.path }),
    el('p', {}, el('span', { class: `status-tag ${node.status}` }, `${GLYPH[node.status]} ${t(`legend.${node.status}`)}`), el('span', { class: 'mono', text: node.type })),
  );
  if (node.moved) container.append(el('p', { class: 'note', text: t('detail.moved', { from: pos(node.moved.before), to: pos(node.moved.after) }) }));
  if (node.typeChange) container.append(el('p', { text: t('detail.typeChange', { from: node.typeChange.before, to: node.typeChange.after }) }));
  if (node.status === 'changed') {
    if (node.paramChanges.length) container.append(paramTable(node.paramChanges, true, true));
    const content = contentView(node.contentDiff);
    if (content) container.append(content);
  } else if (node.status === 'added' || node.status === 'removed') {
    const side = node.status === 'added' ? node.after : node.before;
    const rows = Object.entries(side.params).map(([name, value]) => ({ name, before: value, after: value }));
    container.append(el('details', {}, el('summary', { text: t('detail.params', { n: rows.length }) }), paramTable(rows, false, true)));
    if (side.content?.kind === 'text') container.append(el('details', {}, el('summary', { text: `DAT (${side.content.lines.length})` }), el('pre', { text: side.content.lines.join('\n') })));
    if (side.content?.kind === 'table') container.append(el('details', {}, el('summary', { text: `DAT (${side.content.rows.length})` }), el('pre', { text: side.content.rows.map((r) => r.join('\t')).join('\n') })));
  } else if (!node.moved) {
    container.append(el('p', { class: 'note', text: t('detail.noDifferences') }));
  }
}
