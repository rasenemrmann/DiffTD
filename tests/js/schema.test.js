import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSnapshot, validateSnapshot, SnapshotError } from '../../viewer/src/schema.js';

const fx = (name) => readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8');

for (const name of ['simple', 'nested', 'dat', 'empty', 'before', 'after']) {
  test(`valid fixture ${name} parses`, () => {
    assert.equal(parseSnapshot(fx(name)).meta.format_version, 1);
  });
}

for (const [name, code] of [
  ['invalid-schema', 'schema'],
  ['dangling-connection', 'dangling_connection'],
  ['future-version', 'unsupported_version'],
]) {
  test(`invalid fixture ${name} rejected with ${code}`, () => {
    const result = validateSnapshot(JSON.parse(fx(name)));
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, code);
    assert.throws(() => parseSnapshot(fx(name)), SnapshotError);
  });
}

test('malformed JSON gives a readable error', () => {
  assert.throws(() => parseSnapshot(fx('malformed')), /not valid JSON/);
});

test('duplicate paths and outside-root nodes are rejected', () => {
  const obj = JSON.parse(fx('simple'));
  obj.nodes.push({ ...obj.nodes[1] });
  assert.ok(validateSnapshot(obj).errors.some((e) => e.code === 'duplicate_path'));
  const obj2 = JSON.parse(fx('simple'));
  obj2.nodes[1].path = '/elsewhere/x';
  assert.ok(validateSnapshot(obj2).errors.some((e) => e.code === 'outside_root'));
});

test('expression, bind and export parameter forms are accepted; other objects are not', () => {
  const obj = JSON.parse(fx('simple'));
  obj.nodes[1].params.a = { expr: 'x' };
  obj.nodes[1].params.b = { bind: 'op("a").par.b' };
  obj.nodes[1].params.c = { export: '/p/chan1' };
  assert.equal(validateSnapshot(obj).ok, true);
  obj.nodes[1].params.d = { nope: 1 };
  assert.equal(validateSnapshot(obj).ok, false);
});
