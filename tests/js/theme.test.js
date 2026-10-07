import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreference, resolveTheme, loadPreference, savePreference, applyTheme, STORAGE_KEY, CHOICES } from '../../viewer/src/theme.js';

const memory = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
};
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('unknown or missing values mean system', () => {
  for (const v of [null, undefined, '', 'blue', 'LIGHT', 3]) assert.equal(parsePreference(v), 'system');
  for (const c of CHOICES) assert.equal(parsePreference(c), c);
});

test('resolving: explicit choices ignore the system, system follows it', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('a saved choice is loaded again; default is system', () => {
  const storage = memory();
  assert.equal(loadPreference(storage), 'system');
  assert.equal(savePreference('dark', storage), true);
  assert.equal(storage.data[STORAGE_KEY], 'dark');
  assert.equal(loadPreference(storage), 'dark');
  assert.equal(loadPreference(memory({ [STORAGE_KEY]: 'garbage' })), 'system');
});

test('blocked storage: nothing throws, the choice just is not remembered', () => {
  assert.equal(loadPreference(broken), 'system');
  assert.equal(savePreference('light', broken), false);
});

test('applyTheme writes the resolved theme and the choice to the root', () => {
  const root = { dataset: {} };
  assert.equal(applyTheme(root, 'system', true), 'dark');
  assert.deepEqual(root.dataset, { theme: 'dark', themePref: 'system' });
  assert.equal(applyTheme(root, 'light', true), 'light');
  assert.deepEqual(root.dataset, { theme: 'light', themePref: 'light' });
});

test('a system change only matters while the choice is system', () => {
  const root = { dataset: {} };
  applyTheme(root, 'dark', false);
  assert.equal(root.dataset.theme, 'dark');
  applyTheme(root, 'system', false);
  assert.equal(root.dataset.theme, 'light');
  applyTheme(root, 'system', true);
  assert.equal(root.dataset.theme, 'dark');
});

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../../viewer/index.html', import.meta.url), 'utf8');

function runInlineScript({ stored, systemDark, storageBroken = false }) {
  const source = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const root = { dataset: {} };
  const sandbox = {
    document: { documentElement: root },
    localStorage: storageBroken ? { getItem() { throw new Error('blocked'); } } : { getItem: () => stored },
    matchMedia: () => ({ matches: systemDark }),
  };
  vm.runInNewContext(source, sandbox);
  return root.dataset;
}

test('the inline script in index.html gives the same result as theme.js for every combination', () => {
  for (const stored of [null, 'system', 'light', 'dark', 'garbage']) {
    for (const systemDark of [true, false]) {
      const pref = parsePreference(stored);
      const got = runInlineScript({ stored, systemDark });
      assert.equal(got.theme, resolveTheme(pref, systemDark), `stored=${stored} systemDark=${systemDark}`);
      assert.equal(got.themePref, pref);
    }
  }
});

test('the inline script survives blocked storage and follows the system', () => {
  assert.equal(runInlineScript({ systemDark: true, storageBroken: true }).theme, 'dark');
  assert.equal(runInlineScript({ systemDark: false, storageBroken: true }).theme, 'light');
});

test('the inline script runs before the stylesheet is requested (no flash)', () => {
  const script = html.indexOf('<script>');
  const sheet = html.indexOf('<link rel="stylesheet"');
  assert.ok(script > 0 && sheet > script);
});

test('the stylesheet defines the light tokens only under data-theme and has no media-query copy', () => {
  const css = readFileSync(new URL('../../viewer/src/style.css', import.meta.url), 'utf8');
  assert.ok(css.includes(':root[data-theme="light"] {'));
  assert.ok(!css.includes('prefers-color-scheme'));
});

test('the language files have the theme keys', async () => {
  const { STRINGS } = await import('../../viewer/src/i18n.js');
  for (const lang of ['de', 'en']) for (const k of ['label', 'system', 'light', 'dark']) assert.ok(STRINGS[lang][`theme.${k}`]);
});
