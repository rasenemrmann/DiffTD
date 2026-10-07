# opdiff viewer

Static app, no build step. Normally started through the helper, which also converts `.toe`/`.tox` files:

```sh
python3 -m difftd serve --open        # from the repository root
```

Without the helper, serve the repository root with any static file server (the viewer reads `schema/snapshot.schema.json` next to `viewer/`) and open `/viewer/`: only **More → Two snapshot files** and the Git modes work then.

- Texts: `src/i18n.js` (German/English, from the browser language). Colors and layout: `src/style.css` (tokens at the top: dark is the base, light is the `:root[data-theme="light"]` block). Appearance: `src/theme.js` (System / Light / Dark, remembered in `localStorage`) plus a small inline script in `index.html` that applies it before the first paint; a test keeps the two equal.
- Pure logic with tests in `tests/js`: `versions.js` (list, dedupe, sorting), `state.js` (what the comparison area shows), `hash.js`, `diff.js`, `merge.js`, `layout.js`.
- Browser-only modules: `ui/*`, `gitrepo.js`, `folder-store.js`, `reload-client.js`.
- Vendored: `vendor/isomorphic-git` (see `vendor/README.md`).
