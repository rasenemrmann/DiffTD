// Snapshot diff (pure). Identity of a node is its path; renames show as remove + add.

import { cmp } from './snapshot-io.js';
import { diffLines } from './lines.js';

export const STATUS = Object.freeze({
  ADDED: 'added',
  REMOVED: 'removed',
  CHANGED: 'changed',
  UNCHANGED: 'unchanged',
});

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort(cmp).map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const same = (a, b) => stable(a) === stable(b);

export function diffText(beforeLines, afterLines) {
  return diffLines(beforeLines, afterLines);
}

/** Cell-level changes: [{ row, col, before, after }]; a missing cell is undefined. */
export function diffTable(beforeRows, afterRows) {
  const changes = [];
  const rows = Math.max(beforeRows.length, afterRows.length);
  for (let r = 0; r < rows; r += 1) {
    const b = beforeRows[r] ?? [];
    const a = afterRows[r] ?? [];
    const cols = Math.max(b.length, a.length);
    for (let c = 0; c < cols; c += 1) {
      if (b[c] !== a[c]) changes.push({ row: r, col: c, before: b[c], after: a[c] });
    }
  }
  return changes;
}

function diffContent(before, after) {
  if (!before && !after) return null;
  const kind = (before ?? after).kind;
  if (before && after && before.kind !== after.kind) return { kind: 'kindChange', before, after };
  if (kind === 'text') {
    const hunks = diffText(before?.lines ?? [], after?.lines ?? []);
    return hunks.length ? { kind, hunks } : null;
  }
  const cells = diffTable(before?.rows ?? [], after?.rows ?? []);
  return cells.length ? { kind, cells } : null;
}

function diffParams(before = {}, after = {}) {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(cmp);
  const changes = [];
  for (const name of names) {
    const inB = name in before;
    const inA = name in after;
    if (inB && !inA) changes.push({ name, status: STATUS.REMOVED, before: before[name], after: undefined });
    else if (!inB && inA) changes.push({ name, status: STATUS.ADDED, before: undefined, after: after[name] });
    else if (!same(before[name], after[name])) {
      changes.push({ name, status: STATUS.CHANGED, before: before[name], after: after[name] });
    }
  }
  return changes;
}

const connId = (c) => `${c.from}|${c.fromIndex ?? 0}|${c.to}|${c.toIndex ?? 0}`;

/**
 * DiffResult:
 *  nodes:       [{ path, name, type, status, before?, after?, typeChange?, paramChanges[], contentDiff }]
 *  connections: [{ key, from, to, fromIndex, toIndex, status }]
 *  counts:      { added, removed, changed, unchanged } for nodes
 * Either side may be null (container missing in that version) and is treated as empty.
 */
export function diffSnapshots(before, after) {
  const bNodes = new Map((before?.nodes ?? []).map((n) => [n.path, n]));
  const aNodes = new Map((after?.nodes ?? []).map((n) => [n.path, n]));
  const paths = [...new Set([...bNodes.keys(), ...aNodes.keys()])].sort(cmp);
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  const nodes = paths.map((path) => {
    const b = bNodes.get(path);
    const a = aNodes.get(path);
    const ref = a ?? b;
    const rec = { path, name: ref.name, type: ref.type, before: b, after: a, paramChanges: [], contentDiff: null, layout: ref.layout };
    if (!b) rec.status = STATUS.ADDED;
    else if (!a) rec.status = STATUS.REMOVED;
    else {
      if (b.type !== a.type) rec.typeChange = { before: b.type, after: a.type };
      rec.paramChanges = diffParams(b.params, a.params);
      rec.contentDiff = diffContent(b.content, a.content);
      rec.status = rec.typeChange || rec.paramChanges.length || rec.contentDiff ? STATUS.CHANGED : STATUS.UNCHANGED;
      // position is display-only: it never changes the status, but is reported
      if (b.layout && a.layout && !same(b.layout, a.layout)) rec.moved = { before: b.layout, after: a.layout };
    }
    counts[rec.status] += 1;
    return rec;
  });

  const bConns = new Map((before?.connections ?? []).map((c) => [connId(c), c]));
  const aConns = new Map((after?.connections ?? []).map((c) => [connId(c), c]));
  const keys = [...new Set([...bConns.keys(), ...aConns.keys()])].sort(cmp);
  const connections = keys.map((key) => {
    const c = aConns.get(key) ?? bConns.get(key);
    const status = !bConns.has(key) ? STATUS.ADDED : !aConns.has(key) ? STATUS.REMOVED : STATUS.UNCHANGED;
    return { key, from: c.from, to: c.to, fromIndex: c.fromIndex ?? 0, toIndex: c.toIndex ?? 0, status };
  });
  return { nodes, connections, counts };
}
