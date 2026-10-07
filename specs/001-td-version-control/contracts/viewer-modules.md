# Contract: Viewer Modules (pure logic)

All modules are ES modules with no DOM or network access unless stated, so they run under `node --test`.

## `schema.js`
- `validateSnapshot(obj) → { ok: true } | { ok: false, errors: [{ path, message }] }` — uses `schema/snapshot.schema.json`; also checks rules 2–3 of the data-model validation list. `format_version` above supported → error code `unsupported_version`.
- `parseSnapshot(text) → Snapshot` — throws `SnapshotError` with a human message naming the problem (FR-014).

## `diff.js`
- `diffSnapshots(before, after) → DiffResult` (see data-model). Pure; deterministic ordering.
- `diffText(beforeLines, afterLines) → Hunk[]`, `diffTable(beforeRows, afterRows) → CellChange[]`.

## `layout.js`
- `layoutGraph(nodes, connections) → { positions: Map<path,{x,y}>, layers: string[][] }` — topological layering, cycle-safe, deterministic.

## `merge.js`
- `mergeSnapshots(base, ours, theirs) → MergeResult` (rules in data-model).
- `applyResolution(mergeResult, conflictId, resolution) → MergeResult` (immutable update).
- `isResolved(mergeResult) → boolean`; `finalize(mergeResult) → Snapshot` throws if unresolved.
- `serializeSnapshot(snapshot) → string` — byte-identical to the Python canonical serializer (tested against shared fixtures).

## `gitrepo.js` (browser only)
- `openRepo(dirHandle, { write }) → Repo`
- `Repo.listCommits({ limit, ref }) → [{ oid, message, author, date }]`
- `Repo.readSnapshotAt(oid, path) → string | null`
- `Repo.listSnapshotsAt(oid) → string[]`
- `Repo.mergeBase(oidA, oidB) → oid`, `Repo.mergeHead() → oid | null`
- `Repo.writeSnapshot(path, text)` — only callable after the UI confirmation step (FR-020).

## `reload-client.js` (browser only)
- `requestReload(files, port) → response` — POSTs to the [reload endpoint](reload-endpoint.md); only invoked by an explicit second confirmation (FR-018).

## UI states (contract for acceptance tests)

- Load error: red banner, no graph (US3 scenario 3).
- Colors by status: added, removed, changed, unchanged — each also has a non-color marker (icon/outline) for accessibility.
- Node click: side panel with per-parameter before/after and DAT diff.
- Conflict review: list of conflicts with base/ours/theirs and a choice per conflict; "Write merged result" disabled until `isResolved`.
