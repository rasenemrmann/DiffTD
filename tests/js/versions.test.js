import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeEntry, mergeSources, sortVersions, filterVersions, defaultPair, resolveSelection, swapPair,
} from '../../viewer/src/versions.js';

const e = (id, name, modified, kind = 'folder', extra = {}) => makeEntry({ id, name, size: 10, modified, origin: { kind, label: kind, ...extra } });

test('same content from different sources is listed once with both origins', () => {
  const merged = mergeSources([e('h1', 'a.toe', 100, 'folder', { folder: 'work' }), e('h1', 'a_copy.toe', 200, 'upload')]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].origins.length, 2);
  assert.equal(merged[0].modified, 200);
  assert.equal(merged[0].name, 'a_copy.toe');
});

test('the same origin twice is not duplicated (repeated import, SC-003)', () => {
  let list = [];
  for (let i = 0; i < 10; i += 1) list = mergeSources([...list, e('h1', 'a.toe', 100, 'folder', { folder: 'work' })]);
  assert.equal(list.length, 1);
  assert.equal(list[0].origins.length, 1);
});

test('a better status wins when merging (ready over idle, keeps roots)', () => {
  const idle = e('h1', 'a.toe', 100);
  const ready = { ...e('h1', 'a.toe', 100, 'upload'), status: 'ready', roots: { project1: {} } };
  const merged = mergeSources([idle, ready])[0];
  assert.equal(merged.status, 'ready');
  assert.ok(merged.roots);
});

test('sorted newest first; equal dates by natural name, higher number first', () => {
  const list = [e('a', 'v2.toe', 100), e('b', 'v10.toe', 100), e('c', 'old.toe', 50), e('d', 'new.toe', 300)];
  assert.deepEqual(sortVersions(list).map((v) => v.name), ['new.toe', 'v10.toe', 'v2.toe', 'old.toe']);
});

test('sorting does not mutate its input', () => {
  const list = [e('a', 'a.toe', 1), e('b', 'b.toe', 2)];
  sortVersions(list);
  assert.equal(list[0].id, 'a');
});

test('filter by name or folder, case-insensitive; empty filter keeps everything', () => {
  const list = [e('a', 'Scan_v1.toe', 1, 'folder', { folder: 'Analog' }), e('b', 'other.toe', 2, 'upload')];
  assert.deepEqual(filterVersions(list, 'scan').map((v) => v.id), ['a']);
  assert.deepEqual(filterVersions(list, 'ANALOG').map((v) => v.id), ['a']);
  assert.equal(filterVersions(list, '  ').length, 2);
  assert.equal(filterVersions(list, 'zzz').length, 0);
});

test('default pair: two newest; null with fewer than two', () => {
  assert.equal(defaultPair([]), null);
  assert.equal(defaultPair([e('a', 'a.toe', 1)]), null);
  assert.deepEqual(defaultPair([e('a', 'a.toe', 1), e('b', 'b.toe', 5), e('c', 'c.toe', 3)]), { olderId: 'c', newerId: 'b' });
});

test('selection survives while both entries exist, resets when one is removed', () => {
  const list = [e('a', 'a.toe', 1), e('b', 'b.toe', 2), e('c', 'c.toe', 3)];
  const sel = { olderId: 'a', newerId: 'b' };
  assert.deepEqual(resolveSelection(list, sel), sel);
  assert.deepEqual(resolveSelection(list.filter((v) => v.id !== 'a'), sel), { olderId: 'b', newerId: 'c' });
  assert.equal(resolveSelection([list[0]], sel), null);
  assert.deepEqual(resolveSelection(list, null), { olderId: 'b', newerId: 'c' });
});

test('swap', () => {
  assert.deepEqual(swapPair({ olderId: 'a', newerId: 'b' }), { olderId: 'b', newerId: 'a' });
  assert.equal(swapPair(null), null);
});
