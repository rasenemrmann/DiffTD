import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSnapshot } from '../../viewer/src/schema.js';
import { diffSnapshots, diffText, diffTable, STATUS } from '../../viewer/src/diff.js';
import { validateSnapshot } from '../../viewer/src/schema.js';

const load = (name) => parseSnapshot(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
const byName = (result) => Object.fromEntries(result.nodes.map((n) => [n.name, n]));

test('node statuses between before and after', () => {
  const nodes = byName(diffSnapshots(load('before'), load('after')));
  assert.equal(nodes.wave1.status, STATUS.CHANGED);
  assert.equal(nodes.math1.status, STATUS.REMOVED);
  assert.equal(nodes.noise1.status, STATUS.ADDED);
  assert.equal(nodes.out1.status, STATUS.UNCHANGED);
  assert.equal(nodes.net1.status, STATUS.UNCHANGED);
  assert.equal(nodes.script1.status, STATUS.CHANGED);
});

test('parameter changes carry before and after values', () => {
  const wave = byName(diffSnapshots(load('before'), load('after'))).wave1;
  assert.deepEqual(wave.paramChanges, [{ name: 'freq', status: 'changed', before: 1, after: 2 }]);
});

test('expression changes are detected', () => {
  const a = load('simple');
  const b = load('simple');
  b.nodes.find((n) => n.name === 'wave1').params.offset = { expr: 'absTime.frame' };
  const wave = byName(diffSnapshots(a, b)).wave1;
  assert.equal(wave.paramChanges[0].name, 'offset');
  assert.deepEqual(wave.paramChanges[0].after, { expr: 'absTime.frame' });
});

test('added and removed parameters', () => {
  const a = load('simple');
  const b = load('simple');
  delete b.nodes.find((n) => n.name === 'wave1').params.amp;
  b.nodes.find((n) => n.name === 'wave1').params.extra = 3;
  const changes = byName(diffSnapshots(a, b)).wave1.paramChanges;
  assert.deepEqual(changes.map((c) => [c.name, c.status]), [['amp', 'removed'], ['extra', 'added']]);
});

test('connection statuses', () => {
  const conns = diffSnapshots(load('before'), load('after')).connections;
  const status = (from, to) => conns.find((c) => c.from.endsWith(from) && c.to.endsWith(to))?.status;
  assert.equal(status('wave1', 'math1'), 'removed');
  assert.equal(status('math1', 'out1'), 'removed');
  assert.equal(status('wave1', 'out1'), 'added');
  assert.equal(status('noise1', 'out1'), 'added');
});

test('text hunks show the changed line', () => {
  const script = byName(diffSnapshots(load('before'), load('after'))).script1;
  assert.equal(script.contentDiff.kind, 'text');
  assert.equal(script.contentDiff.hunks.length, 1);
  assert.deepEqual(script.contentDiff.hunks[0].before, ['b']);
  assert.deepEqual(script.contentDiff.hunks[0].after, ['B']);
  assert.equal(script.contentDiff.hunks[0].beforeStart, 1);
});

test('diffText handles insertions, deletions and identical input', () => {
  assert.deepEqual(diffText(['a', 'b'], ['a', 'b']), []);
  const ins = diffText(['a', 'c'], ['a', 'b', 'c']);
  assert.deepEqual(ins.map((h) => [h.beforeCount, h.afterCount, h.after]), [[0, 1, ['b']]]);
  const del = diffText(['a', 'b', 'c'], ['a', 'c']);
  assert.deepEqual(del.map((h) => [h.beforeCount, h.afterCount, h.before]), [[1, 0, ['b']]]);
});

test('table cell changes, including added rows', () => {
  const changes = diffTable([['a', '1']], [['a', '2'], ['b', '3']]);
  assert.deepEqual(changes, [
    { row: 0, col: 1, before: '1', after: '2' },
    { row: 1, col: 0, before: undefined, after: 'b' },
    { row: 1, col: 1, before: undefined, after: '3' },
  ]);
});

test('rename shows as remove plus add', () => {
  const a = load('simple');
  const b = load('simple');
  const wave = b.nodes.find((n) => n.name === 'wave1');
  wave.name = 'wave2';
  wave.path = wave.path.replace('wave1', 'wave2');
  const nodes = byName(diffSnapshots(a, b));
  assert.equal(nodes.wave1.status, STATUS.REMOVED);
  assert.equal(nodes.wave2.status, STATUS.ADDED);
});

test('missing side is treated as empty: everything added or removed', () => {
  const added = diffSnapshots(null, load('simple'));
  assert.ok(added.nodes.every((n) => n.status === STATUS.ADDED));
  assert.ok(added.connections.every((c) => c.status === STATUS.ADDED));
  const removed = diffSnapshots(load('simple'), null);
  assert.ok(removed.nodes.every((n) => n.status === STATUS.REMOVED));
});

test('output is deterministic and counts add up', () => {
  const r1 = diffSnapshots(load('before'), load('after'));
  const r2 = diffSnapshots(load('before'), load('after'));
  assert.deepEqual(r1, r2);
  assert.equal(Object.values(r1.counts).reduce((a, b) => a + b, 0), r1.nodes.length);
});

test('a moved node keeps its status but reports the move (layout is display-only)', () => {
  const a = load('simple');
  a.nodes.find((n) => n.name === 'wave1').layout = { x: 0, y: 0, w: 130, h: 90 };
  const b = structuredClone(a);
  b.nodes.find((n) => n.name === 'wave1').layout = { x: 40, y: 10, w: 130, h: 90 };
  const wave = byName(diffSnapshots(a, b)).wave1;
  assert.equal(wave.status, STATUS.UNCHANGED);
  assert.deepEqual(wave.moved, { before: { x: 0, y: 0, w: 130, h: 90 }, after: { x: 40, y: 10, w: 130, h: 90 } });
  assert.deepEqual(wave.layout, { x: 40, y: 10, w: 130, h: 90 });
});

test('layout is part of the schema and must be numeric', () => {
  const ok = load('simple');
  ok.nodes[0].layout = { x: 1, y: 2, w: 3, h: 4 };
  assert.equal(validateSnapshot(ok).ok, true);
  ok.nodes[0].layout = { x: 'a', y: 2, w: 3, h: 4 };
  assert.equal(validateSnapshot(ok).ok, false);
});
