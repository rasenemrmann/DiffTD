import test from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots } from '../../viewer/src/diff.js';
import { layoutGraph } from '../../viewer/src/layout.js';
import { mergeSnapshots } from '../../viewer/src/merge.js';

function big(n, tweak = 0) {
  const root = '/project1/net1';
  const nodes = [{ path: root, name: 'net1', type: 'baseCOMP', params: { w: 1 } }];
  const connections = [];
  for (let i = 0; i < n; i += 1) {
    const name = `n${String(i).padStart(4, '0')}`;
    nodes.push({ path: `${root}/${name}`, name, type: 'mathCHOP', params: { gain: i % 7 === 0 ? i + tweak : i, offset: 0, postoff: 0, preoff: 1 } });
    if (i > 0) connections.push({ from: `${root}/n${String(Math.floor((i - 1) / 2)).padStart(4, '0')}`, to: `${root}/${name}` });
  }
  return { meta: { format_version: 1, project: 'project1', root }, nodes, connections };
}

test('diff and layout of two 1,000-node snapshots stay well under 5 s (SC-006)', () => {
  const a = big(1000);
  const b = big(1000, 1);
  const t0 = performance.now();
  const diff = diffSnapshots(a, b);
  layoutGraph(diff.nodes, diff.connections);
  const elapsed = performance.now() - t0;
  assert.ok(diff.counts.changed > 100);
  assert.ok(elapsed < 5000, `took ${elapsed.toFixed(0)} ms`);
});

test('three-way merge of 1,000-node snapshots is fast too', () => {
  const t0 = performance.now();
  const result = mergeSnapshots(big(1000), big(1000, 1), big(1000, 2));
  assert.ok(result.conflicts.length > 100);
  assert.ok(performance.now() - t0 < 5000);
});
