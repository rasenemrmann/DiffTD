import json
from pathlib import Path

import fake_td
from difftd import importer

FIX = Path(__file__).resolve().parents[1] / "fixtures"
NAMES = ["simple", "nested", "dat", "empty", "before", "after"]


def load(name):
    return json.loads((FIX / f"{name}.json").read_text(encoding="utf-8"))


def node(snap, name):
    return next(n for n in snap["nodes"] if n["name"] == name)


def env():
    registry = fake_td.types_from_snapshots([load(n) for n in NAMES])
    return fake_td.make_project(registry), fake_td.FakeAPI(registry)


def test_nodes_params_and_connections_recreated():
    project, api = env()
    report = importer.import_root(project, load("simple"), api)
    net = project.op("net1")
    assert {c.name for c in net.children} == {"wave1", "math1", "out1"}
    assert net.op("wave1")._pars["freq"].val == 1
    assert net.op("math1").inputConnectors[0].connections[0].owner.name == "wave1"
    assert report["skippedNodes"] == [] and report["skippedParams"] == []


def test_expression_restored():
    project, api = env()
    importer.import_root(project, load("simple"), api)
    par = project.op("net1").op("wave1")._pars["offset"]
    assert par.mode == fake_td.ParMode.EXPRESSION and par.expr == "absTime.seconds"


def test_all_nodes_created_before_any_connection(monkeypatch):
    project, api = env()
    events = []
    orig_create = fake_td.Op.create
    orig_connect = fake_td.Connector.connect

    def create(self, t, n):
        events.append("create")
        return orig_create(self, t, n)

    def connect(self, o):
        events.append("connect")
        return orig_connect(self, o)

    monkeypatch.setattr(fake_td.Op, "create", create)
    monkeypatch.setattr(fake_td.Connector, "connect", connect)
    importer.import_root(project, load("nested"), api)
    assert "connect" in events and events.index("connect") > max(i for i, e in enumerate(events) if e == "create")


def test_unknown_type_skipped_with_warning_and_rest_imports():
    project, api = env()
    snap = load("simple")
    node(snap, "wave1")["type"] = "fooCHOP"
    messages = []
    report = importer.import_root(project, snap, api, log=messages.append)
    net = project.op("net1")
    assert net.op("wave1") is None and net.op("math1") is not None
    assert report["skippedNodes"][0]["path"].endswith("/wave1")
    assert any("fooCHOP" in m for m in messages)
    assert any(s["from"].endswith("/wave1") for s in report["skippedConnections"])
    assert net.op("math1").inputConnectors[0].connections == []
    assert net.op("out1").inputConnectors[0].connections  # untouched connection survives


def test_children_of_skipped_node_are_skipped():
    project, api = env()
    snap = load("nested")
    node(snap, "sub1")["type"] = "barCOMP"
    report = importer.import_root(project, snap, api)
    skipped = {s["path"] for s in report["skippedNodes"]}
    assert "/project1/net1/sub1" in skipped and "/project1/net1/sub1/merge1" in skipped


def test_unknown_parameter_skipped_import_continues():
    project, api = env()
    snap = load("simple")
    node(snap, "wave1")["params"]["nonexistent"] = 5
    report = importer.import_root(project, snap, api)
    assert report["skippedParams"][0]["name"] == "nonexistent"
    assert project.op("net1").op("wave1")._pars["freq"].val == 1


def test_dat_content_restored():
    project, api = env()
    importer.import_root(project, load("dat"), api)
    net = project.op("net1")
    assert net.op("script1").text == "import td\nx = 1\n\nprint(x)"
    assert [[c.val for c in r] for r in net.op("table1").rows()][2] == ["b", "2"]


def test_multi_index_connections():
    project, api = env()
    importer.import_root(project, load("nested"), api)
    merge = project.op("net1").op("sub1").op("merge1")
    assert merge.inputConnectors[1].connections[0].owner.name == "const2"
    assert merge.inputConnectors[1].connections[0].index == 1


def test_existing_root_is_cleared_before_rebuild():
    project, api = env()
    importer.import_root(project, load("before"), api)
    importer.import_root(project, load("after"), api)
    names = {c.name for c in project.op("net1").children}
    assert names == {"wave1", "out1", "noise1", "script1"}


def test_empty_root_imports():
    project, api = env()
    report = importer.import_root(project, load("empty"), api)
    assert project.op("net1") is not None and report["created"] == 1


def test_parameter_set_failure_is_reported_not_raised():
    project, api = env()

    class Boom(fake_td.Par):
        armed = False

        @property
        def val(self):
            return 0

        @val.setter
        def val(self, v):
            if self.armed:
                raise RuntimeError("read-only")

    orig = fake_td.Op.create

    def create(self, t, n):
        op = orig(self, t, n)
        if n == "wave1":
            op._pars["amp"] = Boom("amp")
            op._pars["amp"].armed = True
        return op

    fake_td.Op.create = create
    try:
        report = importer.import_root(project, load("simple"), api)
    finally:
        fake_td.Op.create = orig
    assert any(s["name"] == "amp" and "read-only" in s["reason"] for s in report["skippedParams"])
