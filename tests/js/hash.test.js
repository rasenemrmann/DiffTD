import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../../viewer/src/hash.js';

const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('known vectors', async () => {
  assert.equal(await sha256Hex(new Uint8Array([])), EMPTY);
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), ABC);
});

test('Blob, ArrayBuffer and typed-array views agree', async () => {
  const bytes = new TextEncoder().encode('abc');
  assert.equal(await sha256Hex(new Blob([bytes])), ABC);
  assert.equal(await sha256Hex(bytes.buffer.slice(0)), ABC);
  const padded = new Uint8Array([9, 9, ...bytes, 9]);
  assert.equal(await sha256Hex(padded.subarray(2, 5)), ABC, 'a view into a larger buffer hashes only the view');
});

test('empty Blob and bad input', async () => {
  assert.equal(await sha256Hex(new Blob([])), EMPTY);
  await assert.rejects(sha256Hex('abc'), TypeError);
});
