# Research: TouchDesigner Version Control (DiffTD)

TD was not running during planning (MCP connection refused on port 9981), so TD API facts below come from the source plan and prior knowledge and are marked **VERIFY** where they must be confirmed against a live TD before implementation. No NEEDS CLARIFICATION markers remain; open verification items are tracked as R1.

## R1. TD API surface for export/import — VERIFY first

- **Decision**: Isolate all live-TD calls in `exporter.py` / `importer.py`. First implementation task is a probe script run in TD that confirms: `COMP.findChildren`, `OP.pars()` with `.val/.expr/.mode/.bindExpr/.default`, `OP.OPType`, `OP.inputConnectors` / `.outputConnectors` and `Connector.connections`, `COMP.create(type, name)`, `Connector.connect()`, `DAT.text`, `tableDAT.rows()`, `Par.default`, and the `Execute DAT` callback `onProjectPostSave`. Also whether `TDJSON.opToJSONOp` can emit all parameters including defaults.
- **Rationale**: The source plan marks its code as a sketch "not tested against the current TD Python API". Constitution requires verification before adoption.
- **Alternatives**: Trusting the sketch (rejected: constitution).

## R2. Parameter capture: direct iteration, not TDJSON output

- **Decision**: Read every parameter via `op.pars()` and store value (and expression/bind info). Use `TDJSON` only if verification shows it can emit full parameter sets deterministically; otherwise record the divergence here.
- **Rationale**: Clarification Q1 requires all parameters with all values, including defaults. `TDJSON.opToJSONOp` is designed for re-creating operators and by default omits default-valued parameters (VERIFY). Direct iteration gives full control over ordering and formatting (Principle II).
- **Alternatives**: TDJSON output post-processed (fragile ordering, extra defaults lookup); TD-Network-Exporter / jsoner.tox (not byte-stable by design).

## R3. Snapshot format details

- **Decision**: JSON, UTF-8, LF, 2-space indent, sorted keys, nodes sorted by `path`, connections sorted by (`to`, `toIndex`, `from`, `fromIndex`), trailing newline. `meta` holds `format_version`, `project`, `root` only. **No export timestamp.** Constants stay numbers, strings stay strings; floats use shortest round-trip repr. Expression/bind parameters stored as objects (`{"expr": "..."}`, `{"bind": "..."}`).
- **Rationale**: The source plan's `meta.exported` timestamp makes every export differ (violates SC-002 and Principle II); Git commit metadata already carries time. Arrays of lines/cells and one parameter per line give SC-003 (one change = one line) and let Git's line merge handle disjoint edits.
- **Alternatives**: Keep timestamp (rejected); one file per node (rejected by Q-free default: granularity is per top-level COMP, spec Assumptions); minified single-line JSON (breaks line diffs).

## R4. DAT content

- **Decision**: Capture `textDAT` as `{"kind":"text","lines":[...]}` and `tableDAT` as `{"kind":"table","rows":[[...]]}`. Other DAT types are exported with parameters only.
- **Rationale**: Clarification Q5 (text and table). Line arrays make Git and the viewer diff line-based. Content of computed DATs (outputs of other operators) is derived data and is excluded.
- **Alternatives**: Single string with `\n` (poor diffs); all DATs (rejected by Q5).

## R5. Save hook

- **Decision**: An Execute DAT inside the DiffTD component, `onProjectPostSave` calls export for each top-level COMP; writes are atomic (temp file + rename) and wrapped so any exception is logged and surfaced as a TD message, never raised. Manual export: a custom-parameter pulse on the DiffTD component.
- **Rationale**: FR-004/FR-005; PostSave keeps the save itself unblocked. VERIFY callback name in Execute DAT (source plan mentions `onProjectPreSave/PostSave`).
- **Alternatives**: PreSave (delays save, risks blocking); file watcher (does not see unsaved state).

## R6. Distribution inside TD

- **Decision**: Ship the Python package as files plus a small `DiffTD.tox` bootstrap (Execute DAT, Web Server DAT, parameters for config path) that adds the package folder to `sys.path`. Inspired by Embody's externalization pattern.
- **Rationale**: Keeps code in Git and testable; the `.tox` is only glue.
- **Alternatives**: All code embedded in the `.tox` (binary, undiffable — contradicts Principle III).

## R7. Import / rebuild strategy

- **Decision**: Rebuild a top-level COMP by: (1) detecting unsaved edits (R8), (2) clearing its children, (3) creating all nodes in path-depth order, (4) setting parameters (skip unknown with warning), (5) setting DAT content, (6) connecting. Unknown `type` → skip node plus its connections, log warning.
- **Rationale**: Principle IV and FR-007/008; simplest correct behavior. Fine-grained in-place patching is a later optimization.
- **Alternatives**: In-place patch per diff (more complex, risk of drift).

## R8. Detecting unsaved edits before reload

- **Decision**: After each export, store a content hash per top-level COMP in `.difftd/last-export.json`. On reload, export the live COMP to memory and compare its hash; if different, the live state has edits not reflected in the last export → write backup to `.difftd/backups/<UTC timestamp>/<comp>.json` and report it.
- **Rationale**: FR-016 without needing TD to expose a per-COMP dirty flag.
- **Alternatives**: `project.modified`-style flag (project-wide, not per container; VERIFY availability); skipping the check (data loss).

## R9. Reload trigger from Git

- **Decision**: `post-checkout`, `post-merge` and `post-rewrite` hooks (POSIX sh) compute changed snapshot files and `curl` a POST to the Web Server DAT. A failed connection prints a notice and exits 0.
- **Rationale**: `git pull` is merge or rebase, so `post-merge` plus `post-rewrite` cover it; `post-checkout` covers branch switches. FR-015 requires Git never fails because TD is absent. `curl` ships with macOS and Windows 10+.
- **Alternatives**: Python hook (needs interpreter on PATH); file watcher in TD (extra moving part, noisy mid-operation).

## R10. Viewer: reading Git in the browser

- **Decision**: File System Access API (`showDirectoryPicker`, read-only by default; read-write only requested when the user starts writing a merge result). Git objects via vendored `isomorphic-git` with a thin fs adapter over `FileSystemDirectoryHandle`. **Implementation finding:** the library's plain UMD build fails in the browser (it needs a global `Buffer`, errors are swallowed and objects appear "not found"), so the vendored file is an esbuild ESM bundle that includes the `buffer` polyfill (`viewer/vendor/build.sh`). The viewer must be served from the repository root because it reads `schema/snapshot.schema.json`. Provides log, blob read at commit, and merge-base.
- **Rationale**: Clarification Q2 (local folder, serverless, Chromium only). Parsing loose and packed objects ourselves is a large, error-prone task.
- **Alternatives**: Local helper server (rejected by Q2); hosted Git API (rejected by Q2). Fallback for other browsers: two-file upload mode, as in the prototype.

## R11. Merge algorithm

- **Decision**: Semantic 3-way merge in `merge.js` on parsed snapshots, keyed by node `path` → parameter name / connection tuple / DAT content. Per key: if only one side changed take it; if both changed to the same value take it; if both changed differently → conflict. Node add/remove vs edit → conflict at node level (edit-vs-delete). DAT content is merged by line hunks (diff3), conflicting hunks become conflicts. Inputs: base = merge-base commit, ours = HEAD, theirs = `MERGE_HEAD` or a user-chosen branch.
- **Implementation note**: connection clashes are reported as node conflicts. Connections merge as sets; a connection added to a node the other side deleted (or edited) makes that node an edit-vs-delete conflict, resolved with keep/delete, and the kept side's wiring is used. There is no separate connection-level conflict.
- **Rationale**: Clarification Q4. Working from commits avoids parsing Git conflict markers and does not depend on Git's textual result. Git may still leave a textually conflicted file; the viewer's output overwrites it only after confirmation.
- **Alternatives**: Parse conflict markers (lossy); custom Git merge driver (needs a runtime on every machine, can't present a visual review).

## R12. Layout

- **Decision**: Topological layering (longest-path layers over connections, cycles broken by DFS back-edge removal), nodes ordered within layers by barycenter; SVG rendering; unchanged nodes collapsible.
- **Rationale**: The plan specifies topological layering; SVG keeps it dependency-free and fast enough for 1,000 nodes.
- **Alternatives**: dagre/elk (extra dependency, not needed for v1); canvas (harder click/hover handling).

## R13. Web Server DAT and browser access

- **Decision**: The Web Server DAT binds to 127.0.0.1 on a configured port, accepts `POST /reload` and `GET /health`, and sets CORS headers allowing only the viewer's origin(s) listed in config (VERIFY header support in callbacks). No authentication beyond localhost binding; reload only reads snapshot files from the configured directory and never accepts file contents or paths from the caller.
- **Rationale**: Hooks and (after confirmation) the viewer both need to trigger reload; the endpoint must not become a code-execution surface.
- **Alternatives**: Open on all interfaces (rejected); file-drop signalling (slower, race-prone).

## R14. Prototype status

- **Decision**: The spec assumes an existing opdiff prototype; none is present in this repository. Treat it as an external input: if provided, port its rendering ideas into `viewer/src/ui`; otherwise implement from the contracts.
- **Rationale**: Avoid blocking on an unavailable artifact.
- **Alternatives**: Wait for the file (no value).

## R15. Known gaps found during implementation (to confirm in TD, task T031)

- COMP-to-COMP (top) connectors (`inputCOMPConnectors`) are not exported or restored; only data connectors are.
- Parameter export mode is recorded (`{"export": ...}`) but not restored on import.
- Sequence parameters (names that only exist after a block count is set) may need ordered setting on import; the importer sets parameters in sorted order without special handling.
- The Execute DAT callback names, `Par.mode` stringification, `Par.exportSource`, `Connector.index/owner/connections` and the Web Server DAT request/response keys are unverified (probe, T019/T020).
