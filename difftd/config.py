"""Load difftd.config.json (see specs/001-td-version-control/contracts/config.md)."""

import json
import logging
from pathlib import Path

log = logging.getLogger("difftd")

CONFIG_FILE = "difftd.config.json"

DEFAULTS = {
    "snapshotDir": "snapshots",
    "reloadPort": 9980,
    "allowedOrigins": ["http://localhost:8080", "http://127.0.0.1:8080"],
    "exportOnSave": True,
    "projectRoot": "/project1",
    "exclude": ["DiffTD"],
}


def _valid(key, value):
    if key == "snapshotDir":
        return (
            isinstance(value, str)
            and value != ""
            and not value.startswith("/")
            and ".." not in value.split("/")
        )
    if key == "reloadPort":
        return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 65535
    if key in ("allowedOrigins", "exclude"):
        return isinstance(value, list) and all(isinstance(v, str) for v in value)
    if key == "exportOnSave":
        return isinstance(value, bool)
    if key == "projectRoot":
        return isinstance(value, str) and value.startswith("/")
    return False


def load_config(repo_root):
    """Return config dict with defaults applied; never raises."""
    config = {k: (list(v) if isinstance(v, list) else v) for k, v in DEFAULTS.items()}
    path = Path(repo_root) / CONFIG_FILE
    if not path.is_file():
        return config
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("DiffTD: cannot read %s (%s); using defaults", CONFIG_FILE, exc)
        return config
    if not isinstance(data, dict):
        log.warning("DiffTD: %s must contain a JSON object; using defaults", CONFIG_FILE)
        return config
    for key, value in data.items():
        if key not in DEFAULTS:
            log.warning("DiffTD: unknown config key %r ignored", key)
        elif _valid(key, value):
            config[key] = value
        else:
            log.warning("DiffTD: invalid value for %r; using default", key)
    return config
