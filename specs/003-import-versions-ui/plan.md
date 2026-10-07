# Implementation Plan: Import Project Versions in the Page + Polished GUI

**Branch**: `003-import-versions-ui` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-import-versions-ui/spec.md`

## Summary

Two things, one change set. (1) The page gets its own way to bring versions in: **Import folder** (browser folder access) and **Add files / drag and drop**, with the helper accepting the file bytes for conversion, so the helper is started once with no folder. (2) The page is rebuilt as a calm application shell (sidebar with versions, one comparison area that shows exactly one state, a detail drawer, a status area that never moves things), de/en texts, consistent controls, keyboard and contrast care.

Approach stays what the project already uses: vanilla ES modules, no build step, no new runtime dependency. New pure modules (version list, state reducer, hashing, i18n) are unit-tested under Node; the visual result is verified in a real browser.

## Technical Context

**Language/Version**: Python 3.11 (helper, stdlib only); JavaScript ES2022 modules (viewer); CSS with custom properties (light/dark).

**Primary Dependencies**: none new. Existing: `isomorphic-git` bundle (Git modes), TouchDesigner's `toeexpand` (external, already required by feature 002).

**Storage**: Browser: IndexedDB for the remembered folder handle only. Helper: in-memory LRU of converted results (max 30), temporary directory during conversion, nothing persisted.

**Testing**: `pytest` for the helper (upload endpoint, limits, security headers, cache), `node --test` for pure UI logic, manual walk-through in a Chromium browser through the Playwright tools (see [quickstart.md](quickstart.md)); no browser test framework is added.

**Target Platform**: macOS/Windows desktop; Chromium-based browser for folder import, any modern browser for upload and viewing.

**Project Type**: Existing multi-part tool; this feature touches `difftd/server.py`, `difftd/cli.py`, `viewer/`.

**Performance Goals**: first comparison after import < 10 s for typical projects (conversion ≈ 0.5 s per file measured), repeat of the same pair < 1 s, UI interactions < 100 ms, no layout shift.

**Constraints**: files never leave the machine; upload endpoint only from the page's own origin; ≤ 200 MB per file; nothing stored by the helper after conversion; UI works without the helper for "Two files" mode.

**Scale/Scope**: up to ~50 versions listed; networks up to ~1,000 nodes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / constraint | Gate | Pre-research | Post-design |
|-----------|------|--------------|-------------|
| I. Single Snapshot Schema | Uploads return the existing snapshot format, no new format | PASS | PASS ([contracts/helper-api.md](contracts/helper-api.md) returns the same `roots` snapshots) |
| II. Deterministic Export | Conversion output is canonical | PASS (unchanged `toe.py`) | PASS |
| III. Text Is Source of Truth | Unaffected | PASS | PASS |
| IV. Graceful Failure | Damaged/unsupported/oversized files give a message and do not block others | PASS | PASS (per-version status, see data-model) |
| V. Review Before Import | Nothing is written or imported by this feature | PASS | PASS |
| Technical constraints (v1.1.0): helper localhost-only, serves only files below the chosen folder, viewer works without it | Accepting uploaded bytes is new | NEEDS AMENDMENT | **Amend constitution to 1.2.0** (task T001): the helper may also convert file bytes sent by the page from its own origin; it still reads no path outside a chosen folder, stores nothing after conversion, and the viewer keeps working without it |

No unjustified violation. Complexity Tracking: none.

## Project Structure

### Documentation (this feature)

```text
specs/003-import-versions-ui/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── helper-api.md
│   └── ui-states.md
├── checklists/requirements.md
└── tasks.md          # /speckit-tasks
```

### Source Code (changes)

```text
difftd/
├── server.py          # folder optional; POST /api/convert, GET /api/snapshot?sha256=; origin + header checks; LRU cache; size limit
└── cli.py             # `serve` folder argument optional

viewer/
├── index.html         # app shell (header, sidebar, main, drawer, status area)
└── src/
    ├── style.css      # rewritten: tokens, shell grid, controls, states, dark/light, reduced motion
    ├── i18n.js        # de/en string table + t()
    ├── versions.js    # pure: merge sources, dedupe by sha256, sort, filter, default pair
    ├── hash.js        # sha256 of a File/ArrayBuffer (SubtleCrypto)
    ├── state.js       # pure: view-state reducer (empty | loading | ready | identical | error | helper-missing)
    ├── helper-client.js   # fetch wrappers for /api/*, upload, health polling
    ├── folder-store.js    # IndexedDB: remembered folder handle, permission re-request
    └── ui/
        ├── local-mode.js      # rebuilt on top of the pieces above (Compare view)
        ├── version-list.js    # sidebar list, search, older/newer assignment, import/add buttons, drop zone
        ├── status.js          # reserved status area + toast
        ├── diff-view.js       # toolbar: fit changes / fit all, zoom; fills height
        ├── graph.js           # fit-to-changes, readable minimum scale
        └── (file-mode, repo-mode, merge-mode: restyled to the new shell, behavior unchanged)

tests/
├── python/test_upload.py      # new
└── js/{versions,state,i18n,hash}.test.js   # new
```

**Structure Decision**: Keep the three existing parts. Put every decision that is not DOM in small pure modules so it can be tested; keep DOM modules thin.

## Complexity Tracking

None.
