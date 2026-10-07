// The list of known project versions (pure). Identity is the content hash, so the same file seen
// through an imported folder, an upload and the helper's own folder is listed once.

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const STATUS_RANK = { ready: 3, converting: 2, error: 1, idle: 0 };

export const originKey = (o) => `${o.kind}|${o.folder ?? ''}|${o.label ?? ''}`;

/** A version seen once: { id, name, size, modified, origin } -> entry. */
export function makeEntry({ id, name, size, modified, origin, status = 'idle', error, roots }) {
  return { id, name, size, modified, origins: [{ ...origin, modified }], status, error, roots };
}

/** Merge entries of any sources: same id -> one entry with all origins. */
export function mergeSources(entries) {
  const byId = new Map();
  for (const e of entries) {
    const known = byId.get(e.id);
    if (!known) {
      byId.set(e.id, { ...e, origins: [...e.origins] });
      continue;
    }
    for (const o of e.origins) {
      if (!known.origins.some((k) => originKey(k) === originKey(o))) known.origins.push(o);
    }
    if (e.modified > known.modified) {
      known.modified = e.modified;
      known.name = e.name;
    }
    if ((STATUS_RANK[e.status] ?? 0) > (STATUS_RANK[known.status] ?? 0)) {
      known.status = e.status;
      known.error = e.error;
      known.roots = e.roots;
    }
  }
  return [...byId.values()];
}

/** Newest first; equal dates by natural name order, higher number first (v10 before v2). */
export function sortVersions(list) {
  return [...list].sort((a, b) => (b.modified - a.modified) || collator.compare(b.name, a.name));
}

export function filterVersions(list, text) {
  const needle = (text ?? '').trim().toLowerCase();
  if (!needle) return list;
  return list.filter((v) => v.name.toLowerCase().includes(needle)
    || v.origins.some((o) => (o.folder ?? '').toLowerCase().includes(needle)));
}

/** The two newest versions as { olderId, newerId }, or null with fewer than two. */
export function defaultPair(list) {
  const sorted = sortVersions(list);
  if (sorted.length < 2) return null;
  return { olderId: sorted[1].id, newerId: sorted[0].id };
}

/** Keep the user's selection while both entries still exist, otherwise fall back to the default pair. */
export function resolveSelection(list, selection) {
  const ids = new Set(list.map((v) => v.id));
  if (selection && ids.has(selection.olderId) && ids.has(selection.newerId)) return selection;
  return defaultPair(list);
}

export function swapPair(pair) {
  return pair ? { olderId: pair.newerId, newerId: pair.olderId } : pair;
}
