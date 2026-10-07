import json
from pathlib import Path

import pytest

import fake_td
from difftd import exporter, snapshot as S

FIX = Path(__file__).resolve().parents[1] / "fixtures"
NAMES = ["simple", "nested", "dat", "empty", "before", "after"]


def load(name):
    return json.loads((FIX / f"{name}.json").read_text(encoding="utf-8"))


def registry():
    return fake_td.types_from_snapshots([load(n) for n in NAMES])


def live(name, project=None):
    project = project or fake_td.make_project(registry())
    snap = load(name)
    fake_td.build_network(project, snap)
    return project, project.children[-1]


@pytest.mark.parametrize("name", NAMES)
def test_export_reproduces_fixture_bytes(name):
    _, root = live(name)
    text = exporter.snapshot_text(root, "project1")
    assert text == (FIX / f"{name}.json").read_text(encoding="utf-8")


def test_all_parameters_including_defaults_are_exported():
    _, root = live("simple")
    snap = exporter.export_root(root, "project1")
    wave = next(n for n in snap["nodes"] if n["name"] == "wave1")
    assert set(wave["params"]) == {"amp", "freq", "offset", "wavetype"}
    assert wave["params"]["amp"] == 1  # default value present (FR-001, Q1)


def test_expression_and_bind_encoding():
    _, root = live("simple")
    wave = root.op("wave1")
    wave._pars["amp"].mode = fake_td.ParMode.BIND
    wave._pars["amp"].bindExpr = "op('x').par.y"
    snap = exporter.export_root(root, "project1")
    node = next(n for n in snap["nodes"] if n["name"] == "wave1")
    assert node["params"]["offset"] == {"expr": "absTime.seconds"}
    assert node["params"]["amp"] == {"bind": "op('x').par.y"}


def test_pulse_and_readonly_parameters_skipped():
    _, root = live("simple")
    wave = root.op("wave1")
    wave._pars["freq"].isPulse = True
    wave._pars["amp"].readOnly = True
    node = next(n for n in exporter.export_root(root, "project1")["nodes"] if n["name"] == "wave1")
    assert "freq" not in node["params"] and "amp" not in node["params"]


def test_dat_content_text_and_table():
    _, root = live("dat")
    snap = exporter.export_root(root, "project1")
    by_name = {n["name"]: n for n in snap["nodes"]}
    assert by_name["script1"]["content"] == {"kind": "text", "lines": ["import td", "x = 1", "", "print(x)"]}
    assert by_name["table1"]["content"]["rows"][1] == ["a", "1"]
    assert "content" not in by_name["net1"]


def test_empty_text_dat_is_empty_lines():
    _, root = live("dat")
    root.op("script1").text = ""
    node = next(n for n in exporter.export_root(root, "project1")["nodes"] if n["name"] == "script1")
    assert node["content"] == {"kind": "text", "lines": []}


def test_connection_indices_preserved_and_outside_connections_ignored():
    project, root = live("nested")
    outside = fake_td.Op(project, "outside", "constantCHOP", {"value0": 1})
    project.children.append(outside)
    root.op("sub1").op("merge1").inputConnectors[2].connect(outside.outputConnectors[0])
    snap = exporter.export_root(root, "project1")
    conns = {(c["from"], c["to"], c.get("fromIndex", 0), c.get("toIndex", 0)) for c in snap["connections"]}
    assert ("/project1/net1/sub1/const2", "/project1/net1/sub1/merge1", 1, 1) in conns
    assert all("outside" not in c[0] for c in conns)


def test_reexport_is_byte_identical_and_node_creation_order_irrelevant():
    _, root = live("simple")
    first = exporter.snapshot_text(root, "project1")
    root.children.reverse()
    assert exporter.snapshot_text(root, "project1") == first


def test_one_changed_parameter_changes_one_line():
    _, root = live("simple")
    before = exporter.snapshot_text(root, "project1").splitlines()
    root.op("wave1")._pars["freq"].val = 5
    after = exporter.snapshot_text(root, "project1").splitlines()
    assert len(before) == len(after)
    assert sum(1 for a, b in zip(before, after) if a != b) == 1


def test_output_validates():
    _, root = live("nested")
    assert S.validate(json.loads(exporter.snapshot_text(root, "project1"))) == []


def test_export_project_one_file_per_top_level_comp_and_excludes_difftd(tmp_path):
    project = fake_td.make_project(registry())
    fake_td.build_network(project, load("simple"))
    fake_td.build_network(project, load("dat"))
    project.children.append(fake_td.Op(project, "DiffTD", "baseCOMP"))
    cfg = {"snapshotDir": "snapshots", "exclude": ["DiffTD"]}
    results = exporter.export_project(project, "project1", tmp_path, cfg)
    assert [r["status"] for r in results] == ["written", "written"]
    assert (tmp_path / "snapshots/project1/net1.json").is_file()
    assert not (tmp_path / "snapshots/project1/DiffTD.json").exists()
