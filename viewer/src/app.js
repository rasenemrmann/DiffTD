// opdiff shell: header navigation, "More" menu, status bar, language, lazily loaded modes.

import { t, getLanguage } from './i18n.js';
import { createShell } from './ui/status.js';
import { mountThemeControl } from './theme.js';
import { createHelperClient, watchHelper } from './helper-client.js';

const modeRoot = document.getElementById('mode-root');
const shell = createShell({
  statusbar: document.getElementById('statusbar'),
  toastRegion: document.getElementById('toast-region'),
  pill: document.getElementById('helper-pill'),
});

document.documentElement.lang = getLanguage();
document.title = t('app.title');
document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
shell.setHelper('unknown');
mountThemeControl(document.getElementById('theme-slot'));

// One connection to the local helper for the whole app; modes subscribe to changes.
const helperClient = createHelperClient();
const helperListeners = new Set();
let helperUp = null;
let stopHelperWatch = () => {};
function startHelperWatch() {
  stopHelperWatch();
  stopHelperWatch = watchHelper(helperClient, (up) => {
    helperUp = up;
    shell.setHelper(up ? 'up' : 'down');
    helperListeners.forEach((cb) => cb(up));
  }, { minMs: 1000, maxMs: 8000 });
}
shell.client = helperClient;
shell.onHelper = (cb) => {
  helperListeners.add(cb);
  if (helperUp !== null) cb(helperUp);
  return () => helperListeners.delete(cb);
};
shell.recheckHelper = () => { helperUp = null; shell.setHelper('unknown'); startHelperWatch(); };
startHelperWatch();

const MODES = {
  local: () => import('./ui/local-mode.js').then((m) => m.mountLocalMode),
  files: () => import('./ui/file-mode.js').then((m) => m.mountFileMode),
  repo: () => import('./ui/repo-mode.js').then((m) => m.mountRepoMode),
  merge: () => import('./ui/merge-mode.js').then((m) => m.mountMergeMode),
};

let current = null;
let token = 0;

async function select(mode) {
  const mine = ++token;
  const localBtn = document.getElementById('nav-local');
  const moreNav = document.getElementById('nav-more');
  if (mode === 'local') { localBtn.setAttribute('aria-current', 'page'); moreNav.removeAttribute('aria-current'); }
  else { moreNav.setAttribute('aria-current', 'page'); localBtn.removeAttribute('aria-current'); }
  current?.unmount?.();
  current = null;
  modeRoot.replaceChildren();
  shell.clearStatus();
  try {
    const mount = await MODES[mode]();
    if (mine !== token) return;
    current = mount(modeRoot, shell);
  } catch (err) {
    shell.showError(err.message);
  }
}

// "More" menu
const moreBtn = document.getElementById('nav-more');
const moreMenu = document.getElementById('more-menu');
function toggleMenu(open) {
  moreMenu.hidden = !open;
  moreBtn.setAttribute('aria-expanded', String(open));
  if (open) moreMenu.querySelector('button').focus();
}
moreBtn.addEventListener('click', () => toggleMenu(moreMenu.hidden));
document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) toggleMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !moreMenu.hidden) { toggleMenu(false); moreBtn.focus(); } });
moreMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-mode]');
  if (item) { toggleMenu(false); select(item.dataset.mode); }
});
document.getElementById('nav-local').addEventListener('click', () => select('local'));

const requested = new URLSearchParams(location.search).get('mode');
select(requested in MODES ? requested : 'local');
