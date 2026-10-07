import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseSnapshot } from '../../viewer/src/schema.js';
import { serializeSnapshot } from '../../viewer/src/snapshot-io.js';
import { mergeSnapshots, applyResolution, isResolved, finalize, diff3Lines } from '../../viewer/src/merge.js';

const path = (rel) => new URL(`../fixtures/merge/${rel}`, import.meta.url);
const load = (scenario, name) => parseSnapshot(readFileSync(path(`${scenario}/${name}.json`), 'utf8'));
const expectedConflicts = (scenario) => JSON.parse(readFileSync(path(`${scenario}/conflicts.json`), 'utf8'));
const run = (scenario) => mergeSnapshots(load(scenario, 'base'), load(scenario, 'ours'), load(scenario, 'theirs'));

for (const scenario of ['disjoint', 'identical', 'dat-merge']) {
  test(`${scenario}: merges without conflicts and equals expected`, () => {
    const result = run(scenario);
    assert.deepEqual(result.conflicts, []);
    assert.equal(isResolved(result), true);
    const expected = readFileSync(path(`${scenario}/expected.json`), 'utf8');
    assert.equal(serializeSnapshot(finalize(result)), expected);
  });
}

for (const scenario of ['param-conflict', 'edit-vs-delete', 'add-add', 'connection-vs-delete', 'dat-conflict']) {
  test(`${scenario}: reports exactly the expected conflicts`, () => {
    const result = run(scenario);
    assert.deepEqual(result.conflicts.map((c) => ({ kind: c.kind, key: c.key })), expectedConflicts(scenario));
    assert.equal(isResolved(result), false);
    assert.throws(() => finalize(result), /unresolved/);
  });
}

test('disjoint edits to different parameters of the same node are both kept (SC-008)', () => {
  const merged = finalize(run('disjoint'));
  const wave = merged.nodes.find((n) => n.name === 'wave1');
  assert.equal(wave.params.freq, 2);
  assert.equal(wave.params.wavetype, 'square');
  assert.equal(merged.nodes.find((n) => n.name === 'math1').params.gain, 3);
  assert.ok(merged.nodes.some((n) => n.name === 'noise1'));
});

test('param conflict: both values are exposed and either can be chosen', () => {
  const result = run('param-conflict');
  const c = result.conflicts[0];
  assert.deepEqual([c.base, c.ours, c.theirs], [1, 2, 3]);
  const val = (r) => r.merged.nodes.find((n) => n.name === 'wave1').params.freq;
  assert.equal(val(result), 2); // unresolved previews as ours
  const t = applyResolution(result, c.id, 'theirs');
  assert.equal(isResolved(t), true);
  assert.equal(val(finalize(t) && t), 3);
  const o = applyResolution(result, c.id, 'ours');
  assert.equal(val(o), 2);
  assert.equal(result.conflicts[0].resolution, null, 'applyResolution does not mutate its input');
});

test('invalid resolution values and ids are rejected', () => {
  const result = run('param-conflict');
  assert.throws(() => applyResolution(result, result.conflicts[0].id, 'kept'), /not a valid choice/);
  assert.throws(() => applyResolution(result, 'nope', 'ours'), /unknown conflict/);
});

test('edit-vs-delete: keep restores the edited node with its connections, delete removes both', () => {
  const result = run('edit-vs-delete');
  const c = result.conflicts[0];
  assert.deepEqual(c.choices, ['kept', 'deleted']);
  const kept = finalize(applyResolution(result, c.id, 'kept'));
  assert.equal(kept.nodes.find((n) => n.name === 'math1').params.gain, 3);
  assert.equal(kept.connections.length, 2, 'wiring from the editing side is preserved');
  const deleted = finalize(applyResolution(result, c.id, 'deleted'));
  assert.ok(!deleted.nodes.some((n) => n.name === 'math1'));
  assert.equal(deleted.connections.length, 0);
});

test('connection added to a node the other side deleted is a node conflict', () => {
  const result = run('connection-vs-delete');
  const c = result.conflicts[0];
  const kept = finalize(applyResolution(result, c.id, 'kept'));
  assert.ok(kept.connections.some((x) => x.from.endsWith('noise1') && x.to.endsWith('math1')));
  const deleted = finalize(applyResolution(result, c.id, 'deleted'));
  assert.ok(!deleted.connections.some((x) => x.to.endsWith('math1') || x.from.endsWith('math1')));
  assert.ok(deleted.nodes.some((n) => n.name === 'noise1'), 'the added node itself is kept');
});

test('add-add conflict picks a whole node', () => {
  const result = run('add-add');
  const t = finalize(applyResolution(result, result.conflicts[0].id, 'theirs'));
  assert.equal(t.nodes.find((n) => n.name === 'noise1').params.seed, 2);
});

test('DAT hunks: overlapping edits conflict at hunk level, resolved text is assembled', () => {
  const result = run('dat-conflict');
  const c = result.conflicts[0];
  assert.deepEqual([c.base, c.ours, c.theirs], [['l2'], ['OURS'], ['THEIRS']]);
  const merged = finalize(applyResolution(result, c.id, 'theirs'));
  assert.deepEqual(merged.nodes.find((n) => n.name === 'script1').content.lines, ['l1', 'THEIRS', 'l3', 'l4', 'l5']);
});

test('resolved result validates and serializes canonically', () => {
  const result = run('param-conflict');
  const text = serializeSnapshot(finalize(applyResolution(result, result.conflicts[0].id, 'ours')));
  assert.equal(serializeSnapshot(parseSnapshot(text)), text);
});

test('container added on one side only is taken as is; missing base is empty', () => {
  const theirs = load('disjoint', 'base');
  const result = mergeSnapshots(null, null, theirs);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.merged.nodes.length, theirs.nodes.length);
});

test('table DAT: different cells merge, same cell conflicts', () => {
  const base = parseSnapshot(readFileSync(new URL('../fixtures/dat.json', import.meta.url), 'utf8'));
  const edit = (fn) => { const s = structuredClone(base); fn(s.nodes.find((n) => n.name === 'table1').content.rows); return s; };
  const ok = mergeSnapshots(base, edit((r) => { r[1][1] = 'X'; }), edit((r) => { r[2][1] = 'Y'; }));
  assert.deepEqual(ok.conflicts, []);
  assert.deepEqual(ok.merged.nodes.find((n) => n.name === 'table1').content.rows, [['name', 'value'], ['a', 'X'], ['b', 'Y']]);
  const bad = mergeSnapshots(base, edit((r) => { r[1][1] = 'X'; }), edit((r) => { r[1][1] = 'Z'; }));
  assert.equal(bad.conflicts[0].kind, 'content');
  const reshaped = mergeSnapshots(base, edit((r) => { r.push(['c', '3']); }), edit((r) => { r[1][1] = 'Z'; }));
  assert.equal(reshaped.conflicts.length, 1, 'a row added on one side and a cell edited on the other conflicts on the whole table');
  assert.equal(reshaped.conflicts[0].key.endsWith('#content'), true);
});

test('diff3Lines basics', () => {
  assert.deepEqual(diff3Lines(['a'], ['a'], ['a']), [{ ok: ['a'] }]);
  assert.deepEqual(diff3Lines(['a', 'b'], ['a', 'b', 'c'], ['x', 'a', 'b']), [{ ok: ['x', 'a', 'b', 'c'] }]);
  const conflict = diff3Lines(['a'], ['b'], ['c']);
  assert.deepEqual(conflict, [{ conflict: { base: ['a'], ours: ['b'], theirs: ['c'] } }]);
});

test('merge result is deterministic', () => {
  assert.deepEqual(run('disjoint').merged, run('disjoint').merged);
  assert.ok(existsSync(path('disjoint/expected.json')));
});
