// Sidebar: the versions as a timeline rail, filter, and the ways to bring versions in.
// Pure view: all decisions are made by the caller through the callbacks.

import { t, getLanguage } from '../i18n.js';
import { sortVersions, filterVersions } from '../versions.js';
import { el } from './dom.js';

function formatDate(ms) {
  try {
    return new Date(ms).toLocaleString(getLanguage(), { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return new Date(ms).toISOString();
  }
}

/** Where a version came from, in the user's words: folder name, "added", or the helper's folder. */
export function describeOrigins(entry) {
  const labels = entry.origins.map((o) => {
    if (o.kind === 'upload') return t('list.source.upload');
    if (o.kind === 'helper') return o.folder || t('list.source.helper');
    return o.folder || t('list.source.folder');
  });
  return [...new Set(labels)].join(', ');
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * createVersionList(container, handlers) -> { render(model) }
 * handlers: onImportFolder, onAddFiles(FileList), onRefresh, onReopen, onPick(id, 'older' | 'newer'), onFilter(text)
 * model: { versions, pair, folderName, canImportFolder, rememberedName, filter }
 */
export function createVersionList(container, handlers) {
  const title = el('h2', { text: t('list.title') });
  const count = el('span', { class: 'count' });
  const search = el('input', { class: 'field', type: 'search', placeholder: t('list.search'), 'aria-label': t('list.search'), oninput: (e) => handlers.onFilter(e.target.value) });
  const list = el('ul', { class: 'versions', 'aria-label': t('list.title') });
  const fileInput = el('input', { type: 'file', multiple: true, accept: '.toe,.tox', class: 'sr-only', tabindex: -1, 'aria-hidden': 'true', onchange: (e) => { handlers.onAddFiles(e.target.files); e.target.value = ''; } });
  const importBtn = el('button', { type: 'button', class: 'btn primary', onclick: () => handlers.onImportFolder() }, t('action.importFolder'));
  const addBtn = el('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, t('action.addFiles'));
  const refreshBtn = el('button', { type: 'button', class: 'btn quiet', onclick: () => handlers.onRefresh() }, t('action.refresh'));
  const reopenBtn = el('button', { type: 'button', class: 'btn quiet', onclick: () => handlers.onReopen() });
  const note = el('div', { class: 'side-note' });
  const foot = el('div', { class: 'side-foot' }, importBtn, addBtn, reopenBtn, refreshBtn, note, fileInput);
  container.append(
    el('div', { class: 'side-head' }, title, count),
    el('div', { class: 'side-search' }, search),
    list,
    foot,
  );

  function row(v, index, range, pair) {
    const isOlder = pair?.olderId === v.id;
    const isNewer = pair?.newerId === v.id;
    const inRange = range && index >= range.lo && index <= range.hi;
    const classes = ['version'];
    if (isOlder) classes.push('is-older');
    if (isNewer) classes.push('is-newer');
    if (inRange) classes.push('in-range');
    if (range && index === range.lo) classes.push('range-start');
    if (range && index === range.hi) classes.push('range-end');
    if (v.status === 'error') classes.push('is-error');
    const pick = (which) => el(
      'button',
      { type: 'button', 'aria-pressed': String(which === 'older' ? isOlder : isNewer), 'aria-label': `${t(`list.${which}`)}: ${v.name}`, onclick: () => handlers.onPick(v.id, which) },
      t(`list.${which}`),
    );
    return el(
      'li',
      { class: classes.join(' '), 'data-id': v.id },
      el('div', { class: 'rail' }, el('span', { class: 'dot' })),
      el(
        'div',
        { class: 'v-body' },
        el('div', { class: 'v-name', title: v.name, text: v.name }),
        el('div', { class: 'v-meta' }, el('span', { text: formatDate(v.modified) }), el('span', { text: formatSize(v.size) }), describeOrigins(v) ? el('span', { text: describeOrigins(v) }) : null),
        v.status === 'error' && v.error ? el('div', { class: 'v-error', text: v.error }) : null,
        el('div', { class: 'v-actions' }, el('span', { class: 'seg' }, pick('older'), pick('newer')), v.status === 'converting' ? el('span', { class: 'v-busy', role: 'status', 'aria-label': '…' }) : null),
      ),
    );
  }

  function render({ versions, pair, folderName, canImportFolder, rememberedName, filter }) {
    const sorted = sortVersions(versions);
    const shown = filterVersions(sorted, filter);
    count.textContent = versions.length ? t('list.count', { n: versions.length }) : '';
    let range = null;
    if (pair) {
      const a = shown.findIndex((v) => v.id === pair.olderId);
      const b = shown.findIndex((v) => v.id === pair.newerId);
      if (a >= 0 && b >= 0) range = { lo: Math.min(a, b), hi: Math.max(a, b) };
    }
    list.replaceChildren(...(shown.length
      ? shown.map((v, i) => row(v, i, range, pair))
      : [el('li', { class: 'side-empty', text: versions.length ? t('list.noMatch', { text: filter }) : t('list.empty') })]));
    importBtn.hidden = !canImportFolder;
    importBtn.classList.toggle('primary', versions.length === 0);
    refreshBtn.hidden = !folderName;
    reopenBtn.hidden = !rememberedName || Boolean(folderName);
    reopenBtn.textContent = rememberedName ? t('action.reopen', { name: rememberedName }) : '';
    note.textContent = folderName ? t('list.folderNote', { name: folderName }) : (canImportFolder ? '' : t('list.unsupportedFolder'));
  }

  return { render, focusSearch: () => search.focus() };
}
