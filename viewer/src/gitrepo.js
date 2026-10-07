// Read Git history (and write merge results) from a local repository.
// Browser: File System Access API + vendored isomorphic-git. Node tests inject node:fs.

const GIT_BUNDLE = new URL('../vendor/isomorphic-git/isomorphic-git.bundle.js', import.meta.url);

/** Load the vendored isomorphic-git bundle (browser only; includes a Buffer polyfill). */
export async function loadGit() {
  const mod = await import(GIT_BUNDLE.href);
  return mod.default;
}

// ---------------------------------------------------------------- File System Access fs adapter

const enoent = (path) => Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' });

function mapError(err, path) {
  if (err?.name === 'NotFoundError' || err?.name === 'TypeMismatchError') return enoent(path);
  return err;
}

const segments = (path) => path.split('/').filter(Boolean);

/** fs.promises-compatible adapter over a FileSystemDirectoryHandle (writes only if `write`). */
export function createFsaFs(rootHandle, { write = false } = {}) {
  async function dirHandle(parts, create = false) {
    let handle = rootHandle;
    for (const part of parts) handle = await handle.getDirectoryHandle(part, { create });
    return handle;
  }
  async function fileHandle(path, create = false) {
    const parts = segments(path);
    const name = parts.pop();
    return (await dirHandle(parts, create)).getFileHandle(name, { create });
  }
  const needWrite = () => {
    if (!write) throw new Error('This folder was opened read-only.');
  };

  const promises = {
    async readFile(path, opts) {
      try {
        const file = await (await fileHandle(path)).getFile();
        const encoding = typeof opts === 'string' ? opts : opts?.encoding;
        return encoding ? file.text() : new Uint8Array(await file.arrayBuffer());
      } catch (err) {
        throw mapError(err, path);
      }
    },
    async writeFile(path, data) {
      needWrite();
      const handle = await fileHandle(path, true);
      const stream = await handle.createWritable();
      await stream.write(data);
      await stream.close();
    },
    async unlink(path) {
      needWrite();
      const parts = segments(path);
      const name = parts.pop();
      try {
        await (await dirHandle(parts)).removeEntry(name);
      } catch (err) {
        throw mapError(err, path);
      }
    },
    async readdir(path) {
      try {
        const names = [];
        for await (const name of (await dirHandle(segments(path))).keys()) names.push(name);
        return names;
      } catch (err) {
        throw mapError(err, path);
      }
    },
    async mkdir(path) {
      needWrite();
      await dirHandle(segments(path), true);
    },
    async rmdir(path) {
      needWrite();
      const parts = segments(path);
      const name = parts.pop();
      await (await dirHandle(parts)).removeEntry(name);
    },
    async stat(path) {
      const parts = segments(path);
      const base = { dev: 0, ino: 0, uid: 0, gid: 0, ctimeMs: 0, mtimeMs: 0, mode: 0o100644, size: 0 };
      const stats = (isDir, extra = {}) => ({
        ...base,
        ...extra,
        mode: isDir ? 0o040000 : 0o100644,
        isFile: () => !isDir,
        isDirectory: () => isDir,
        isSymbolicLink: () => false,
      });
      if (parts.length === 0) return stats(true);
      try {
        const file = await (await fileHandle(path)).getFile();
        return stats(false, { size: file.size, mtimeMs: file.lastModified, ctimeMs: file.lastModified });
      } catch (fileErr) {
        try {
          await dirHandle(parts);
          return stats(true);
        } catch {
          throw mapError(fileErr, path);
        }
      }
    },
    async readlink(path) { throw enoent(path); },
    async symlink() { throw new Error('symlinks are not supported'); },
  };
  promises.lstat = promises.stat;
  return { promises };
}

// ---------------------------------------------------------------- repository access

const decoder = new TextDecoder();
const isMissing = (err) => err?.code === 'NotFoundError' || err?.code === 'ENOENT' || /not\s*found|could not find/i.test(err?.message ?? '');

/**
 * openRepoWithFs({ git, fs, dir, write }) -> Repo. `git` is isomorphic-git, `fs` a node-style fs
 * with `promises`, `dir` the working tree root.
 */
export function openRepoWithFs({ git, fs, dir = '/', write = false }) {
  const base = { fs, dir };
  return {
    async headOid() {
      return git.resolveRef({ ...base, ref: 'HEAD' });
    },
    async resolve(ref) {
      return git.resolveRef({ ...base, ref });
    },
    async currentBranch() {
      return (await git.currentBranch({ ...base })) ?? null;
    },
    async listBranches() {
      return git.listBranches(base);
    },
    async listCommits({ limit = 50, ref = 'HEAD' } = {}) {
      const entries = await git.log({ ...base, ref, depth: limit });
      return entries.map((e) => ({
        oid: e.oid,
        message: e.commit.message.split('\n')[0],
        author: e.commit.author.name,
        date: new Date(e.commit.author.timestamp * 1000),
      }));
    },
    async readSnapshotAt(oid, path) {
      try {
        const { blob } = await git.readBlob({ ...base, oid, filepath: path });
        return decoder.decode(blob);
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async listSnapshotsAt(oid, snapshotDir = 'snapshots') {
      const files = await git.listFiles({ ...base, ref: oid });
      return files.filter((f) => f.startsWith(`${snapshotDir}/`) && f.endsWith('.json')).sort();
    },
    async mergeBase(oidA, oidB) {
      const bases = await git.findMergeBase({ ...base, oids: [oidA, oidB] });
      return bases[0] ?? null;
    },
    async mergeHead() {
      try {
        const text = await fs.promises.readFile(`${dir === '/' ? '' : dir}/.git/MERGE_HEAD`, 'utf8');
        return text.trim() || null;
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async writeSnapshot(path, text) {
      if (!write) throw new Error('Repository was opened read-only; reopen with write access to save the merged result.');
      const parts = path.split('/');
      parts.pop();
      let acc = dir === '/' ? '' : dir;
      for (const part of parts) {
        acc += `/${part}`;
        try { await fs.promises.mkdir(acc); } catch (err) { if (err?.code !== 'EEXIST') throw err; }
      }
      await fs.promises.writeFile(`${dir === '/' ? '' : dir}/${path}`, text);
    },
  };
}

/** Browser entry point: dirHandle comes from window.showDirectoryPicker(). */
export async function openRepo(dirHandle, { write = false } = {}) {
  const git = await loadGit();
  return openRepoWithFs({ git, fs: createFsaFs(dirHandle, { write }), dir: '/', write });
}
