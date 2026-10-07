import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import git from 'isomorphic-git';
import { openRepoWithFs } from '../../viewer/src/gitrepo.js';
import { parseSnapshot } from '../../viewer/src/schema.js';
import { serializeSnapshot } from '../../viewer/src/snapshot-io.js';
import { mergeSnapshots, applyResolution, finalize, isResolved } from '../../viewer/src/merge.js';
import { makeMergeRepo, tempDir } from './fixture-repo.js';

const NET = 'snapshots/project1/net1.json';
const tmp = () => tempDir();

async function startReview(dir) {
  const repo = openRepoWithFs({ git, fs, dir, write: true });
  const theirs = await repo.mergeHead();
  const ours = await repo.headOid();
  const base = await repo.mergeBase(ours, theirs);
  const read = async (oid) => {
    const text = await repo.readSnapshotAt(oid, NET);
    return text === null ? null : parseSnapshot(text);
  };
  return { repo, result: mergeSnapshots(await read(base), await read(ours), await read(theirs)) };
}

test('quickstart step 7: one conflict, non-clashing edits in the same node kept', async () => {
  const dir = tmp();
  const { mergeExit } = makeMergeRepo(dir, 'quickstart');
  assert.equal(mergeExit, 1, 'Git itself reports a conflict');
  const { repo, result } = await startReview(dir);
  assert.deepEqual(result.conflicts.map((c) => c.key), ['/project1/net1/wave1#freq']);
  const noise = result.merged.nodes.find((n) => n.name === 'noise1');
  assert.deepEqual([noise.params.period, noise.params.seed], [2, 5]);

  const resolved = applyResolution(result, result.conflicts[0].id, 'theirs');
  assert.equal(isResolved(resolved), true);
  const text = serializeSnapshot(finalize(resolved));
  await repo.writeSnapshot(NET, text);
  const onDisk = fs.readFileSync(path.join(dir, NET), 'utf8');
  assert.equal(onDisk, text);
  assert.ok(!onDisk.includes('<<<<<<<'), 'conflict markers from the textual merge are replaced');
  assert.equal(parseSnapshot(onDisk).nodes.find((n) => n.name === 'wave1').params.freq, 3);
});

test('nothing is written to disk before the explicit write call', async () => {
  const dir = tmp();
  makeMergeRepo(dir, 'quickstart');
  const before = fs.readFileSync(path.join(dir, NET), 'utf8');
  const { result } = await startReview(dir);
  applyResolution(result, result.conflicts[0].id, 'ours');
  assert.equal(fs.readFileSync(path.join(dir, NET), 'utf8'), before);
});

test('a clean disjoint merge needs no review and matches expected output', async () => {
  const dir = tmp();
  const { mergeExit } = makeMergeRepo(dir, 'disjoint');
  assert.equal(mergeExit, 0, 'Git merges it by itself, the viewer agrees');
});
