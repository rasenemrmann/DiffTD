# Data Model: TouchDesigner Version Control (DiffTD)

Formal schema: [contracts/snapshot.schema.json](contracts/snapshot.schema.json). This file explains entities, rules and state transitions.

## Snapshot (one file per top-level COMP)

| Field | Type | Rule |
|-------|------|------|
| `meta.format_version` | integer | Required. Current = 1. Higher than supported → reject (FR-014, edge case). |
| `meta.project` | string | Project name (the TD project the COMP belongs to). |
| `meta.root` | string | Absolute TD path of the top-level COMP, e.g. `/project1/geo1`. Must equal the `path` of the first node. |
| `nodes` | Node[] | Sorted by `path` (byte order). Includes the root COMP itself and all descendants. |
| `connections` | Connection[] | Sorted by (`to`, `toIndex`, `from`, `fromIndex`). |

File location: `snapshots/<project>/<rootName>.json`. No timestamps or other volatile fields (Principle II).

## Node

| Field | Type | Rule |
|-------|------|------|
| `path` | string | Unique key in the snapshot; the identity used by diff and merge. Absolute TD path. |
| `name` | string | Last path segment (redundant but required by the shared format). |
| `type` | string | TD operator type, e.g. `waveCHOP`. Family derived from the suffix in the viewer. |
| `params` | object | Parameter name → ParamValue. Contains **every** parameter, including defaults (Clarification Q1). Keys sorted. |
| `content` | DatContent | Optional. Present only for text and table DATs (Clarification Q5). |

## ParamValue

- Constant mode: a JSON number, string or boolean.
- Expression mode: `{"expr": "<python expression>"}`.
- Bind mode: `{"bind": "<bind expression>"}`.
- Export mode (parameter driven by a CHOP export): `{"export": "<source path>"}`; informational, restored by recreating the export only if the source exists.

Multi-component parameters (e.g. `tx`/`ty`/`tz`) are stored as separate names, as TD exposes them.

## DatContent

- Text DAT: `{"kind": "text", "lines": ["...", "..."]}`; lines split on `\n`, no trailing newline element unless the text ends with an empty line.
- Table DAT: `{"kind": "table", "rows": [["a","b"],["1","2"]]}`; all cells as strings.

## Connection

| Field | Type | Rule |
|-------|------|------|
| `from` | string | Path of the source node; must exist in `nodes`. |
| `to` | string | Path of the destination node; must exist in `nodes`. |
| `fromIndex` | integer | Optional, default 0. Omitted when 0 to keep files short. |
| `toIndex` | integer | Optional, default 0. Omitted when 0. |

Connections whose endpoints lie outside the snapshot's root COMP are not recorded.

## Diff Result (viewer, in memory)

- `nodes`: map `path → { status: added|removed|changed|unchanged, type, paramChanges[], contentDiff? }`
- `paramChanges[]`: `{ name, status: added|removed|changed, before, after }`
- `connections`: list of `{ key, status }` where key = (from, fromIndex, to, toIndex)
- `contentDiff`: line hunks for text; per-cell changes for tables.
- Renamed or moved nodes are `removed` plus `added` (identity is the path).

## Conflict / Merge Result (viewer, in memory)

- `MergeResult`: `{ merged: Snapshot, conflicts: Conflict[] }`; `merged` holds every non-conflicting change already applied.
- `Conflict`: `{ id, kind: param|node|content, key, base, ours, theirs, resolution: null|ours|theirs|deleted|kept }`
- Rules:
  - Only one side changed → take that side (no conflict).
  - Both sides made the identical change → take it.
  - Both changed the same parameter differently → `param` conflict.
  - One side removed a node, the other changed any of its parameters/content → `node` conflict (keep edited vs delete).
  - Both sides added the same path with different content → `node` conflict.
  - A connection added or removed on one side at a node the other side deleted → the same `node` conflict (connections merge as sets; there is no separate connection-level conflict).
  - Text content: diff3 hunks; overlapping differing hunks → `content` conflict.
- Merge is complete when all `resolution` fields are non-null; only then can the confirm action be enabled (FR-018).

## Runtime state (TD side, `.difftd/`, git-ignored)

| File | Content |
|------|---------|
| `last-export.json` | `{ "<rootPath>": "<sha256 of snapshot bytes>" }`, updated on each successful export. |
| `backups/<UTC timestamp>/<rootName>.json` | Snapshots of live state saved before an overwriting reload (FR-016). |
| `log.txt` | Warnings: skipped types/params, export failures. |

## State transitions

```
Export:  live network ──serialize──▶ bytes ──compare to existing──▶ (changed? atomic write) ──▶ update last-export hash
                                      └─ error ─▶ log + TD message; existing files untouched

Reload:  request(files) ─▶ for each root COMP:
           live export hash == last-export hash? ── no ─▶ write backup, notify
           clear children ─▶ create nodes ─▶ set params/content ─▶ connect ─▶ update last-export hash
           unknown type/param ─▶ warn, skip, continue

Merge:   (base, ours, theirs) ─▶ MergeResult ─▶ user resolves ─▶ confirm ─▶ write snapshot file(s) ─▶ confirm again ─▶ reload request
```

## Validation rules (shared by Python and JS tests)

1. Valid against `snapshot.schema.json`.
2. `nodes[].path` unique; `meta.root` equals the first node's path.
3. Every connection endpoint exists in `nodes`.
4. Nodes and connections are in canonical order; keys sorted (the parser may accept other orders, the exporter must never emit them).
5. Serialization is canonical: `serialize(parse(bytes)) == bytes` for any file the exporter wrote.

## Node layout (added with feature 002)

`nodes[].layout` is optional: `{x, y, w, h}` = the node's tile in the TouchDesigner network editor (y grows upward). It is written by the `.toe` reader (`difftd/toe.py`). It is **display only**: diff and merge never treat a changed layout as a change; the viewer uses it to draw the network as it looks in TouchDesigner and may mark a node as "moved".
