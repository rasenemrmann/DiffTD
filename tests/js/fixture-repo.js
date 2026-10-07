// Builds throwaway Git repositories from the snapshot fixtures.
// CLI: node tests/js/fixture-repo.js history <dir> | merge <dir> <scenario>

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot } from '../../viewer/src/schema.js';
import { serializeSnapshot } from '../../viewer/src/snapshot-io.js';

const created = [];
process.on('exit', () => { for (const dir of created) rmSync(dir, { recursive: true, force: true }); });

/** A throwaway directory that is removed when the test process exits. */
export function tempDir(prefix = 'difftd-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const NET = 'snapshots/project1/net1.json';

export const fixture = (rel) => parseSnapshot(readFileSync(join(FIX, rel), 'utf8'));

export function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function put(dir, rel, snapshot) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), serializeSnapshot(snapshot));
}

function commit(dir, message) {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

/** Three-plus commits: add nodes, add node, change parameter (+ new container), change DAT text. */
export function makeHistoryRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  const oids = [];
  const s1 = fixture('before.json');
  put(dir, NET, s1);
  oids.push(commit(dir, 'initial network'));

  const s2 = structuredClone(s1);
  s2.nodes.push({ path: '/project1/net1/noise1', name: 'noise1', type: 'noiseCHOP', params: { seed: 1, period: 1 } });
  put(dir, NET, s2);
  oids.push(commit(dir, 'add noise1'));

  const s3 = structuredClone(s2);
  s3.nodes.find((n) => n.name === 'wave1').params.freq = 2;
  put(dir, NET, s3);
  const other = fixture('empty.json');
  other.meta.root = '/project1/other';
  other.nodes[0].path = '/project1/other';
  other.nodes[0].name = 'other';
  put(dir, 'snapshots/project1/other.json', other);
  oids.push(commit(dir, 'change wave1.freq, add other container'));

  const s4 = structuredClone(s3);
  s4.nodes.find((n) => n.name === 'script1').content.lines = ['a', 'B', 'c'];
  put(dir, NET, s4);
  oids.push(commit(dir, 'edit script1'));
  return { oids, snapshots: [s1, s2, s3, s4] };
}

/** Repo left in the middle of `git merge feature` for a tests/fixtures/merge/<scenario> set. */
export function makeMergeRepo(dir, scenario) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  put(dir, NET, fixture(`merge/${scenario}/base.json`));
  const base = commit(dir, 'base');
  git(dir, 'checkout', '-q', '-b', 'feature');
  put(dir, NET, fixture(`merge/${scenario}/theirs.json`));
  const theirs = commit(dir, 'theirs');
  git(dir, 'checkout', '-q', 'main');
  put(dir, NET, fixture(`merge/${scenario}/ours.json`));
  const ours = commit(dir, 'ours');
  let mergeExit = 0;
  try {
    git(dir, 'merge', '--no-edit', 'feature');
  } catch {
    mergeExit = 1;
  }
  return { base, ours, theirs, mergeExit };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [kind, dir, scenario] = process.argv.slice(2);
  if (kind === 'history') console.log(JSON.stringify(makeHistoryRepo(dir).oids));
  else if (kind === 'merge') console.log(JSON.stringify(makeMergeRepo(dir, scenario ?? 'param-conflict')));
  else console.error('usage: node tests/js/fixture-repo.js history <dir> | merge <dir> <scenario>');
}
