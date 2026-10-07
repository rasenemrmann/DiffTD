import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { STRINGS, t, pickLanguage } from '../../viewer/src/i18n.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('German and English define exactly the same keys', () => {
  assert.deepEqual(Object.keys(STRINGS.de).sort(), Object.keys(STRINGS.en).sort());
});

test('no empty strings and the same placeholders in both languages', () => {
  for (const key of Object.keys(STRINGS.en)) {
    assert.ok(STRINGS.en[key].trim() && STRINGS.de[key].trim(), `empty text for ${key}`);
    assert.deepEqual(placeholders(STRINGS.de[key]), placeholders(STRINGS.en[key]), `placeholders differ for ${key}`);
  }
});

test('t substitutes parameters, keeps unknown ones visible, falls back to the key', () => {
  assert.equal(t('list.count', { n: 4 }, 'en'), '4 versions');
  assert.equal(t('list.count', { n: 4 }, 'de'), '4 Versionen');
  assert.equal(t('list.count', {}, 'en'), '{n} versions');
  assert.equal(t('does.not.exist', {}, 'de'), 'does.not.exist');
  assert.equal(t('list.title', {}, 'fr'), 'Versions');
});

test('language comes from the browser list, English as fallback', () => {
  assert.equal(pickLanguage(['de-DE', 'en']), 'de');
  assert.equal(pickLanguage(['fr-FR', 'en-US']), 'en');
  assert.equal(pickLanguage(['fr']), 'en');
  assert.equal(pickLanguage([]), 'en');
});

test('every t("…") key used in the viewer source exists', () => {
  const dir = new URL('../../viewer/src/', import.meta.url);
  const files = [];
  const walk = (u) => {
    for (const e of readdirSync(u, { withFileTypes: true })) {
      if (e.isDirectory()) walk(new URL(`${e.name}/`, u));
      else if (e.name.endsWith('.js') && e.name !== 'i18n.js') files.push(new URL(e.name, u));
    }
  };
  walk(dir);
  const missing = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bt\('([\w.]+)'/g)) if (!(m[1] in STRINGS.en)) missing.push(`${f.pathname.split('/src/')[1]}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});
