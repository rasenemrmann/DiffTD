import test from 'node:test';
import assert from 'node:assert/strict';
import { scanDirectory, isProjectFile } from '../../viewer/src/folder-scan.js';
import { ensurePermission, loadFolder, saveFolder } from '../../viewer/src/folder-store.js';

const file = (name, size = 10, modified = 1000) => ({ kind: 'file', name, getFile: async () => ({ size, lastModified: modified }) });
const dir = (name, children) => ({ kind: 'directory', name, async *values() { yield* children; } });

test('finds project files at the top level and one level down, skips the rest', async () => {
  const root = dir('work', [
    file('a.toe'), file('b.TOX'), file('notes.txt'), file('.hidden.toe'),
    dir('old', [file('c.toe'), dir('deeper', [file('d.toe')])]),
    dir('.git', [file('e.toe')]),
  ]);
  const found = await scanDirectory(root);
  assert.deepEqual(found.map((f) => [f.name, f.folder]).sort(), [['a.toe', 'work'], ['b.TOX', 'work'], ['c.toe', 'old']]);
  assert.equal(found[0].size, 10);
  assert.equal(found[0].modified, 1000);
});

test('an unreadable file does not stop the scan', async () => {
  const broken = { kind: 'file', name: 'bad.toe', getFile: async () => { throw new Error('gone'); } };
  const found = await scanDirectory(dir('x', [broken, file('ok.toe')]));
  assert.deepEqual(found.map((f) => f.name), ['ok.toe']);
});

test('empty folder', async () => {
  assert.deepEqual(await scanDirectory(dir('empty', [])), []);
});

test('isProjectFile', () => {
  assert.ok(isProjectFile('x.toe') && isProjectFile('X.TOX'));
  assert.ok(!isProjectFile('x.toe.bak') && !isProjectFile('toe'));
});

test('folder store degrades silently without IndexedDB', async () => {
  assert.equal(await loadFolder(undefined), null);
  assert.equal(await saveFolder({ name: 'x' }, undefined), false);
});

test('ensurePermission: granted, prompt-then-granted, denied, unsupported', async () => {
  assert.equal(await ensurePermission({ queryPermission: async () => 'granted' }), true);
  assert.equal(await ensurePermission({ queryPermission: async () => 'prompt', requestPermission: async () => 'granted' }), true);
  assert.equal(await ensurePermission({ queryPermission: async () => 'prompt', requestPermission: async () => 'denied' }), false);
  assert.equal(await ensurePermission({}), false);
});
