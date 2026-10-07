// Appearance: system | light | dark. The resolved value is written to <html data-theme="light|dark">;
// the choice is remembered in localStorage (any storage failure falls back to "system").

import { t } from './i18n.js';

export const STORAGE_KEY = 'opdiff.theme';
export const CHOICES = ['system', 'light', 'dark'];

export function parsePreference(value) {
  return CHOICES.includes(value) ? value : 'system';
}

/** 'light' or 'dark' for a choice, given whether the computer prefers dark. */
export function resolveTheme(preference, systemDark) {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}

export function loadPreference(storage = globalThis.localStorage) {
  try {
    return parsePreference(storage.getItem(STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/** Returns false when the choice could not be remembered (it still applies to this visit). */
export function savePreference(preference, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

export function applyTheme(root, preference, systemDark) {
  const resolved = resolveTheme(preference, systemDark);
  root.dataset.theme = resolved;
  root.dataset.themePref = preference;
  return resolved;
}

/** Segmented control in `container`; follows the system setting live while "system" is chosen. */
export function mountThemeControl(container, { root = document.documentElement, media = globalThis.matchMedia('(prefers-color-scheme: dark)'), storage } = {}) {
  let preference = loadPreference(storage);
  const buttons = new Map();

  const group = document.createElement('div');
  group.className = 'seg theme-seg';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', t('theme.label'));
  for (const choice of CHOICES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t(`theme.${choice}`);
    button.addEventListener('click', () => set(choice));
    buttons.set(choice, button);
    group.append(button);
  }
  container.append(group);

  function paint() {
    applyTheme(root, preference, media.matches);
    for (const [choice, button] of buttons) button.setAttribute('aria-pressed', String(choice === preference));
  }

  function set(choice) {
    preference = choice;
    savePreference(choice, storage);
    paint();
  }

  const onSystemChange = () => { if (preference === 'system') paint(); };
  media.addEventListener('change', onSystemChange);
  paint();

  return { set, get preference() { return preference; }, destroy() { media.removeEventListener('change', onSystemChange); group.remove(); } };
}
