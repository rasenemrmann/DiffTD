import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph } from '../../viewer/src/layout.js';

const nodes = (...names) => names.map((path) => ({ path }));
const edge = (from, to) => ({ from, to });

test('chain is layered left to right', () => {
  const { layers } = layoutGraph(nodes('a', 'b', 'c'), [edge('a', 'b'), edge('b', 'c')]);
  assert.deepEqual(layers, [['a'], ['b'], ['c']]);
});

test('diamond places the join after both branches', () => {
  const { layers } = layoutGraph(nodes('a', 'b', 'c', 'd'), [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')]);
  assert.deepEqual(layers.map((l) => l.length), [1, 2, 1]);
  assert.equal(layers[2][0], 'd');
});

test('long edge pushes target to the longest path layer', () => {
  const { layers } = layoutGraph(nodes('a', 'b', 'c'), [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')]);
  assert.deepEqual(layers, [['a'], ['b'], ['c']]);
});

test('cycles terminate and every node is placed', () => {
  const { positions } = layoutGraph(nodes('a', 'b', 'c'), [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('b', 'b')]);
  assert.equal(positions.size, 3);
});

test('unknown endpoints and duplicate edges are ignored', () => {
  const { positions } = layoutGraph(nodes('a', 'b'), [edge('a', 'zzz'), edge('a', 'b'), edge('a', 'b')]);
  assert.equal(positions.size, 2);
  assert.ok(positions.get('b').x > positions.get('a').x);
});

test('disconnected nodes share layer zero; empty graph is fine', () => {
  const { layers } = layoutGraph(nodes('x', 'y'), []);
  assert.deepEqual(layers, [['x', 'y']]);
  assert.equal(layoutGraph([], []).layers.length, 0);
});

test('layout is deterministic regardless of input order', () => {
  const edges = [edge('a', 'c'), edge('b', 'c'), edge('c', 'd')];
  const one = layoutGraph(nodes('a', 'b', 'c', 'd'), edges);
  const two = layoutGraph(nodes('d', 'c', 'b', 'a'), [...edges].reverse());
  assert.deepEqual([...one.positions], [...two.positions]);
});

test('1000-node layout finishes quickly', () => {
  const ns = Array.from({ length: 1000 }, (_, i) => ({ path: `/n${String(i).padStart(4, '0')}` }));
  const es = ns.slice(1).map((n, i) => edge(ns[Math.floor(i / 2)].path, n.path));
  const t0 = performance.now();
  const { positions } = layoutGraph(ns, es);
  assert.equal(positions.size, 1000);
  assert.ok(performance.now() - t0 < 1000);
});
