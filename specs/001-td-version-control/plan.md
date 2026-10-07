# Implementation Plan: TouchDesigner Version Control (DiffTD)

**Branch**: `001-td-version-control` | **Date**: 2026-10-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-td-version-control/spec.md`

## Summary

DiffTD is a loop of five parts around the TouchDesigner (TD) editor: **Export** writes the network as deterministic JSON snapshots on save, **Git** versions them, **opdiff** (browser viewer) shows visual diffs and resolves merge conflicts, **Import** rebuilds a network from snapshots, **Reload** is triggered by Git hooks through TD's Web Server DAT.

Approach: a stdlib-only Python package runs inside TD (export, import, reload orchestration); a no-build static web app (vanilla ES modules, SVG) is the viewer and merge tool; POSIX shell Git hooks call TD over localhost. One JSON Schema is the single source of the snapshot format for all three. Pure logic (serialization, diff, 3-way merge) is kept free of TD and DOM dependencies so it is tested outside TD with shared fixtures.

## Technical Context

**Language/Version**: Python 3.11 (TD's embedded interpreter; stdlib only inside TD). JavaScript ES2022 modules for the viewer (no build step). POSIX `sh` + `curl` for Git hooks.

**Primary Dependencies**: TD built-ins (`td`, `op`, `TDJSON` where verified). Viewer: `isomorphic-git` (vendored ESM) for reading Git objects through the File System Access API. Dev only: `pytest`, `jsonschema`, Node 20+ `node:test`.

**Storage**: Files. Snapshots in `<project>/snapshots/<project>/<topLevelComp>.json`; runtime state in `<project>/.difftd/` (last-export hashes, backups), git-ignored; settings in `difftd.config.json`.

**Testing**: `pytest` for the Python core against fixture snapshots and a fake TD node tree; `node --test` for diff/merge/layout/schema; shared fixtures in `tests/fixtures/`; manual and scripted TD validation per [quickstart.md](quickstart.md); hook tests against a throwaway Git repo and a stub HTTP server.

**Target Platform**: macOS and Windows desktops running TD (2023.11+ assumed, Python 3.11); Chromium-based browser for the viewer's commit mode.

**Project Type**: Multi-part tool: TD-side Python library + static web app + Git hook scripts.

**Performance Goals**: 500-node export adds ≤ 2 s to save (SC-001); two 1,000-node snapshots diffed and rendered ≤ 5 s (SC-006); reload visible ≤ 10 s after Git operation (SC-007).

**Constraints**: Byte-identical re-export (SC-002); one changed parameter = one changed line (SC-003); viewer is serverless; export failure never blocks save; no timestamp or other volatile data inside snapshot files.

**Scale/Scope**: Projects up to a few thousand nodes; tens of top-level COMPs; two to a few artists collaborating on one repository.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Pre-research | Post-design |
|-----------|------|--------------|-------------|
| I. Single Snapshot Schema | One schema file consumed by exporter, importer, viewer | PASS (planned `schema/snapshot.schema.json`) | PASS ([contracts/snapshot.schema.json](contracts/snapshot.schema.json), validated in Python and JS tests with shared fixtures) |
| II. Deterministic Export | Sorted nodes/keys, stable formatting, no volatile fields | PASS | PASS: `meta.exported` timestamp from the source plan **dropped** (see research R3); canonical serializer specified |
| III. Text Is Source of Truth | JSON in Git, `.toe` optional, directory mirrors hierarchy | PASS | PASS (`snapshots/` tree; `.toe` not required) |
| IV. Lossless Round-Trip, Graceful Failure | Nodes before connections; skip unknown types/params with warning | PASS | PASS (import algorithm in data-model; round-trip test SC-004) |
| V. Review Before Import | Conflicts reviewed in opdiff; no auto-import of merged result; viewer never mutates silently | PASS | PASS (explicit confirm gate before write and before reload request) |
| Technical Constraints | TD API use verified against docs; viewer backend-free | PASS with condition | PASS with open verification item R1 (TD was not running during planning; TD-API calls are isolated in one adapter and verified first in quickstart step 1) |

No violations. Complexity Tracking: none required (two implementation languages are dictated by the platforms — TD is Python, browser is JavaScript — not a discretionary extra layer).

## Project Structure

### Documentation (this feature)

```text
specs/001-td-version-control/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── snapshot.schema.json
│   ├── reload-endpoint.md
│   ├── git-hooks.md
│   ├── config.md
│   └── viewer-modules.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
schema/
└── snapshot.schema.json        # single source of truth, copied from contracts at implementation

difftd/                         # TD-side Python package (stdlib only)
├── snapshot.py                 # pure: model, canonical serialize/parse, validate, path→file mapping
├── exporter.py                 # TD adapter: network → Snapshot (only module reading live TD state)
├── importer.py                 # Snapshot → network (only module creating TD operators)
├── reload.py                   # unsaved-edit detection, backup, per-container rebuild
├── config.py                   # load difftd.config.json
└── td/
    ├── execute_callbacks.py    # onProjectPostSave → export
    └── webserver_callbacks.py  # POST /reload, GET /health

hooks/
├── post-checkout
├── post-merge
├── post-rewrite
└── install.sh                  # installs hooks into a project repo

viewer/                         # static app, no build
├── index.html
├── src/
│   ├── schema.js               # validate against schema/snapshot.schema.json
│   ├── diff.js                 # snapshot × snapshot → DiffResult (pure)
│   ├── merge.js                # base/ours/theirs → MergeResult with conflicts (pure)
│   ├── layout.js               # topological layering (pure)
│   ├── gitrepo.js              # File System Access + isomorphic-git: commits, blobs, merge-base
│   ├── reload-client.js        # POST to TD reload endpoint after confirmation
│   └── ui/                     # graph SVG, node detail, commit picker, conflict review
└── vendor/isomorphic-git/

tests/
├── fixtures/                   # shared snapshots: simple, nested, dat, conflicts, malformed, future-version
├── python/
├── js/
└── hooks/

.gitignore                      # includes .difftd/
```

**Structure Decision**: Three top-level parts (`difftd/`, `viewer/`, `hooks/`) matching the three runtime environments, sharing only `schema/` and `tests/fixtures/`. TD-touching code is confined to `exporter.py`, `importer.py`, `td/`; everything else is pure and testable without TD.

## Complexity Tracking

No constitution violations to justify.
