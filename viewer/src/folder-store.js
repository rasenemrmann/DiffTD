// Remember the last imported folder (its handle only, never file content) in IndexedDB so the next
// visit can offer "re-open" with one click. Every failure degrades to "nothing remembered".

const DB_NAME = 'opdiff';
const STORE = 'handles';
const KEY = 'lastFolder';

function open(idb = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!idb) { reject(new Error('IndexedDB unavailable')); return; }
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn, idb) {
  return open(idb).then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

/** { handle, name } or null. */
export async function loadFolder(idb) {
  try {
    return (await run('readonly', (s) => s.get(KEY), idb)) ?? null;
  } catch {
    return null;
  }
}

export async function saveFolder(handle, idb) {
  try {
    await run('readwrite', (s) => s.put({ handle, name: handle.name }, KEY), idb);
    return true;
  } catch {
    return false;
  }
}

export async function forgetFolder(idb) {
  try {
    await run('readwrite', (s) => s.delete(KEY), idb);
  } catch {
    // nothing to forget
  }
}

/** Ask the browser for read access again (needs a user gesture). */
export async function ensurePermission(handle) {
  try {
    if ((await handle.queryPermission?.({ mode: 'read' })) === 'granted') return true;
    return (await handle.requestPermission?.({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}
