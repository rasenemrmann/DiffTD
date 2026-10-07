"""Reload top-level COMPs from snapshot files after Git operations (FR-015, FR-016).

`rt` is a runtime object (see td/runtime.py) with: repo_root, config, project_comp,
project_name, api. Tests pass a SimpleNamespace around the fake TD.
"""

import threading
from pathlib import PurePosixPath

from . import snapshot as S
from .exporter import snapshot_text, text_hash
from .importer import import_root
from .store import Store

_lock = threading.Lock()


class ReloadError(ValueError):
    """Illegal request (maps to HTTP 400)."""


class Busy(RuntimeError):
    """Another reload is in progress (maps to HTTP 409)."""


def validate_files(files, config):
    """Return [(relative_path, root_name)]; raise ReloadError for anything outside snapshotDir."""
    if not isinstance(files, list) or not all(isinstance(f, str) for f in files):
        raise ReloadError("'files' must be a list of strings")
    base = PurePosixPath(config["snapshotDir"])
    out = []
    for rel in files:
        if not rel or "\\" in rel or "\x00" in rel:
            raise ReloadError(f"illegal path: {rel!r}")
        path = PurePosixPath(rel)
        if rel.startswith("/") or any(seg in ("", ".", "..") for seg in rel.split("/")):
            raise ReloadError(f"illegal path: {rel}")
        try:
            inside = path.relative_to(base)
        except ValueError:
            raise ReloadError(f"{rel} is outside the snapshot directory") from None
        if len(inside.parts) != 2 or path.suffix != ".json":
            raise ReloadError(f"{rel} is not a snapshot file path (<dir>/<project>/<root>.json)")
        out.append((str(path), path.stem))
    return out


def _unique_stamp(store):
    stamp = store.stamp()
    candidate, n = stamp, 1
    while (store.state_dir / "backups" / candidate).exists():
        n += 1
        candidate = f"{stamp}-{n}"
    return candidate


def reload_files(files, rt, source=""):
    """Rebuild the COMPs behind `files`. Returns the response dict of contracts/reload-endpoint.md."""
    entries = validate_files(files, rt.config)
    if not _lock.acquire(blocking=False):
        raise Busy("a reload is already in progress")
    try:
        return _reload(entries, rt, source)
    finally:
        _lock.release()


def _reload(entries, rt, source):
    store = Store(rt.repo_root)
    result = {
        "reloaded": [],
        "unchanged": [],
        "removed": [],
        "skippedNodes": [],
        "skippedParams": [],
        "backups": [],
        "errors": [],
    }
    stamp = None

    def backup(root_path, root_name, live_text):
        nonlocal stamp
        if stamp is None:
            stamp = _unique_stamp(store)
        rel = store.backup(stamp, root_name, live_text)
        result["backups"].append({"root": root_path, "file": rel})
        store.log(f"unsaved edits in {root_path} backed up to {rel} before reload ({source})")

    for rel, root_name in entries:
        root_path = f"{rt.project_comp.path}/{root_name}"
        try:
            live = rt.project_comp.op(root_name)
            target = rt.repo_root / rel
            live_text = snapshot_text(live, rt.project_name) if live is not None else None
            if live_text is not None and store.get_hash(root_path) != text_hash(live_text):
                has_unsaved = True
            else:
                has_unsaved = False

            if not target.is_file():
                if live is None:
                    continue
                if has_unsaved:
                    backup(root_path, root_name, live_text)
                live.destroy()
                result["removed"].append(root_path)
                continue

            text = target.read_text(encoding="utf-8")
            try:
                snap = S.parse(text)
            except S.SnapshotError as exc:
                result["errors"].append({"file": rel, "message": str(exc)})
                continue
            if snap["meta"]["root"] != root_path:
                result["errors"].append(
                    {"file": rel, "message": f"snapshot root {snap['meta']['root']} does not match {root_path}"}
                )
                continue

            if live_text is not None and live_text == S.serialize(snap):
                store.set_hash(root_path, text_hash(live_text))
                result["unchanged"].append(root_path)
                continue
            if has_unsaved:
                backup(root_path, root_name, live_text)

            report = import_root(rt.project_comp, snap, rt.api, log=store.log)
            result["skippedNodes"].extend(report["skippedNodes"])
            result["skippedParams"].extend(report["skippedParams"])
            fresh = rt.project_comp.op(root_name)
            if fresh is not None:
                store.set_hash(root_path, text_hash(snapshot_text(fresh, rt.project_name)))
            result["reloaded"].append(root_path)
        except Exception as exc:  # noqa: BLE001 - one bad file must not stop the others
            store.log(f"reload of {rel} failed: {exc!r}")
            result["errors"].append({"file": rel, "message": str(exc)})
    return result
