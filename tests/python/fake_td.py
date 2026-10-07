"""Minimal fake of the TouchDesigner object model for tests outside TD.

Mirrors only the API surface listed in research.md R1/R2. If the probe in TD
(difftd/td/probe.py) shows a difference, update this fake together with the adapters.
"""

import enum


class ParMode(enum.Enum):
    CONSTANT = 0
    EXPRESSION = 1
    EXPORT = 2
    BIND = 3


class Cell:
    def __init__(self, val):
        self.val = val


class Par:
    def __init__(self, name, val=0, default=None):
        self.name = name
        self.val = val
        self.default = val if default is None else default
        self.expr = ""
        self.bindExpr = ""
        self.mode = ParMode.CONSTANT
        self.isPulse = False
        self.readOnly = False


class ParNamespace:
    def __init__(self, op):
        object.__setattr__(self, "_op", op)

    def __getattr__(self, name):
        return self._op._pars.get(name)


class Connector:
    def __init__(self, owner, index, is_input):
        self.owner = owner
        self.index = index
        self.isInput = is_input
        self.connections = []

    def connect(self, other):
        other_conn = other if isinstance(other, Connector) else other.outputConnectors[0]
        if other_conn not in self.connections:
            self.connections.append(other_conn)
            other_conn.connections.append(self)


class Op:
    def __init__(self, parent, name, op_type, pars=None, n_connectors=3):
        self.parent_op = parent
        self.name = name
        self.OPType = op_type
        self.path = (parent.path if parent else "") + "/" + name if parent else "/" + name
        self.children = []
        self._pars = {}
        for pname, pval in (pars or {}).items():
            self._pars[pname] = Par(pname, pval)
        self.par = ParNamespace(self)
        self.isCOMP = op_type.endswith("COMP")
        self.inputConnectors = [Connector(self, i, True) for i in range(n_connectors)]
        self.outputConnectors = [Connector(self, i, False) for i in range(n_connectors)]
        self.text = ""
        self._rows = []
        self.destroyed = False
        self.create_log = []

    # -- TD-like API
    def pars(self):
        return list(self._pars.values())

    def findChildren(self):
        out = []
        for c in self.children:
            out.append(c)
            out.extend(c.findChildren())
        return out

    def op(self, name):
        for c in self.children:
            if c.name == name:
                return c
        return None

    def create(self, op_type, name):
        if self.registry is None or op_type not in self.registry:
            raise ValueError(f"unknown operator type {op_type}")
        child = Op(self, name, op_type, dict(self.registry[op_type]))
        child.registry = self.registry
        self.children.append(child)
        return child

    def destroy(self):
        if self.parent_op:
            self.parent_op.children.remove(self)
        self.destroyed = True

    def rows(self):
        return [[Cell(c) for c in row] for row in self._rows]

    def clear(self):
        self._rows = []

    def appendRow(self, row):
        self._rows.append([str(c) for c in row])

    registry = None


class FakeAPI:
    """Stands in for the `td` module bits the adapters need."""

    ParMode = ParMode

    def __init__(self, registry):
        self.registry = registry

    def resolve_type(self, name):
        return name if name in self.registry else None


def make_project(registry, name="project1"):
    root = Op(None, name, "baseCOMP", {})
    root.registry = registry
    return root


def types_from_snapshots(snapshots):
    """Registry: operator type -> {param name: default value} gathered from snapshots."""
    registry = {}
    for snap in snapshots:
        for n in snap["nodes"]:
            entry = registry.setdefault(n["type"], {})
            for k, v in n["params"].items():
                entry.setdefault(k, 0 if isinstance(v, dict) else v)
    return registry


def build_network(project, snapshot):
    """Build the live fake network for a snapshot directly (independent of the importer)."""
    registry = project.registry
    by_path = {}
    root_node = snapshot["nodes"][0]
    root = Op(project, root_node["name"], root_node["type"], {})
    root.registry = registry
    project.children.append(root)
    by_path[root_node["path"]] = root
    nodes = sorted(snapshot["nodes"], key=lambda n: n["path"].count("/"))
    for n in nodes:
        if n["path"] in by_path:
            op = root
        else:
            parent = by_path[n["path"].rsplit("/", 1)[0]]
            op = parent.create(n["type"], n["name"])
            by_path[n["path"]] = op
        _apply(op, n)
    for c in snapshot["connections"]:
        by_path[c["to"]].inputConnectors[c.get("toIndex", 0)].connect(
            by_path[c["from"]].outputConnectors[c.get("fromIndex", 0)]
        )
    return root


def _apply(op, node):
    for name, value in node["params"].items():
        par = op._pars.get(name) or Par(name)
        op._pars[name] = par
        if isinstance(value, dict):
            if "expr" in value:
                par.expr, par.mode = value["expr"], ParMode.EXPRESSION
            elif "bind" in value:
                par.bindExpr, par.mode = value["bind"], ParMode.BIND
            else:
                par.mode = ParMode.EXPORT
        else:
            par.val = value
    content = node.get("content")
    if content:
        if content["kind"] == "text":
            op.text = "\n".join(content["lines"])
        else:
            op._rows = [list(r) for r in content["rows"]]
