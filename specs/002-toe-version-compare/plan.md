# Plan: Compare TouchDesigner Project Versions

Spec: [spec.md](spec.md). Builds on feature 001 (snapshot schema, diff, viewer). Constitution v1.1.0 (local helper allowed, localhost only).

## Approach

- `difftd/toe.py`: runs TouchDesigner's `toeexpand` (found automatically, override with `DIFFTD_TOEEXPAND`) on a temporary copy of the file and converts the expanded text files to the existing snapshot format. One snapshot per top-level node (`local` and `perform` skipped).
- `difftd/server.py` + `difftd/cli.py`: `python3 -m difftd serve <folder>` (localhost only) serves the viewer and three JSON endpoints (`/api/info`, `/api/versions`, `/api/snapshot`); conversion cached per path, mtime and size. `python3 -m difftd convert <file>` writes one snapshot for the viewer's "Two files" mode.
- Viewer: new mode "My .toe versions" (`viewer/src/ui/local-mode.js`), real node positions in the graph (`layout`), "moved" marker, fit-to-view.
- Schema: optional `nodes[].layout {x,y,w,h}`; diff never counts it as a change.

## Format findings (from real `toeexpand` output, TouchDesigner 2025 on macOS)

| File | Content |
|------|---------|
| `X.n` | `FAMILY:type` (→ `typeFAMILY`), `tile x y w h`, `flags`, `inputs { index source }`, `color`, `dock`, `end` |
| `X.parm` | `name flags value [expression]`, only non-default; with an expression the value is the last evaluated result and is dropped |
| `X.cparm` | custom parameter definitions (kept as `$cparm.<name>`) |
| `X.text` | `"2\n*"` + 5×uint32 BE + uint32 length + UTF-8 text |
| `X.table` | `"1\n*"` + uint32 version, rows, cols, 0, then per cell uint32 2, uint32 length, bytes |
| `X/` | children of a COMP |

`toeexpand` returns a non-zero exit code on success on this build, so success is judged by the output directory.

## Constitution Check

I (single schema): optional `layout` added to the one schema. II (deterministic): conversion output is canonicalized. III (text is truth): unchanged. IV (graceful failure): unreadable files give a message, others stay usable. V (review before import): nothing is written or imported by this feature. Technical constraints: amended to v1.1.0 (see constitution) for the localhost helper.

## Known limits

Parameter flags/modes beyond expression vs. constant are not interpreted (binds, exports appear as plain values or expressions); CHOP/SOP binary data (`.chop`, `.lod`, keyframes) is not compared; the Windows `toeexpand` path is untested.
