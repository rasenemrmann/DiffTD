// Canonical serialization, byte-identical to difftd/snapshot.py.

/** Code point order (matches Python str comparison; JS default compares UTF-16 units). */
export function cmp(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort(cmp)) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

const connKey = (c) => [c.to, c.toIndex ?? 0, c.from, c.fromIndex ?? 0];

function cmpConn(a, b) {
  const ka = connKey(a);
  const kb = connKey(b);
  for (let i = 0; i < 4; i += 1) {
    const d = typeof ka[i] === 'string' ? cmp(ka[i], kb[i]) : ka[i] - kb[i];
    if (d !== 0) return d;
  }
  return 0;
}

export function canonicalize(snapshot) {
  const nodes = [...snapshot.nodes].sort((a, b) => cmp(a.path, b.path));
  const connections = [...snapshot.connections].sort(cmpConn).map((c) => {
    const out = { from: c.from, to: c.to };
    if (c.fromIndex) out.fromIndex = c.fromIndex;
    if (c.toIndex) out.toIndex = c.toIndex;
    return out;
  });
  return { meta: snapshot.meta, nodes, connections };
}

/** Canonical text: sorted keys, 2-space indent, LF, trailing newline. */
export function serializeSnapshot(snapshot) {
  return `${JSON.stringify(sortKeysDeep(canonicalize(snapshot)), null, 2)}\n`;
}

export function snapshotPath(project, rootName, snapshotDir = 'snapshots') {
  return `${snapshotDir}/${project}/${rootName}.json`;
}
