import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseSnapshot } from '../../viewer/src/schema.js';
import { serializeSnapshot } from '../../viewer/src/snapshot-io.js';

const fx = (rel) => readFileSync(new URL(`../fixtures/${rel}`, import.meta.url), 'utf8');
const hashes = JSON.parse(fx('canonical-hashes.json'));

for (const [rel, digest] of Object.entries(hashes)) {
  test(`canonical roundtrip and Python byte equality: ${rel}`, () => {
    const text = fx(rel);
    const out = serializeSnapshot(parseSnapshot(text));
    assert.equal(out, text);
    assert.equal(createHash('sha256').update(out).digest('hex'), digest);
  });
}

test('ordering is canonical regardless of input order', () => {
  const obj = parseSnapshot(fx('nested.json'));
  const shuffled = { ...obj, nodes: [...obj.nodes].reverse(), connections: [...obj.connections].reverse() };
  assert.equal(serializeSnapshot(shuffled), serializeSnapshot(obj));
});

test('zero indices omitted', () => {
  const obj = parseSnapshot(fx('simple.json'));
  obj.connections[0].fromIndex = 0;
  obj.connections[0].toIndex = 0;
  assert.ok(!serializeSnapshot(obj).includes('fromIndex'));
});

test('unicode and control characters match Python output', () => {
  const obj = parseSnapshot(fx('dat.json'));
  obj.nodes[1].content.lines[0] = 'größe ✓ \u0001';
  const text = serializeSnapshot(obj);
  assert.ok(text.includes('größe ✓') && text.includes('\\u0001'));
});
