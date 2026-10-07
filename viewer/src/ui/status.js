// Reserved status bar, toasts and the helper pill. Messages never move other content: the bar and the
// toast region have fixed room in the layout (contracts/ui-states.md, layout invariants 1 and 2).

import { t } from '../i18n.js';

export function createShell({ statusbar, toastRegion, pill }) {
  let toastTimer = new Map();

  function setStatus(text, kind = 'info') {
    statusbar.textContent = text ?? '';
    statusbar.dataset.kind = text ? kind : '';
    statusbar.title = text ?? '';
  }

  function clearStatus() {
    setStatus('');
  }

  function toast(text, kind = 'info', ms = 7000) {
    const node = document.createElement('div');
    node.className = 'toast';
    node.dataset.kind = kind;
    node.textContent = text;
    toastRegion.append(node);
    const remove = () => { node.remove(); toastTimer.delete(node); };
    toastTimer.set(node, setTimeout(remove, ms));
    node.addEventListener('click', () => { clearTimeout(toastTimer.get(node)); remove(); });
  }

  function setHelper(state) {
    pill.dataset.state = state;
    const key = state === 'up' ? 'helper.connected' : state === 'down' ? 'helper.notConnected' : 'helper.checking';
    pill.querySelector('.pill-text').textContent = t(key);
  }

  return {
    setStatus,
    clearStatus,
    toast,
    setHelper,
    // compatibility with the older modes
    showError(message) { setStatus(message, 'error'); toast(message, 'error'); },
    showInfo(message) { setStatus(message, 'info'); },
    clearError() { clearStatus(); },
  };
}
