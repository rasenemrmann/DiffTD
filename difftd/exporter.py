"""Export live TouchDesigner networks to snapshots.

This module and importer.py are the only places that read/write live TD state.
TD API facts used here are listed in research.md R1/R2 and checked by
difftd/td/probe.py (VERIFY items).
"""

import hashlib
import logging

from . import snapshot as S
from .store import Store

log = logging.getLogger("difftd")

TEXT_DAT = "textDAT"
TABLE_DAT = "tableDAT"


def _mode_name(par):
    """'constant' | 'expression' | 'export' | 'bind' from par.mode (str of ParMode enum)."""
    return str(par.mode).split(".")[-1].lower()


def _plain(value):
    if isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return str(value)
        return value
    return str(value)


def _param_value(par):
    mode = _mode_name(par)
    if mode == "expression":
        return {"expr": str(par.expr)}
    if mode == "bind":
        return {"bind": str(par.bindExpr)}
    if mode == "export":
        source = getattr(par, "exportSource", None)
        owner = getattr(source, "owner", None)
        return {"export": str(getattr(owner, "path", ""))}
    return _plain(par.val)


def _params(op):
    out = {}
    for par in op.pars():
        if getattr(par, "isPulse", False) or getattr(par, "readOnly", False):
            continue
        out[par.name] = _param_value(par)
    return out


def _content(op):
    if op.OPType == TEXT_DAT:
        text = op.text
        return {"kind": "text", "lines": text.split("\n") if text else []}
    if op.OPType == TABLE_DAT:
        return {"kind": "table", "rows": [[str(c.val) for c in row] for row in op.rows()]}
    return None


def _node(op):
    node = {"path": op.path, "name": op.name, "type": op.OPType, "params": _params(op)}
    content = _content(op)
    if content is not None:
        node["content"] = content
    return node


def export_root(root_comp, project_name):
    """Snapshot dict for one top-level COMP (root plus all descendants)."""
    ops = [root_comp] + list(root_comp.findChildren())
    prefix = root_comp.path + "/"
    inside = {o.path for o in ops}
    nodes = [_node(o) for o in ops]
    connections = []
    for o in ops:
        for conn in o.inputConnectors:
            for src_conn in conn.connections:
                src = src_conn.owner
                if src.path not in inside or not (o.path == root_comp.path or o.path.startswith(prefix)):
                    continue
                c = {"from": src.path, "to": o.path}
                if src_conn.index:
                    c["fromIndex"] = src_conn.index
                if conn.index:
                    c["toIndex"] = conn.index
                connections.append(c)
    return {
        "meta": {
            "format_version": S.SUPPORTED_FORMAT_VERSION,
            "project": project_name,
            "root": root_comp.path,
        },
        "nodes": nodes,
        "connections": connections,
    }


def snapshot_text(root_comp, project_name):
    return S.serialize(export_root(root_comp, project_name))


def text_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def top_level_roots(project_comp, config):
    """COMP children of the project container, minus excluded names (e.g. DiffTD itself)."""
    exclude = set(config.get("exclude", []))
    return sorted(
        (c for c in project_comp.children if c.isCOMP and c.name not in exclude),
        key=lambda c: c.name,
    )


def export_project(project_comp, project_name, repo_root, config):
    """Export every top-level COMP. Never raises; one failure does not stop the others.

    Returns a list of dicts: {root, file, status: written|unchanged|error, error?}.
    """
    store = Store(repo_root)
    results = []
    try:
        roots = top_level_roots(project_comp, config)
    except Exception as exc:  # noqa: BLE001 - export must never break the save
        store.log(f"export failed while listing roots: {exc!r}")
        return [{"root": project_comp.path, "file": None, "status": "error", "error": str(exc)}]
    for root in roots:
        rel = S.snapshot_path(project_name, root.name, config["snapshotDir"])
        try:
            text = snapshot_text(root, project_name)
            changed = store.write_text(rel, text)
            store.set_hash(root.path, text_hash(text))
            results.append({"root": root.path, "file": rel, "status": "written" if changed else "unchanged"})
        except Exception as exc:  # noqa: BLE001
            store.log(f"export of {root.path} failed: {exc!r}")
            results.append({"root": root.path, "file": rel, "status": "error", "error": str(exc)})
    return results
