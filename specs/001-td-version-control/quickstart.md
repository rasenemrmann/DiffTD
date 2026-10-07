# Quickstart: Validating DiffTD End to End

Run these in order. Each step maps to a user story and has an expected outcome. Contracts: [snapshot schema](contracts/snapshot.schema.json), [reload endpoint](contracts/reload-endpoint.md), [git hooks](contracts/git-hooks.md), [config](contracts/config.md), [viewer modules](contracts/viewer-modules.md). Entities: [data-model.md](data-model.md).

## Prerequisites

- TouchDesigner 2023.11+ (Python 3.11), a test project folder initialized as a Git repo.
- Python 3.11+ with `pytest`, `jsonschema`; Node 20+; a Chromium-based browser.
- DiffTD checked out; `difftd/` on TD's Python path via the `DiffTD.tox` bootstrap.

## 0. Automated checks (no TD needed)

```sh
pytest tests/python
node --test tests/js
sh tests/hooks/run.sh
```

Expected: all pass. Covers schema validity of fixtures (Python and JS), canonical serialization equality between Python and JS, diff, merge, layout, hook behavior with a stub server.

## 1. Probe the TD API (resolves research R1)

In TD, run `difftd/td/probe.py` from a Text DAT. Expected: prints OK for each API item listed in research R1, or the exact failing item. Fix [research.md](research.md) R1/R2 with the findings before continuing.

## 2. Export on save — User Story 1 (SC-001/002/003)

1. Open the test project with two top-level COMPs; install hooks: `sh hooks/install.sh <project-repo>`.
2. Save. Expect `snapshots/<project>/<comp>.json` for each COMP.
3. Save again without changes. Expect `git status` shows no changes (byte-identical).
4. Change one parameter, save. Expect `git diff --stat` shows one file, one changed line.
5. Press the manual export pulse. Expect the same files, unchanged.
6. Make the target folder read-only and save. Expect the save succeeds and a TD message reports the export failure.

## 3. Round trip — User Story 2 (SC-004)

1. Copy a snapshot to a new empty project; call import on its container.
2. Re-export. Expect `diff` between original and new snapshot is empty.
3. Edit a snapshot to contain `"type": "fooCHOP"` and an unknown parameter name; import. Expect the rest imports and `.difftd/log.txt` lists both warnings.

## 4. Visual diff — User Story 3 (SC-006)

```sh
python3 -m http.server 8080   # from the repository root
```

Open `http://localhost:8080/viewer/`, choose "Two files", load `tests/fixtures/before.json` and `after.json`. Expect colored graph, click a changed node shows before/after parameters; load `tests/fixtures/malformed.json` expects a red error banner and no graph; `future-version.json` expects an "unsupported version" error.

## 5. Compare commits — User Story 4 (SC-005)

1. Make three commits in the test repo (add node, change parameter, change DAT text).
2. In the viewer choose "Git repository", grant access to the project folder, pick the first and last commit.
3. Expect the diff to show the added node and the changed parameter and DAT lines, within one minute and without any upload.

## 6. Automatic reload — User Story 5 (SC-007)

1. With TD running and the project open, `git checkout <older commit>`.
2. Expect the network to reflect that commit within 10 seconds.
3. Make an unsaved edit in a COMP, then checkout another commit. Expect a backup file under `.difftd/backups/` and a notification.
4. Close TD, checkout again. Expect the checkout succeeds and the hook prints "not reachable".

## 7. Merge review — User Story 6 (SC-008/009)

1. Create two branches: A edits `wave1.freq` and node `noise1.period`; B edits `wave1.freq` differently and `noise1.seed`. Merge B into A.
2. Open the viewer on the repo, choose "Resolve merge". Expect exactly one conflict (`wave1.freq`); `noise1.period` and `noise1.seed` are both kept automatically.
3. Resolve it, confirm "Write merged result", then confirm "Reload in TouchDesigner". Expect the network to show the chosen value, and that nothing was written or reloaded before each confirmation.
4. Repeat with branch A deleting `noise1` and branch B editing it. Expect a node-level keep/delete choice.

## Verification log (2026-10-03, implementation session)

Everything below was run **without TouchDesigner** (not running during implementation). Steps and criteria that need a live TD are listed as open at the end.

| Step / criterion | Result | Evidence |
|------------------|--------|----------|
| 0. Automated checks | PASS | `pytest` 110 passed, `npm test` 102 passed, `sh tests/hooks/run.sh` all passed |
| 2. Export (SC-002, SC-003, FR-005) against a fake TD | PASS | `tests/python/test_exporter.py`, `test_export_write.py` |
| 3. Round trip (SC-004) against a fake TD | PASS | `tests/python/test_roundtrip.py` (6 fixtures) |
| 4. Visual diff in Chromium | PASS | colors, node details, future-version error banner checked with Playwright |
| 5. Compare commits in Chromium (SC-005) | PASS | fixture repo loaded into the browser's private file system; diff of first vs last commit correct, new container shown as added; native folder picker needs one manual check |
| 6. Reload loop (SC-007) with real hooks + HTTP, fake TD | PASS | `tests/python/test_loop_integration.py`: checkout reloads, unsaved edit backed up, no TD → Git still succeeds |
| 7. Merge review (SC-008) in Chromium | PASS | one conflict shown, non-clashing edits to the same node merged, file untouched until "Write merged result", reload button enabled only after write |
| SC-001 export time | PASS (fake TD) | 500-node export + write well under 2 s in `test_perf_export.py`; real TD figure still needs measuring |
| SC-006 diff time | PASS | 1,000-node diff + layout ≈ 30 ms (`tests/js/perf.test.js`) |
| SC-009 conflict-resolution usability | NOT MEASURED | needs test participants |

Open (need a running TouchDesigner): step 1 probe (T020), 2/3/6/7 inside TD (T026, T032, T057, T064), `DiffTD.tox` bootstrap (T025) and its Web Server DAT wiring (T054), real-TD export time for SC-001, SC-007 timing, round-trip deviations (T031).
