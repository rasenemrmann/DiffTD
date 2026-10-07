"""Rebuild a live TouchDesigner network from a snapshot.

With exporter.py, the only module that touches live TD state. The `api` argument
provides `resolve_type(name) -> operator type or None` and `ParMode`
(see td/runtime.py::TDApi; tests pass tests/python/fake_td.py::FakeAPI).
"""

import logging

log = logging.getLogger("difftd")


def _warn(log_fn, message):
    log.warning(message)
    if log_fn:
        log_fn(message)


def _set_param(api, par, value):
    if isinstance(value, dict):
        if "expr" in value:
            par.expr = value["expr"]
            par.mode = api.ParMode.EXPRESSION
        elif "bind" in value:
            par.bindExpr = value["bind"]
            par.mode = api.ParMode.BIND
        else:
            raise ValueError("export-mode parameters are not restored")
    else:
        par.mode = api.ParMode.CONSTANT
        par.val = value


def _set_content(node, content):
    if content["kind"] == "text":
        node.text = "\n".join(content["lines"])
    else:
        node.clear()
        for row in content["rows"]:
            node.appendRow(row)


def import_root(parent_comp, snapshot, api, log=None):
    """Recreate the snapshot's root COMP inside `parent_comp`.

    Order (research R7): clear/create root, create all nodes (shallowest first), set
    parameters and DAT content, then connect. Unknown operator types and parameters
    are skipped with a warning, never abort.
    Returns {created, skippedNodes, skippedParams, skippedConnections}.
    """
    report = {"created": 0, "skippedNodes": [], "skippedParams": [], "skippedConnections": []}
    nodes = sorted(snapshot["nodes"], key=lambda n: (n["path"].count("/"), n["path"]))
    root_path = snapshot["meta"]["root"]
    root_node = next(n for n in nodes if n["path"] == root_path)

    def skip_node(node, reason):
        report["skippedNodes"].append({"path": node["path"], "reason": reason})
        _warn(log, f"skipped node {node['path']}: {reason}")

    # 1. root
    root = parent_comp.op(root_node["name"])
    if root is None:
        root_type = api.resolve_type(root_node["type"])
        if root_type is None:
            skip_node(root_node, f"unknown type {root_node['type']}")
            return report
        root = parent_comp.create(root_type, root_node["name"])
    else:
        for child in list(root.children):
            child.destroy()
    created = {root_path: root}
    report["created"] += 1

    # 2. all nodes before anything else
    for node in nodes:
        if node["path"] == root_path:
            continue
        parent_path = node["path"].rsplit("/", 1)[0]
        parent = created.get(parent_path)
        if parent is None:
            skip_node(node, "parent was skipped")
            continue
        op_type = api.resolve_type(node["type"])
        if op_type is None:
            skip_node(node, f"unknown type {node['type']}")
            continue
        try:
            created[node["path"]] = parent.create(op_type, node["name"])
            report["created"] += 1
        except Exception as exc:  # noqa: BLE001
            skip_node(node, f"cannot create: {exc}")

    # 3. parameters and DAT content
    for node in nodes:
        op = created.get(node["path"])
        if op is None:
            continue
        for name, value in node["params"].items():
            par = getattr(op.par, name, None)
            if par is None:
                reason = "unknown parameter"
            else:
                try:
                    _set_param(api, par, value)
                    continue
                except Exception as exc:  # noqa: BLE001
                    reason = str(exc)
            report["skippedParams"].append({"path": node["path"], "name": name, "reason": reason})
            _warn(log, f"skipped parameter {node['path']}.{name}: {reason}")
        if "content" in node:
            try:
                _set_content(op, node["content"])
            except Exception as exc:  # noqa: BLE001
                _warn(log, f"could not restore content of {node['path']}: {exc}")

    # 4. connections, only after every node exists
    for c in snapshot["connections"]:
        src, dst = created.get(c["from"]), created.get(c["to"])
        if src is None or dst is None:
            report["skippedConnections"].append({"from": c["from"], "to": c["to"]})
            _warn(log, f"skipped connection {c['from']} -> {c['to']}: endpoint missing")
            continue
        try:
            dst.inputConnectors[c.get("toIndex", 0)].connect(src.outputConnectors[c.get("fromIndex", 0)])
        except Exception as exc:  # noqa: BLE001
            report["skippedConnections"].append({"from": c["from"], "to": c["to"]})
            _warn(log, f"could not connect {c['from']} -> {c['to']}: {exc}")
    return report
