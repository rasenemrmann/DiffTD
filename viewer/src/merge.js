// Semantic 3-way merge of snapshots (pure). See research.md R11 and data-model.md.
//
// Rules: one side changed -> take it; both made the same change -> take it; both changed the
// same thing differently -> conflict. Items are node parameters, node type, DAT content (line
// hunks / table cells), and whole nodes (add-add, edit-vs-delete). Connections merge as sets.

import { cmp, canonicalize } from './snapshot-io.js';
import { same } from './diff.js';
import { matchLines } from './lines.js';
import { validateSnapshot } from './schema.js';

const connId = (c) => `${c.from}|${c.fromIndex ?? 0}|${c.to}|${c.toIndex ?? 0}`;
const touches = (c, path) => c.from === path || c.to === path;
const CHOICES_SIDE = ['ours', 'theirs'];
const CHOICES_KEEP = ['kept', 'deleted'];

// ------------------------------------------------------------------ diff3 for lines

/** Returns chunks: { ok: string[] } | { conflict: { base, ours, theirs } } */
export function diff3Lines(base, ours, theirs) {
  const toOurs = new Map(matchLines(base, ours));
  const toTheirs = new Map(matchLines(base, theirs));
  const sync = [];
  for (let i = 0; i < base.length; i += 1) {
    if (toOurs.has(i) && toTheirs.has(i)) sync.push([i, toOurs.get(i), toTheirs.get(i)]);
  }
  sync.push([base.length, ours.length, theirs.length]);

  const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const chunks = [];
  const pushOk = (lines) => {
    if (!lines.length) return;
    const last = chunks[chunks.length - 1];
    if (last?.ok) last.ok.push(...lines);
    else chunks.push({ ok: [...lines] });
  };
  let [pb, po, pt] = [0, 0, 0];
  for (const [sb, so, st] of sync) {
    const b = base.slice(pb, sb);
    const o = ours.slice(po, so);
    const t = theirs.slice(pt, st);
    if (equal(o, t)) pushOk(o);
    else if (equal(o, b)) pushOk(t);
    else if (equal(t, b)) pushOk(o);
    else chunks.push({ conflict: { base: b, ours: o, theirs: t } });
    if (sb < base.length) pushOk([base[sb]]);
    [pb, po, pt] = [sb + 1, so + 1, st + 1];
  }
  return chunks;
}

// ------------------------------------------------------------------ merge core

function normalize(snapshot, fallbackMeta) {
  return snapshot ?? { meta: fallbackMeta, nodes: [], connections: [] };
}

function compute(baseIn, oursIn, theirsIn, resolutions) {
  const meta = (oursIn ?? theirsIn ?? baseIn).meta;
  const base = normalize(baseIn, meta);
  const ours = normalize(oursIn, meta);
  const theirs = normalize(theirsIn, meta);
  const B = new Map(base.nodes.map((n) => [n.path, n]));
  const O = new Map(ours.nodes.map((n) => [n.path, n]));
  const T = new Map(theirs.nodes.map((n) => [n.path, n]));
  const conflicts = [];
  const nodeConflicts = new Map(); // path -> conflict (node kind)

  const choose = (id, choices) => {
    const r = resolutions[id];
    return choices.includes(r) ? r : null;
  };
  const addConflict = (c, choices) => {
    const resolution = choose(c.id, choices);
    const full = { ...c, choices, resolution };
    conflicts.push(full);
    return full;
  };

  function merge3(b, o, t, c) {
    if (same(o, t)) return o;
    if (same(o, b)) return t;
    if (same(t, b)) return o;
    const conflict = addConflict({ ...c, base: b, ours: o, theirs: t }, CHOICES_SIDE);
    return conflict.resolution === 'theirs' ? t : o;
  }

  function mergeContent(path, bc, oc, tc) {
    if (same(oc, tc)) return oc;
    if (same(oc, bc)) return tc;
    if (same(tc, bc)) return oc;
    const whole = () => merge3(bc, oc, tc, { id: `${path}#content`, kind: 'content', key: `${path}#content`, path, name: 'content' });
    if (bc?.kind === 'text' && oc?.kind === 'text' && tc?.kind === 'text') {
      const lines = [];
      let index = 0;
      for (const chunk of diff3Lines(bc.lines, oc.lines, tc.lines)) {
        if (chunk.ok) lines.push(...chunk.ok);
        else {
          const id = `${path}#content:${index}`;
          index += 1;
          const conflict = addConflict(
            { id, kind: 'content', key: id, path, name: `content (hunk ${index})`, base: chunk.conflict.base, ours: chunk.conflict.ours, theirs: chunk.conflict.theirs },
            CHOICES_SIDE,
          );
          lines.push(...(conflict.resolution === 'theirs' ? chunk.conflict.theirs : chunk.conflict.ours));
        }
      }
      return { kind: 'text', lines };
    }
    if (bc?.kind === 'table' && oc?.kind === 'table' && tc?.kind === 'table') {
      const shape = (c) => c.rows.map((r) => r.length).join(',');
      if (shape(bc) === shape(oc) && shape(bc) === shape(tc)) {
        const rows = bc.rows.map((row, r) => row.map((cell, c) => {
          const id = `${path}#content:r${r}c${c}`;
          return merge3(cell, oc.rows[r][c], tc.rows[r][c], { id, kind: 'content', key: id, path, name: `cell ${r + 1},${c + 1}` });
        }));
        return { kind: 'table', rows };
      }
    }
    return whole();
  }

  function mergeNode(b, o, t) {
    const path = o.path;
    const type = merge3(b.type, o.type, t.type, { id: `${path}#$type`, kind: 'param', key: `${path}#$type`, path, name: 'type' });
    const params = {};
    const names = [...new Set([...Object.keys(b.params), ...Object.keys(o.params), ...Object.keys(t.params)])].sort(cmp);
    for (const name of names) {
      const id = `${path}#${name}`;
      const value = merge3(b.params[name], o.params[name], t.params[name], { id, kind: 'param', key: id, path, name });
      if (value !== undefined) params[name] = value;
    }
    const node = { path, name: o.name, type, params };
    const content = mergeContent(path, b.content, o.content, t.content);
    if (content) node.content = content;
    return node;
  }

  const incident = (list, path) => new Set(list.filter((c) => touches(c, path)).map(connId));
  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

  const paths = [...new Set([...B.keys(), ...O.keys(), ...T.keys()])].sort(cmp);
  const nodes = [];
  for (const path of paths) {
    const [b, o, t] = [B.get(path), O.get(path), T.get(path)];
    if (!b) {
      if (o && !t) nodes.push(o);
      else if (!o && t) nodes.push(t);
      else if (same(o, t)) nodes.push(o);
      else {
        const c = addConflict({ id: path, kind: 'node', key: path, path, name: path.split('/').pop(), reason: 'added differently on both sides', base: undefined, ours: o, theirs: t }, CHOICES_SIDE);
        nodeConflicts.set(path, c);
        nodes.push(c.resolution === 'theirs' ? t : o);
      }
    } else if (o && t) {
      nodes.push(mergeNode(b, o, t));
    } else if (!o && !t) {
      // deleted on both sides
    } else {
      const survivor = o ?? t;
      const survivorConns = o ? ours.connections : theirs.connections;
      const untouched = same(b, survivor) && sameSet(incident(base.connections, path), incident(survivorConns, path));
      if (untouched) continue; // other side deleted it, this side did not touch it
      const reason = o ? 'deleted in theirs, changed in ours' : 'deleted in ours, changed in theirs';
      const c = addConflict({ id: path, kind: 'node', key: path, path, name: path.split('/').pop(), reason, base: b, ours: o ?? null, theirs: t ?? null }, CHOICES_KEEP);
      nodeConflicts.set(path, c);
      // unresolved defaults to ours: keep if ours kept it, delete if ours deleted it
      const keep = c.resolution ? c.resolution === 'kept' : Boolean(o);
      if (keep) nodes.push(survivor);
    }
  }
  const present = new Set(nodes.map((n) => n.path));

  // connections: set merge, with conflicted nodes deciding by the chosen side
  const sets = [base, ours, theirs].map((s) => new Map(s.connections.map((c) => [connId(c), c])));
  const [sb, so, st] = sets;
  const sideFor = (c) => {
    // which side's connection set governs connections at this conflicted node (null = drop)
    if (c.reason === 'added differently on both sides') return c.resolution === 'theirs' ? st : so;
    const keep = c.resolution ? c.resolution === 'kept' : Boolean(c.ours);
    if (!keep) return null;
    return c.ours ? so : st;
  };
  const connections = [];
  for (const key of [...new Set([...sb.keys(), ...so.keys(), ...st.keys()])].sort(cmp)) {
    const conn = so.get(key) ?? st.get(key) ?? sb.get(key);
    if (!present.has(conn.from) || !present.has(conn.to)) continue;
    const governing = [conn.from, conn.to].filter((p) => nodeConflicts.has(p)).map((p) => sideFor(nodeConflicts.get(p)));
    let keep;
    if (governing.length) keep = governing.every((side) => side?.has(key));
    else keep = sb.has(key) ? so.has(key) && st.has(key) : so.has(key) || st.has(key);
    if (keep) connections.push(conn);
  }

  conflicts.sort((a, b) => cmp(a.key, b.key));
  const merged = canonicalize({ meta, nodes, connections });
  return { base: baseIn, ours: oursIn, theirs: theirsIn, resolutions, conflicts, merged };
}

/**
 * MergeResult = { base, ours, theirs, resolutions, conflicts, merged }.
 * `merged` always reflects the current resolutions; unresolved conflicts count as "ours".
 */
export function mergeSnapshots(base, ours, theirs) {
  return compute(base, ours, theirs, {});
}

export function applyResolution(result, conflictId, resolution) {
  const conflict = result.conflicts.find((c) => c.id === conflictId);
  if (!conflict) throw new Error(`unknown conflict ${conflictId}`);
  if (!conflict.choices.includes(resolution)) throw new Error(`"${resolution}" is not a valid choice for ${conflictId}`);
  return compute(result.base, result.ours, result.theirs, { ...result.resolutions, [conflictId]: resolution });
}

export function isResolved(result) {
  return result.conflicts.every((c) => c.resolution !== null);
}

/** The merged snapshot, ready for serializeSnapshot. Throws while conflicts are open or if invalid. */
export function finalize(result) {
  if (!isResolved(result)) throw new Error(`${result.conflicts.filter((c) => c.resolution === null).length} conflict(s) still unresolved`);
  const check = validateSnapshot(result.merged);
  if (!check.ok) throw new Error(`merged snapshot is invalid: ${check.errors[0].message}`);
  return result.merged;
}
