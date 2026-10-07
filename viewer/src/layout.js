// Topological layering for node graphs (pure, deterministic).

import { cmp } from './snapshot-io.js';

export const COL_WIDTH = 220;
export const ROW_HEIGHT = 84;

/**
 * layoutGraph(nodes, connections) -> { positions: Map<path,{x,y}>, layers: string[][] }
 * nodes: [{ path }]; connections: [{ from, to }]. Connections touching unknown nodes are ignored.
 * Cycles are broken by dropping DFS back-edges; layers are longest-path layers.
 */
export function layoutGraph(nodes, connections) {
  const paths = nodes.map((n) => n.path).sort(cmp);
  const known = new Set(paths);
  const out = new Map(paths.map((p) => [p, []]));
  const inc = new Map(paths.map((p) => [p, []]));
  const seenEdge = new Set();
  for (const c of [...connections].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to))) {
    const key = `${c.from}\u0000${c.to}`;
    if (!known.has(c.from) || !known.has(c.to) || c.from === c.to || seenEdge.has(key)) continue;
    seenEdge.add(key);
    out.get(c.from).push(c.to);
  }

  // Break cycles: iterative DFS, drop edges that point to a node on the current stack.
  const state = new Map(); // 1 = on stack, 2 = done
  const dag = new Map(paths.map((p) => [p, []]));
  for (const root of paths) {
    if (state.has(root)) continue;
    const stack = [[root, 0]];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [node, idx] = top;
      const targets = out.get(node);
      if (idx >= targets.length) {
        state.set(node, 2);
        stack.pop();
        continue;
      }
      top[1] += 1;
      const next = targets[idx];
      if (state.get(next) === 1) continue; // back edge
      dag.get(node).push(next);
      if (!state.has(next)) {
        state.set(next, 1);
        stack.push([next, 0]);
      }
    }
  }
  for (const [from, targets] of dag) for (const to of targets) inc.get(to).push(from);

  // Longest-path layering (Kahn order).
  const layerOf = new Map();
  const indeg = new Map(paths.map((p) => [p, inc.get(p).length]));
  const queue = paths.filter((p) => indeg.get(p) === 0);
  for (const p of queue) layerOf.set(p, 0);
  for (let qi = 0; qi < queue.length; qi += 1) {
    const p = queue[qi];
    for (const t of dag.get(p)) {
      layerOf.set(t, Math.max(layerOf.get(t) ?? 0, layerOf.get(p) + 1));
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  const depth = paths.length ? Math.max(...paths.map((p) => layerOf.get(p) ?? 0)) + 1 : 0;
  const layers = Array.from({ length: depth }, () => []);
  for (const p of paths) layers[layerOf.get(p) ?? 0].push(p);

  // Barycenter ordering, a few sweeps, ties by path.
  const order = new Map();
  const reindex = () => layers.forEach((layer) => layer.forEach((p, i) => order.set(p, i)));
  reindex();
  const bary = (p, neighbours) => {
    if (!neighbours.length) return order.get(p);
    return neighbours.reduce((s, q) => s + order.get(q), 0) / neighbours.length;
  };
  for (let sweep = 0; sweep < 4; sweep += 1) {
    for (let l = 1; l < layers.length; l += 1) {
      layers[l].sort((a, b) => bary(a, inc.get(a)) - bary(b, inc.get(b)) || cmp(a, b));
      layers[l].forEach((p, i) => order.set(p, i));
    }
    for (let l = layers.length - 2; l >= 0; l -= 1) {
      layers[l].sort((a, b) => bary(a, dag.get(a)) - bary(b, dag.get(b)) || cmp(a, b));
      layers[l].forEach((p, i) => order.set(p, i));
    }
  }

  const positions = new Map();
  layers.forEach((layer, l) => layer.forEach((p, i) => positions.set(p, { x: l * COL_WIDTH, y: i * ROW_HEIGHT })));
  return { positions, layers };
}
