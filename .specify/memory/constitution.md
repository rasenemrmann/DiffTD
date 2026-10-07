<!--
Sync Impact Report
- Version change: 1.1.0 → 1.2.0 (2026-10-04: the helper may also convert file bytes sent by the page)
  (earlier: 1.0.0 → 1.1.0 (2026-10-03: native project files may be read through an optional local helper))
- Modified principles: none renamed. Technical Constraints: "opdiff MUST run without a backend" clarified
  to allow an optional localhost-only helper that converts .toe/.tox files; snapshot viewing, diff and merge
  stay backend-free.
- Added sections (1.0.0): Core Principles I–V, Technical Constraints, Development Workflow, Governance
- Removed sections: none
- Templates reviewed:
  - ✅ .specify/templates/plan-template.md (generic "Constitution Check" gate; no edit needed)
  - ✅ .specify/templates/spec-template.md (no constitution references; no edit needed)
  - ✅ .specify/templates/tasks-template.md (no constitution references; no edit needed)
  - ✅ .specify/templates/checklist-template.md (no constitution references; no edit needed)
- Follow-up TODOs: none deferred. Open decisions from source plan (export trigger,
  snapshot granularity, .toe via Git LFS) are NOT fixed here; see Technical Constraints.
- Source: "TouchDesigner Versionskontrolle – Plan" (PDF, 2026-10-03)
-->
# DiffTD Constitution

DiffTD turns binary TouchDesigner networks (.toe/.tox) into text-based, versionable
snapshots and makes changes visually reviewable. It is a loop of five parts: Export,
Git, opdiff, Import, Reload.

## Core Principles

### I. Single Snapshot Schema
Exporter, Importer, and opdiff MUST share one JSON snapshot format. Required fields:
`nodes[].path` (unique key), `nodes[].type`, `nodes[].params` (flat key-value of custom
parameters), and `connections[]` with `from`/`to`. `fromIndex`/`toIndex` are optional and
default to 0. Diff and merge MUST reference nodes only by `path`. Schema changes MUST be
made in one place and applied to all three components together.
Rationale: one contract keeps the three tools interoperable and independently testable.

### II. Deterministic, Diff-Stable Export
Exporting an unchanged network MUST produce byte-identical output. Nodes MUST be sorted by
`path`, JSON keys MUST be sorted, and output MUST be pretty-printed. Any export that
changes without a content change is a bug.
Rationale: unstable ordering produces noisy diffs and false merge conflicts.

### III. Text Is the Source of Truth
Git versions the JSON exports. The .toe is a build artifact; archiving it (e.g. Git LFS)
is optional and MUST NOT replace the JSON. The directory layout MUST mirror the TD network
hierarchy.
Rationale: only text can be diffed and merged meaningfully in Git.

### IV. Lossless Round-Trip, Graceful Failure
Import MUST recreate a network from a snapshot: create all nodes first, then connect
them. An unknown or uninstalled operator type MUST be skipped with a logged warning, never
abort the import. Unknown parameters MUST be skipped, not fail. Export → Import → Export
SHOULD yield an identical snapshot; deviations MUST be documented.
Rationale: checkout of old states and post-merge reload must be safe and predictable.

### V. Review Before Import
Merge conflicts MUST be resolved through a visible review step (opdiff) before a snapshot
is imported into a live TD instance. opdiff runs client-side in the browser and MUST show
nodes and connections by status (added, removed, changed, unchanged) with per-node
parameter diffs. opdiff MUST NOT mutate snapshots without explicit user action.
Rationale: the target user is a TD artist, not a Git expert; changes must be legible.

## Technical Constraints

- Export builds on TouchDesigner's built-in `TDJSON` module (`op.TDModules.mod.TDJSON`).
  Plan code samples are sketches; any TD Python API use MUST be verified against current
  TD documentation before adoption.
- Automatic reload after `git pull`/checkout/merge uses git hooks (`post-checkout`,
  `post-merge`) calling the running TD instance through its Web Server DAT.
- opdiff's diff and merge logic MUST run without a backend: static client-side files, JSON loaded locally.
  Reading native `.toe`/`.tox` files needs TouchDesigner's own `toeexpand`, which a browser cannot run, so an
  OPTIONAL local helper (`python3 -m difftd serve`) may convert them. It MUST bind to localhost only, read
  only files below a folder the user chose when it was started, and the viewer MUST keep working without it
  (file mode). It MAY also convert file bytes that the page sends to it from its own origin (upload/import in
  the page); such bytes MUST be limited in size, MUST be accepted only with the helper's request header and an
  allowed origin, and MUST NOT be stored after conversion.
- Open decisions, to be settled in a spec before dependent work starts: export trigger
  (every save vs. manual), snapshot granularity (per top-level COMP vs. per node), and
  whether .toe is archived via Git LFS.

## Development Workflow

- Phase order follows dependencies: (1) Exporter + save hook; (2) Reverse import;
  (3) Repo structure + granularity; (4) opdiff on real exports; (5) Git reload hooks;
  (6) Merge-conflict workflow. A phase MUST NOT start before its dependencies are done.
- Schema, determinism, and round-trip behavior MUST be covered by automated tests that
  run outside TD where possible (fixture JSON snapshots).
- Existing tools (TDJSON, TD-Network-Exporter, jsoner.tox, Embody, tox_diff) are reference
  points; reuse before reimplementing, and record why when diverging.
- Keep it simple: no feature beyond the plan without a spec.

## Governance

This constitution supersedes other project practices. Amendments require a written change
to this file, a version bump, and an updated Sync Impact Report; dependent templates MUST
be checked for consistency. Versioning is semantic: MAJOR for removed or redefined
principles, MINOR for new principles or materially expanded guidance, PATCH for
clarifications. Every plan's Constitution Check and every review MUST verify compliance;
deviations MUST be justified in the plan's Complexity Tracking.

**Version**: 1.2.0 | **Ratified**: 2026-10-03 | **Last Amended**: 2026-10-04
