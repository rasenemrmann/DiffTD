# Contract: Reload Endpoint (TD Web Server DAT)

Used by the Git hooks and, after explicit user confirmation, by the viewer.

## Binding

- Host `127.0.0.1` only. Port from [config](config.md) (`reloadPort`, default `9980`).
- CORS: `Access-Control-Allow-Origin` echoes the request `Origin` only if it is in `allowedOrigins`; otherwise no CORS headers.

## `GET /health`

- `200 {"status":"ok","formatVersion":1,"project":"<name>"}` when DiffTD is loaded.

## `POST /reload`

Request (`application/json`):

```json
{ "files": ["snapshots/project1/geo1.json"], "source": "post-merge" }
```

- `files`: paths relative to the repository root, each MUST resolve inside the configured `snapshotDir`. Entries outside it, absolute paths, or `..` segments → rejected with 400. File contents are never accepted from the caller; DiffTD reads them from disk.
- `source`: free text for the log (`post-checkout`, `post-merge`, `post-rewrite`, `viewer`).

Response `200`:

```json
{
  "reloaded": ["/project1/geo1"],
  "unchanged": [],
  "removed": [],
  "skippedNodes": [{ "path": "/project1/geo1/x1", "reason": "unknown type fooCHOP" }],
  "skippedParams": [{ "path": "/project1/geo1/wave1", "name": "oldpar" }],
  "backups": [{ "root": "/project1/geo1", "file": ".difftd/backups/20261003T101500Z/geo1.json" }],
  "errors": []
}
```

Behavior:

- `unchanged`: the live network already equals the snapshot, nothing was rebuilt.
- A file that is missing (deleted by the Git operation) removes the corresponding top-level COMP (listed in `removed`); a backup is written first if it had unsaved edits.
- A snapshot whose `meta.root` does not match `<projectRoot>/<file name>` is listed in `errors` and skipped.
- POST requires `Content-Type: application/json` (415 otherwise). A request with an `Origin` header that is not in `allowedOrigins` gets 403; requests without `Origin` (curl from Git hooks) are accepted.
- A file with unsupported `format_version` or invalid schema → listed in `errors`, other files still processed; status stays `200` with non-empty `errors`.
- If unsaved edits exist in a target COMP, a backup is written **before** it is rebuilt (FR-016) and listed in `backups`.
- Requests are processed one at a time; a concurrent request gets `409`.

Errors: `400` malformed body or illegal path; `409` reload in progress; `500` unexpected failure (nothing partially applied to other COMPs).
