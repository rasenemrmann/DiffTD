# Contract: Configuration (`difftd.config.json`, repository root)

All fields optional; defaults shown.

```json
{
  "snapshotDir": "snapshots",
  "reloadPort": 9980,
  "allowedOrigins": ["http://localhost:8080", "http://127.0.0.1:8080"],
  "exportOnSave": true,
  "projectRoot": "/project1",
  "exclude": ["DiffTD"]
}
```

| Field | Meaning |
|-------|---------|
| `snapshotDir` | Directory (relative to repo root) holding `<project>/<root>.json` files. |
| `reloadPort` | Port of the Web Server DAT (127.0.0.1). |
| `allowedOrigins` | Browser origins permitted to call the reload endpoint (viewer). |
| `exportOnSave` | When `false`, only the manual export runs (FR-004). |
| `projectRoot` | TD path of the container whose COMP children are the top-level COMPs that get snapshots. |
| `exclude` | Names of COMPs under `projectRoot` that are never exported (the DiffTD component itself). |

Rules: unknown keys are ignored with a warning; invalid values fall back to defaults with a warning. The same file is read by the Python package and by the hook scripts.
