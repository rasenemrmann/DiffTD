import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import git from 'isomorphic-git';
import { openRepoWithFs } from '../../viewer/src/gitrepo.js';
import { parseSnapshot } from '../../viewer/src/schema.js';
import { makeHistoryRepo, makeMergeRepo, git as runGit, tempDir } from './fixture-repo.js';

const tmp = () => tempDir();
const NET = 'snapshots/project1/net1.json';

function open(dir, write = false) {
  return openRepoWithFs({ git, fs, dir, write });
}

test('listCommits returns newest first with messages', async () => {
  const dir = tmp();
  const { oids } = makeHistoryRepo(dir);
  const commits = await open(dir).listCommits();
  assert.deepEqual(commits.map((c) => c.oid), [...oids].reverse());
  assert.equal(commits[0].message, 'edit script1');
  assert.equal(commits[0].author, 'Test');
});

test('readSnapshotAt returns the file as of that commit, null if missing', async () => {
  const dir = tmp();
  const { oids } = makeHistoryRepo(dir);
  const repo = open(dir);
  const first = parseSnapshot(await repo.readSnapshotAt(oids[0], NET));
  assert.ok(!first.nodes.some((n) => n.name === 'noise1'));
  const second = parseSnapshot(await repo.readSnapshotAt(oids[1], NET));
  assert.ok(second.nodes.some((n) => n.name === 'noise1'));
  assert.equal(await repo.readSnapshotAt(oids[0], 'snapshots/project1/other.json'), null);
});

test('listSnapshotsAt shows containers per commit', async () => {
  const dir = tmp();
  const { oids } = makeHistoryRepo(dir);
  const repo = open(dir);
  assert.deepEqual(await repo.listSnapshotsAt(oids[0]), [NET]);
  assert.deepEqual(await repo.listSnapshotsAt(oids[2]), [NET, 'snapshots/project1/other.json']);
});

test('works with packed objects after git gc', async () => {
  const dir = tmp();
  const { oids } = makeHistoryRepo(dir);
  runGit(dir, 'gc', '-q', '--aggressive');
  const repo = open(dir);
  assert.equal((await repo.listCommits()).length, 4);
  assert.ok(await repo.readSnapshotAt(oids[3], NET));
});

test('mergeBase and mergeHead during a conflicted merge', async () => {
  const dir = tmp();
  const { base, theirs, ours, mergeExit } = makeMergeRepo(dir, 'param-conflict');
  assert.equal(mergeExit, 1);
  const repo = open(dir);
  assert.equal(await repo.mergeBase(ours, theirs), base);
  assert.equal(await repo.mergeHead(), theirs);
  assert.equal(await repo.headOid(), ours);
  assert.equal(await repo.currentBranch(), 'main');
});

test('mergeHead is null outside a merge', async () => {
  const dir = tmp();
  makeHistoryRepo(dir);
  assert.equal(await open(dir).mergeHead(), null);
});

test('writeSnapshot requires write access and writes the file', async () => {
  const dir = tmp();
  makeHistoryRepo(dir);
  await assert.rejects(open(dir).writeSnapshot(NET, 'x'), /read-only/);
  await open(dir, true).writeSnapshot('snapshots/project1/new.json', '{}\n');
  assert.equal(fs.readFileSync(path.join(dir, 'snapshots/project1/new.json'), 'utf8'), '{}\n');
});
