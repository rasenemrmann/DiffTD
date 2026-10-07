# Quickstart: Validating Import + Polished GUI

Prerequisites: Python 3.11, Node 20+, TouchDesigner installed (for `toeexpand`), a Chromium-based browser, a folder with a few `.toe` versions (for example `td-rnd-main/analog/td-modulation`). Contracts: [helper-api.md](contracts/helper-api.md), [ui-states.md](contracts/ui-states.md).

## 0. Automated

```sh
pytest && npm test && sh tests/hooks/run.sh
```

Expected: all pass, including `tests/python/test_upload.py` and `tests/js/{versions,state,i18n,hash}.test.js`.

## 1. Start without a folder (US3)

```sh
python3 -m difftd serve --open
```

Expected: page opens in the "empty" state with the drop zone; the header shows "Connected". No folder was typed anywhere.

## 2. Import a folder (US1, SC-001)

Press "Import folder", choose the versions folder. Expected: versions listed newest first; the two newest are the default pair; the comparison appears within 30 s of the first click. Save a new version into the folder, press "Refresh": it appears without re-importing. Reload the page: "Re-open <folder>" is offered.

## 3. Add files (US2, SC-002, SC-003)

Press "Add files" and pick two `.toe` files from different places; or drop them. Expected: they join the list. Add one of them again: no duplicate (SC-003). Add a text file renamed to `.toe`: a message names the file, other versions keep working.

## 4. Walk through the states (US4, SC-006, SC-007)

For each row of the state table in [ui-states.md](contracts/ui-states.md): produce the state and check the invariants.

1. `empty`: fresh start.
2. `loading`: add a large file; the previous result is gone or marked outdated, progress shown in place.
3. `helper-missing`: stop the helper (Ctrl+C), press "Try again". Expected: the start command is shown, **no stale list or graph remains next to it**, controls did not move.
4. `error`: damaged file.
5. `identical`: compare a version with itself.
6. `ready` with a wide network: text is readable after "Fit changes".
7. Resize to ~1000 px and ~400 px wide: nothing cut off; drawer becomes slide-over.
8. Switch system appearance light/dark: all text readable, statuses distinguishable without color.
9. Keyboard only: Tab through all controls, select versions, open a node, close the drawer.

Record screenshots and results in the verification log below when run.

## 5. Security checks (helper)

```sh
curl -i -X POST "http://127.0.0.1:8765/api/convert?sha256=00&name=x.toe" --data-binary @file.toe   # 403: no X-DiffTD header
curl -i -H "Host: evil.example" http://127.0.0.1:8765/api/info                                      # 403
```

Expected: refused. After a normal conversion, no `difftd-*` temp directory remains.

## Verification log

(To be filled in when the walk-through is executed.)

### Run on 2026-10-04 (Chromium via the Playwright tools, TouchDesigner's `toeexpand` real, projects: `td-rnd-main/analog/td-modulation` plus variants made with `toecollapse`)

| Step | Result |
|------|--------|
| 0 Automated | PASS: `pytest` 167, `npm test` 149, `sh tests/hooks/run.sh` all passed; tests leave no temp directories behind |
| 1 Start without a folder | PASS: `python3 -m difftd serve` (no folder) → empty state with drop zone, pill "Verbunden" |
| 2 Import a folder (SC-001) | PASS through the same code path with a folder in the browser's private file system (top level + one sub-folder read, `notes.txt` ignored, "Imported from …" note). The native picker was not clicked (cannot be scripted). Re-open/permission flow not exercised |
| 3 Add files (SC-002, SC-003) | PASS: file chooser with 3 files (two byte-identical) → 2 entries; repeated import and helper-folder + imported copies merged (7 → 4 entries, origins merged); a text file renamed `.toe` → row error naming the file, other versions unaffected. Drag and drop is implemented but was not exercised in a real browser |
| 4 States (SC-006, SC-007) | PASS for: empty, loading (skeleton), ready, identical (re-saved copy with different timestamp), error (damaged file, readable cause), helper stopped (graph, counts and drawer gone, start command shown; header and toolbar positions unchanged: 76 → 76 px, 157 → 157 px) and automatic recovery after restart. Narrow widths 820 px and 400 px: no horizontal scroll, drawer becomes slide-over. Light and dark: contrast computed from the tokens, all text ≥ 4.5:1 and borders/markers ≥ 3:1 after fixing two light-mode values. Keyboard: Tab to the menu, Enter opens, focus moves into it, Escape closes and returns focus. Not exercised: full keyboard path through the version list and graph |
| 5 Security | PASS (curl against a running helper): no header 403, foreign Host 403, foreign Origin 403, wrong hash 400, `.txt` name 415, 300 MB claim 413, path traversal 403, valid upload 200 |
| Secondary modes | File mode (two snapshot files) and Merge review verified in the new shell (one conflict, write only on click, reload enabled only after writing, file untouched before the click). Git history mode compiles and uses the same shell; not re-run in the browser after the restyle |

Findings fixed during the run: stale network selector shown with the "helper missing" panel; changed nodes hidden under overlapping unchanged nodes (z-order); "Fit changes" too tight on a single changed node (now includes direct neighbours); duplicate status text; light-mode contrast; leftover temp directories from tests.
