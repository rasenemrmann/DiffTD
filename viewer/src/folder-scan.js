// List the project files in a directory handle (and one level of sub-folders).

const PROJECT_FILE = /\.(toe|tox)$/i;

export const isProjectFile = (name) => PROJECT_FILE.test(name);

/**
 * scanDirectory(dirHandle, { maxDepth = 1 }) -> [{ name, folder, handle, size, modified }]
 * `folder` is the name of the sub-folder, or the chosen folder's own name for files at its top level.
 * Hidden names are skipped; unreadable entries are ignored.
 */
export async function scanDirectory(dirHandle, { maxDepth = 1 } = {}) {
  const found = [];
  async function walk(dir, depth, folder) {
    for await (const handle of dir.values()) {
      if (handle.name.startsWith('.')) continue;
      if (handle.kind === 'file' && isProjectFile(handle.name)) {
        try {
          const file = await handle.getFile();
          found.push({ name: handle.name, folder, handle, size: file.size, modified: file.lastModified });
        } catch {
          // file vanished or is unreadable: skip it
        }
      } else if (handle.kind === 'directory' && depth < maxDepth) {
        await walk(handle, depth + 1, handle.name);
      }
    }
  }
  await walk(dirHandle, 0, dirHandle.name);
  return found;
}

/** Files from a drop event, expanding dropped folders where the browser allows it. */
export async function filesFromDrop(dataTransfer) {
  const out = [];
  const readEntry = (entry, folder, depth) => new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => { if (isProjectFile(file.name)) out.push({ file, name: file.name, folder }); resolve(); }, () => resolve());
    } else if (entry.isDirectory && depth <= 1) {
      const reader = entry.createReader();
      const all = [];
      const pump = () => reader.readEntries(async (batch) => {
        if (!batch.length) {
          await Promise.all(all.map((e) => readEntry(e, entry.name, depth + 1)));
          resolve();
        } else {
          all.push(...batch);
          pump();
        }
      }, () => resolve());
      pump();
    } else {
      resolve();
    }
  });
  const items = [...(dataTransfer.items ?? [])];
  if (items.length && typeof items[0].webkitGetAsEntry === 'function') {
    const entries = items.map((i) => i.webkitGetAsEntry()).filter(Boolean);
    await Promise.all(entries.map((e) => readEntry(e, '', 0)));
  } else {
    for (const file of dataTransfer.files ?? []) if (isProjectFile(file.name)) out.push({ file, name: file.name, folder: '' });
  }
  return out;
}
