# Tasks: Compare TouchDesigner Project Versions

- [X] T001 Decode the `toeexpand` output format from a real project and record it in `plan.md`
- [X] T002 Add optional `layout` to `schema/snapshot.schema.json` (and the contract copy); document in `specs/001-td-version-control/data-model.md`
- [X] T003 Implement `difftd/toe.py` (locate and run `toeexpand`, parse `.n/.parm/.cparm/.text/.table`, build snapshots) and run it against a real project
- [X] T004 [P] Write `tests/python/toe_helpers.py` and `tests/python/test_toe.py` (format readers, whole project, errors, fake `toeexpand`)
- [X] T005 Implement `difftd/server.py` (versions list, cached conversion, path and host protection, static viewer) and `difftd/cli.py` / `difftd/__main__.py` (`serve`, `convert`)
- [X] T006 [P] Write `tests/python/test_server.py` (listing, conversion, cache, refused paths, foreign host, static scope, CLI)
- [X] T007 Show real node positions, moved marker and fit-to-view in `viewer/src/ui/graph.js`, `diff-view.js`, `node-detail.js`; `moved`/`layout` in `viewer/src/diff.js`
- [X] T008 Add `viewer/src/ui/local-mode.js`, make it the default tab in `viewer/index.html` and `viewer/src/app.js`
- [X] T009 [P] Extend `tests/js/diff.test.js` for layout/moved
- [X] T010 Amend constitution to v1.1.0 (optional localhost helper)
- [X] T011 Verify end to end in Chromium with three versions of a real project made with `toecollapse` (changed parameter, added node, moved node): exactly these three shown
- [ ] T012 Larger real project and Windows path of `toeexpand` (`.tox` works: tested on a TouchDesigner palette component; a larger real project and a Windows machine are still missing)
- [ ] T013 Add an indicator in the version list for which pairs differ, and a "compare with previous version" shortcut (nice to have)
