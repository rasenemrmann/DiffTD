# Contract: Helper API additions (feature 003)

Existing endpoints from feature 002 stay: `GET /api/info`, `GET /api/versions`, `GET /api/snapshot?file=<relative path>`. All are served on `127.0.0.1` only; any other `Host` → 403.

## `GET /api/info`

```json
{ "folder": null, "toeexpand": "/Applications/TouchDesigner.app/Contents/MacOS/toeexpand",
  "problem": null, "uploadLimitBytes": 209715200, "version": 3 }
```

`folder` is `null` when the helper was started without one. `problem` is a readable string when `toeexpand` cannot be found.

## `GET /api/versions`

`{ "folder": null, "versions": [] }` when no folder was given. Otherwise as in feature 002, with one more field per version: `sha256` (content hash, cached per path/mtime/size) so the page can list identical content once across all sources.

## `GET /api/snapshot?sha256=<hex>`

Cache lookup for content the helper has already converted.

- `200 { "sha256": "...", "roots": { "<name>": <snapshot> } }`
- `404 { "error": "not converted yet" }`

(`?file=` keeps its meaning; exactly one of `file` / `sha256` must be given, otherwise 400.)

## `POST /api/convert?sha256=<hex>&name=<url-encoded file name>`

Converts file bytes sent by the page.

Request:

- Body: the raw file bytes, `Content-Type: application/octet-stream`.
- Required header `X-DiffTD: 1`.
- `Origin`, if present, must be `http://<Host header>`; otherwise 403.
- `name` must end in `.toe` or `.tox` (case-insensitive).

Responses:

| Status | Meaning |
|--------|---------|
| 200 | `{ "sha256", "name", "roots": { "<name>": <snapshot> } }` |
| 400 | missing/invalid `sha256` or `name`, or body hash does not match |
| 403 | wrong Host/Origin or missing `X-DiffTD` header |
| 413 | `Content-Length` above `uploadLimitBytes` (body is not read) |
| 415 | file name is not `.toe`/`.tox` |
| 422 | `toeexpand` could not read the file: `{ "error": "<name>: <reason>" }` |
| 500 | unexpected |

Behavior:

- The body is written to a temporary directory, converted (as `toe.convert`), and the directory is removed on success and on failure.
- The result is cached by `sha256` (LRU, 30 entries); a repeated POST with the same hash returns the cached result without converting again.
- Nothing from the upload is logged beyond file name and size.

## CORS

None. The page is served by the helper itself (same origin). Cross-origin requests get no CORS headers, so browsers block them; the `X-DiffTD` header makes every cross-origin POST require a preflight that is never approved.
