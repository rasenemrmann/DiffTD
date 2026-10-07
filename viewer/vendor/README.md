# Vendored dependencies

| Package | Version | File | License |
|---------|---------|------|---------|
| isomorphic-git | 1.42.6 | `isomorphic-git/isomorphic-git.bundle.js` (single ESM bundle with `buffer` polyfill) | MIT (`isomorphic-git/LICENSE.md`) |

The bundle is generated, not hand-edited: `sh viewer/vendor/build.sh` (uses `esbuild` from devDependencies and `entry.js`).
The browser needs the polyfill because isomorphic-git uses the global `Buffer`; the plain UMD build does not provide it.
The same isomorphic-git version is a devDependency so the Node tests exercise the same library code.
To update: bump the version in `package.json`, `npm install`, run `build.sh`, update the table above, run `npm test`.
